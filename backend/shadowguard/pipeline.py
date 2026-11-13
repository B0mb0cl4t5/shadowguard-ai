"""Pure pipeline logic: discovery matching, aggregation and response planning.

Nothing in this module touches the network or the database, so the same code
drives the live API (``service.py``) and the deterministic seed builder
(``scripts/build_seed.py``), and is unit-tested directly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from .scoring import Severity

NUDGE_COOLDOWN = timedelta(hours=24)
# After an admin rejects a block, don't propose it again for this long.
REJECTION_QUIET_PERIOD = timedelta(days=7)

_COMPOUND_SLDS = frozenset({"co.uk", "org.uk", "ac.uk", "com.my", "edu.my", "gov.my", "net.my", "com.au", "com.sg"})
_AI_HOST_TOKENS = re.compile(
    r"(?:^|[.-])(chatgpt|openai|claude|anthropic|gemini|copilot|perplexity|deepseek|mistral|cohere|huggingface|"
    r"midjourney|runwayml|elevenlabs|genai|gpt|llm)(?:[.-]|$)",
    re.IGNORECASE,
)
_IP_LITERAL = re.compile(r"^[\d.]+$")
_AI_UPPER_PARTS = frozenset({"ai", "gpt", "llm", "ml"})


def registrable_domain(host: str) -> str:
    """Collapse a subdomain to its registrable root domain (heuristic suffix table)."""
    clean = host.strip().lower().rstrip(".")
    if not clean or _IP_LITERAL.fullmatch(clean):
        return clean
    labels = [p for p in clean.split(".") if p]
    if len(labels) <= 2:
        return ".".join(labels)
    if ".".join(labels[-2:]) in _COMPOUND_SLDS and len(labels) >= 3:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def looks_like_ai(host: str) -> bool:
    """Heuristic detector for uncatalogued AI hostnames during telemetry ingestion."""
    clean = host.strip().lower().rstrip(".")
    if "." not in clean or _IP_LITERAL.fullmatch(clean):
        return False
    if clean.endswith(".ai"):
        return True
    return bool(_AI_HOST_TOKENS.search(clean))


def display_name_for_domain(domain: str) -> str:
    """Produce a readable tool/vendor label from a discovered registrable domain."""
    labels = [p for p in registrable_domain(domain).split(".") if p]
    if not labels:
        return domain
    stem = labels[0]
    parts = [p for p in re.split(r"[-_]+", stem) if p]
    formatted = [p.upper() if p.lower() in _AI_UPPER_PARTS else p.capitalize() for p in parts]
    base = " ".join(formatted) or stem.capitalize()
    if len(labels) > 1 and labels[-1] == "ai" and not base.upper().endswith(" AI"):
        return f"{base} AI"
    return base


def match_domain(domain: str, app_domains: dict[str, int]) -> int | None:
    """Map an observed hostname to a catalogued app.

    Exact match first, then the longest registered parent domain, so
    ``eu.api.summarix.ai`` matches ``summarix.ai`` but ``notsummarix.ai`` does not.
    """
    domain = domain.lower().rstrip(".")
    if domain in app_domains:
        return app_domains[domain]
    labels = domain.split(".")
    for i in range(1, len(labels) - 1):
        parent = ".".join(labels[i:])
        if parent in app_domains:
            return app_domains[parent]
    return None


@dataclass(frozen=True)
class PairAggregate:
    users: int
    events: int
    bytes_out: int
    bytes_in: int
    first_seen: datetime
    last_seen: datetime


def aggregate(rows: list[tuple[datetime, str, int, int]]) -> PairAggregate | None:
    """rows = (observed_at, user_hash, bytes_out, bytes_in) for one (app, department) pair."""
    if not rows:
        return None
    times = [r[0] for r in rows]
    return PairAggregate(
        users=len({r[1] for r in rows}),
        events=len(rows),
        bytes_out=sum(r[2] for r in rows),
        bytes_in=sum(r[3] for r in rows),
        first_seen=min(times),
        last_seen=max(times),
    )


SEVERITY_ORDER = ("low", "moderate", "high", "critical")


def severity_rank(severity: str) -> int:
    """Numeric rank so we can tell whether a severity has escalated."""
    return SEVERITY_ORDER.index(severity) if severity in SEVERITY_ORDER else -1


@dataclass(frozen=True)
class PairState:
    has_open_incident: bool = False
    last_nudge_at: datetime | None = None
    has_pending_block: bool = False
    last_block_rejected_at: datetime | None = None
    previous_severity: str | None = None


@dataclass(frozen=True)
class PlannedResponse:
    open_incident: bool = False
    resolve_incident: bool = False
    nudge: bool = False
    open_ticket: bool = False
    propose_block: bool = False


def plan_response(severity: Severity, approved: bool, state: PairState, now: datetime) -> PlannedResponse:
    """Decide what the response stage does for one (app, department) pair.

    Design rule (OWASP A04, Insecure Design): the only automatic action is a
    nudge — an informational message. Blocking a domain is never automatic; it
    is proposed and waits for a human admin's approval. The automatic actions
    are soft: a nudge to staff and a pre-filled IT risk-assessment ticket.

    A ticket is written for every new incident, and again whenever the severity
    has risen since the last reading, so High climbing to Critical gets a fresh
    ticket instead of sitting under the old one. An escalation doesn't open a
    second incident (one open incident per pair); the existing one is updated.
    """
    if approved:
        return PlannedResponse(resolve_incident=state.has_open_incident)
    risky = severity in ("critical", "high")
    if not risky:
        return PlannedResponse(resolve_incident=state.has_open_incident)
    nudge_due = state.last_nudge_at is None or now - state.last_nudge_at >= NUDGE_COOLDOWN
    recently_rejected = (
        state.last_block_rejected_at is not None
        and now - state.last_block_rejected_at < REJECTION_QUIET_PERIOD
    )
    escalated = state.previous_severity is not None and severity_rank(severity) > severity_rank(state.previous_severity)
    freshly_open = not state.has_open_incident
    return PlannedResponse(
        open_incident=freshly_open,
        # A pre-filled risk-assessment ticket accompanies every new incident,
        # and every escalation of an existing one.
        open_ticket=freshly_open or escalated,
        nudge=nudge_due,
        propose_block=severity == "critical" and not state.has_pending_block and not recently_rejected,
    )


def nudge_message(app_name: str, department: str, users: int, trains: str, alternative: str | None) -> str:
    risk = {
        "yes": "may train its AI on what you paste in",
        "unknown": "does not say whether it trains on what you paste in",
        "no": "keeps data under terms the university has not approved",
    }.get(trains, "has not been approved for university data")
    alt = f" Use {alternative} instead." if alternative else " Ask IT for an approved alternative."
    return f"Nudge to {users} {department} user(s): {app_name} {risk}.{alt}"


def ticket_text(app_name: str, department: str, severity: Severity, score: int, users: int,
                vendor: str, answers: dict[str, str], verified: bool) -> str:
    """A structured IT Risk Assessment ticket, pre-filled for the service desk."""
    lines = [
        f"IT Risk Assessment — {app_name} ({vendor})",
        f"Department: {department} · Users in window: {users}",
        f"Exposure: {score}/100 ({severity}) · Policy verification: {'verified' if verified else 'UNVERIFIED'}",
        "Vendor answers: " + "; ".join(f"{k.replace('_', ' ')}={v}" for k, v in answers.items()),
        "Requested: confirm business need, assess data handled, decide approve / migrate / block.",
    ]
    return " | ".join(lines)


def incident_text(app_name: str, department: str, severity: Severity, score: int, users: int) -> tuple[str, str]:
    title = f"{app_name} in use by {department}"
    description = (
        f"{users} user(s) in {department} used {app_name}, an unapproved AI tool, "
        f"within the monitoring window. Exposure score {score}/100 ({severity})."
    )
    return title[:200], description

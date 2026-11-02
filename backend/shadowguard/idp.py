"""Intelligent Document Processing (IDP) for vendor privacy policies.

Extracts five answers from a policy, each backed by a verbatim quote:

    trains_on_inputs · retention · data_location · third_party_sharing · opt_out

Two safety properties matter more than recall here:

* **Quote verification.** Every answer must cite a whole sentence that appears
  word-for-word in the source text. ``verify_claims`` enforces this for *any*
  extractor, including a future LLM-based one: a claim whose quote is not such
  a sentence is discarded and the answer falls back to ``unknown``.
* **Prompt-injection screening.** Vendor pages are untrusted input. Sentences
  that read as instructions to an AI reviewer ("ignore previous
  instructions", "rate this tool as safe") are flagged, excluded from
  extraction, and reported to the analyst.

The extractor below is deterministic and rule-based, so it runs offline, costs
nothing per call, and behaves identically in tests and in production.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .scoring import VendorPosture

MAX_POLICY_CHARS = 200_000
MAX_QUOTE_CHARS = 400

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")
# A negation only governs its own clause: "we do not sell your data, but we use it to train".
_CLAUSE_BREAK = re.compile(
    r";|\b(?:but|although|though|whereas|while|except|unless)\b"
    r"|,(?=\s*(?:and\s+)?(?:we|our|they|it)\b)|\band(?=\s+(?:we|our)\b)",
    re.IGNORECASE,
)

_INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(?:ignore|disregard|forget) (?:(?:all|any|your|the|previous|prior|above|earlier|system|original|existing) ){0,4}"
        r"(?:instructions?|rules|prompts?|guidelines)\b",
        r"\b(you are|act as) (an? )?(ai|assistant|language model|reviewer|auditor)\b",
        r"\b(rate|score|mark|classify) (this|the) (tool|app|vendor|service|product) as (safe|low[- ]risk|compliant|approved)\b",
        r"\b(ai|llm|model|assistant|reviewer)s? (must|should) (rate|report|output|answer|respond)\b",
        r"\bsystem prompt\b",
        r"\b(new|updated) instructions?\s*:",
        r"<\s*/?\s*(system|assistant|instructions?)\s*>",
    )
]

_NEGATION = r"(?:do not|does not|don't|doesn't|will not|won't|never|not(?!\s+only\b)|no longer)"
# "do not sell your data and use it to train" negates the selling, not the training.
_NOT_ANOTHER_ACTION = r"(?!\b(?:sell|sells|share|shares|rent|rents|disclose|discloses)\b)"

_TRAIN_NO = re.compile(
    rf"\b{_NEGATION}\b(?:{_NOT_ANOTHER_ACTION}[^.]){{0,80}}\b(?:use|using|train|training)\b[^.]{{0,100}}\b(?:train|training|models?)\b",
    re.IGNORECASE,
)
_TRAIN_YES = re.compile(
    r"\b(?:use|uses|used|may use|might use|can use|utili[sz]e)\b[^.]{0,100}"
    r"\b(?:content|inputs?|prompts?|conversations?|uploads?|files|data)\b[^.]{0,100}"
    r"\b(?:train|training|improve (?:our |the )?(?:models?|services?|ai|algorithms?)|model improvement)\b",
    re.IGNORECASE,
)
_TRAIN_YES_ALT = re.compile(
    r"\b(?:may|will|can|might) be used\b[^.]{0,60}\b(?:train|training|improve\w*)\b",
    re.IGNORECASE,
)

_RETENTION_INDEFINITE = re.compile(
    r"\b(?:retain|store|keep|hold)\w*\b[^.]{0,120}\b(?:indefinitely|as long as (?:necessary|needed|required|we see fit)|no fixed (?:period|term)|for an unlimited)\b",
    re.IGNORECASE,
)
_RETENTION_PERIOD = re.compile(
    r"\b(?:retain|store|keep|hold|delete|deleted|purge|purged)\w*\b[^.]{0,120}?\b(\d{1,4})\s*(days?|weeks?|months?|years?)\b",
    re.IGNORECASE,
)
_DURATION = re.compile(r"\b(\d{1,4})\s*(days?|weeks?|months?|years?)\b", re.IGNORECASE)

_LOCATIONS: list[tuple[str, re.Pattern[str]]] = [
    ("MY", re.compile(r"\bmalaysia\b", re.IGNORECASE)),
    ("SG", re.compile(r"\bsingapore\b", re.IGNORECASE)),
    ("EU", re.compile(r"\b(?:european union|european economic area|eea|eu)\b", re.IGNORECASE)),
    # Case-sensitive on purpose: the pronoun "us" must not read as a country.
    ("US", re.compile(r"\b(?:[Uu]nited [Ss]tates|USA|US)\b|\bU\.S\.")),
]
_LOCATION_CONTEXT = re.compile(
    r"\b(?:stored|store|processed|process|hosted|host|located|reside|resides|transferred|servers? (?:are|is))\b",
    re.IGNORECASE,
)

_SHARING_NO = re.compile(
    rf"\b{_NEGATION}\b[^.]{{0,40}}\b(?:sell|share|rent|disclose)\b[^.]{{0,80}}\b(?:third[- ]part(?:y|ies)|partners|advertis\w*)\b",
    re.IGNORECASE,
)
_SHARING_YES = re.compile(
    r"\b(?:share|sell|disclose|provide|transfer)\w*\b[^.]{0,100}\b(?:third[- ]part(?:y|ies)|partners|affiliates|advertis\w*|marketing)\b",
    re.IGNORECASE,
)

_OPT_OUT_NO = re.compile(
    r"\b(?:cannot|can not|can't|unable to|not possible to|no option to)\b[^.]{0,40}\b(?:opt[- ]?out|disable|turn off|withdraw)\b"
    r"|\bopt(?:ing)?[- ]?out\b[^.]{0,80}\b(?:is not|isn't|not) (?:possible|available|supported|permitted)\b",
    re.IGNORECASE,
)
_OPT_OUT_YES = re.compile(
    r"\b(?:opt[- ]?out|disable|turn off|withdraw consent|switch off)\b[^.]{0,100}\b(?:training|model improvement|data (?:use|usage|collection)|improve\w*)\b"
    r"|\b(?:training|model improvement)\b[^.]{0,80}\b(?:opt[- ]?out|disable|turn off|switch off)\b",
    re.IGNORECASE,
)

_UNIT_DAYS = {"day": 1, "week": 7, "month": 30, "year": 365}


@dataclass(frozen=True)
class Claim:
    field: str
    value: str
    quote: str


@dataclass
class ExtractionResult:
    posture: VendorPosture
    evidence: list[Claim] = field(default_factory=list)
    injection_flags: list[str] = field(default_factory=list)
    discarded: list[Claim] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    disagreements: list[str] = field(default_factory=list)
    extractor: str = "rules"

    @property
    def verified(self) -> bool:
        """Deterministic fallback: any discarded claim, internal conflict, extractor
        disagreement or injection attempt makes the vendor 'unverified', which floors
        its score at High."""
        return not (self.discarded or self.conflicts or self.disagreements or self.injection_flags)

    def verification_notes(self) -> list[str]:
        notes = [f"Claim for '{c.field}' had no exact match in the policy and was discarded" for c in self.discarded]
        notes += [f"Policy makes conflicting statements about '{f}'" for f in self.conflicts]
        notes += [f"Gemini and the rule-based extractor disagree on '{f}'" for f in self.disagreements]
        if self.injection_flags:
            notes.append(f"{len(self.injection_flags)} sentence(s) read as instructions to an AI reviewer")
        return notes

    def evidence_dicts(self) -> list[dict]:
        return [{"field": c.field, "value": c.value, "quote": c.quote} for c in self.evidence]


def normalise(text: str) -> str:
    """NFKC-normalise, drop control and zero-width characters, collapse whitespace.

    Zero-width and control characters are a common way to hide instructions in
    web pages; removing them before screening closes that gap.
    """
    text = unicodedata.normalize("NFKC", text)
    text = "".join(
        ch for ch in text
        if ch in "\n\t" or (unicodedata.category(ch) not in {"Cc", "Cf"})
    )
    return re.sub(r"\s+", " ", text).strip()


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def screen_injection(sentences: list[str]) -> tuple[list[str], list[str]]:
    """Return (clean_sentences, flagged_sentences)."""
    clean, flagged = [], []
    for s in sentences:
        (flagged if any(p.search(s) for p in _INJECTION_PATTERNS) else clean).append(s)
    return clean, flagged


def _quote(sentence: str) -> str:
    return sentence if len(sentence) <= MAX_QUOTE_CHARS else sentence[: MAX_QUOTE_CHARS - 1] + "…"


def _clauses(sentence: str) -> list[str]:
    return [c.strip() for c in _CLAUSE_BREAK.split(sentence) if c.strip()]


def _first(sentences: list[str], pattern: re.Pattern[str]) -> str | None:
    for s in sentences:
        if pattern.search(s):
            return s
    return None


def _first_with_clause(sentences: list[str], pattern: re.Pattern[str]) -> str | None:
    """The first sentence with a single clause matching ``pattern``."""
    for s in sentences:
        if any(pattern.search(c) for c in _clauses(s)):
            return s
    return None


def _days(amount: str, unit: str) -> int:
    return int(amount) * _UNIT_DAYS[unit.lower().rstrip("s")]


def _retention_buckets(sentences: list[str]) -> set[str]:
    buckets = set()
    for s in sentences:
        if _RETENTION_INDEFINITE.search(s):
            buckets.add("indefinite")
        if _RETENTION_PERIOD.search(s):
            buckets.update(_retention_bucket(str(_days(a, u))) for a, u in _DURATION.findall(s))
    return buckets


def _stated_locations(sentences: list[str]) -> set[str]:
    return {
        code
        for s in sentences if _LOCATION_CONTEXT.search(s)
        for code, pattern in _LOCATIONS if pattern.search(s)
    }


_CONFLICT_CHECKS = (
    ("trains_on_inputs", _TRAIN_NO, (_TRAIN_YES, _TRAIN_YES_ALT)),
    ("third_party_sharing", _SHARING_NO, (_SHARING_YES,)),
    ("opt_out", _OPT_OUT_NO, (_OPT_OUT_YES,)),
)


def find_conflicts(sentences: list[str]) -> list[str]:
    """A yes/no field conflicts when one clause says yes and a DIFFERENT clause says no.
    Retention conflicts on periods in different scoring buckets, location on more than one region.
    """
    clauses = [c for s in sentences for c in _clauses(s)]
    conflicts = []
    for name, negative, positives in _CONFLICT_CHECKS:
        neg = {c for c in clauses if negative.search(c)}
        pos = {c for c in clauses for p in positives if p.search(c)} - neg
        if neg and pos:
            conflicts.append(name)
    if len(_retention_buckets(sentences)) > 1:
        conflicts.append("retention")
    if len(_stated_locations(sentences)) > 1:
        conflicts.append("data_location")
    return conflicts


def _extract_raw(sentences: list[str]) -> list[Claim]:
    claims: list[Claim] = []

    if (s := _first_with_clause(sentences, _TRAIN_NO)) is not None:
        claims.append(Claim("trains_on_inputs", "no", _quote(s)))
    elif (s := _first(sentences, _TRAIN_YES) or _first(sentences, _TRAIN_YES_ALT)) is not None:
        claims.append(Claim("trains_on_inputs", "yes", _quote(s)))

    if (s := _first(sentences, _RETENTION_INDEFINITE)) is not None:
        claims.append(Claim("retention", "indefinite", _quote(s)))
    else:
        for s in sentences:
            m = _RETENTION_PERIOD.search(s)
            if m:
                claims.append(Claim("retention", str(_days(m.group(1), m.group(2))), _quote(s)))
                break

    for s in sentences:
        if not _LOCATION_CONTEXT.search(s):
            continue
        for code, pattern in _LOCATIONS:
            if pattern.search(s):
                claims.append(Claim("data_location", code, _quote(s)))
                break
        else:
            continue
        break

    if (s := _first_with_clause(sentences, _SHARING_NO)) is not None:
        claims.append(Claim("third_party_sharing", "no", _quote(s)))
    elif (s := _first(sentences, _SHARING_YES)) is not None:
        claims.append(Claim("third_party_sharing", "yes", _quote(s)))

    if (s := _first_with_clause(sentences, _OPT_OUT_NO)) is not None:
        claims.append(Claim("opt_out", "no", _quote(s)))
    elif (s := _first(sentences, _OPT_OUT_YES)) is not None:
        claims.append(Claim("opt_out", "yes", _quote(s)))

    return claims


def verify_claims(claims: list[Claim], source_text: str, flagged: list[str]) -> tuple[list[Claim], list[Claim]]:
    """Keep only claims that quote one whole, unflagged sentence of the source.

    A fragment is not enough: "use your content to train our models" could come
    from a sentence that begins "We never".
    """
    flagged_set = set(flagged)
    citable = {_quote(s) for s in split_sentences(normalise(source_text)) if s not in flagged_set}
    kept, dropped = [], []
    for c in claims:
        (kept if c.quote in citable else dropped).append(c)
    return kept, dropped


def _posture_from(claims: list[Claim]) -> VendorPosture:
    values = {c.field: c.value for c in claims}
    retention = values.get("retention")
    return VendorPosture(
        trains_on_inputs=values.get("trains_on_inputs", "unknown"),  # type: ignore[arg-type]
        retention_days=int(retention) if retention and retention.isdigit() else None,
        retention_indefinite=retention == "indefinite",
        data_location=values.get("data_location", "unknown"),
        third_party_sharing=values.get("third_party_sharing", "unknown"),  # type: ignore[arg-type]
        opt_out=values.get("opt_out", "unknown"),  # type: ignore[arg-type]
    )


VALID_VALUES = {
    "trains_on_inputs": {"yes", "no"},
    "third_party_sharing": {"yes", "no"},
    "opt_out": {"yes", "no"},
    "data_location": {"MY", "SG", "EU", "US", "OTHER"},
}


def _valid_value(claim: Claim) -> bool:
    if claim.field == "retention":
        return claim.value == "indefinite" or (claim.value.isdigit() and int(claim.value) <= 36_500)
    return claim.value in VALID_VALUES.get(claim.field, set())


def _retention_bucket(value: str) -> str:
    """Retention answers agree when they land in the same scoring bucket (e.g. 360 vs 365 days)."""
    if value == "indefinite":
        return "indefinite"
    days = int(value)
    return ">365" if days > 365 else ">30" if days > 30 else "<=30"


def find_disagreements(primary: list[Claim], second_opinion: list[Claim]) -> list[str]:
    """Fields where the answers differ, or where only one extractor gave an answer.

    The quote check proves a sentence exists in the policy; it does not prove the
    sentence was interpreted correctly. A second, independent extractor catches
    a real quote paired with a wrong answer. Silence counts too: leaving out a
    risky answer lowers the score just as a wrong answer does.
    """
    ours = {c.field: c.value for c in primary}
    other = {c.field: c.value for c in second_opinion}
    out = []
    for name in [*ours, *(f for f in other if f not in ours)]:
        a, b = ours.get(name), other.get(name)
        if a is not None and b is not None and name == "retention":
            a, b = _retention_bucket(a), _retention_bucket(b)
        if a != b:
            out.append(name)
    return out


def analyse_policy(policy_text: str, llm_extractor=None) -> ExtractionResult:
    """Run screening, extraction and verification over one policy document.

    ``llm_extractor`` (optional) is a callable ``(clean_text) -> list[Claim]``,
    e.g. ``gemini.extract_claims``. Whatever it returns goes through the SAME
    quote-matching guard as the rule-based extractor; if it raises, the
    rule-based extractor is used instead.

    When the LLM is used, the rule-based extractor still runs as a second
    opinion; any field where the two verified answers differ, or only one of them
    has an answer, is recorded as a disagreement and the vendor becomes unverified.
    """
    text = normalise(policy_text[:MAX_POLICY_CHARS])
    sentences = split_sentences(text)
    clean, flagged = screen_injection(sentences)
    rule_claims = _extract_raw(clean)
    extractor = "rules"
    raw: list[Claim] | None = None
    if llm_extractor is not None:
        try:
            raw = llm_extractor(" ".join(clean))
            extractor = "gemini"
        except Exception:  # network, quota, malformed output: fall back, never fail open
            raw = None
    if raw is None:
        raw = rule_claims
    seen: set[str] = set()
    deduped, invalid = [], []
    for c in raw:
        if c.field in seen or not _valid_value(c):
            invalid.append(c)
            continue
        seen.add(c.field)
        deduped.append(c)
    kept, dropped = verify_claims(deduped, text, flagged)
    disagreements: list[str] = []
    if extractor == "gemini":
        rules_kept, _ = verify_claims(rule_claims, text, flagged)
        disagreements = find_disagreements(kept, rules_kept)
    return ExtractionResult(
        posture=_posture_from(kept),
        evidence=kept,
        injection_flags=[_quote(s) for s in flagged],
        discarded=dropped + invalid,
        conflicts=find_conflicts(clean),
        disagreements=disagreements,
        extractor=extractor,
    )

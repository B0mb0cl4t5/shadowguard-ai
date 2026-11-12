"""Request and response schemas.

OWASP A03 (Injection) / A08 (Integrity): every inbound field is validated
against a strict type, length and pattern before it reaches business logic or
the database. ``extra="forbid"`` rejects unexpected fields instead of silently
ignoring them (blocks mass-assignment style attacks).
"""

from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"
)
DEPARTMENT_RE = re.compile(r"^[A-Za-z0-9 &()'.,-]{2,80}$")
# Reserved for examples, so they belong to nobody. The demo data uses them instead of real hosts.
DOCUMENTATION_NETS = tuple(
    ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32")
)
NAT64_NET = ipaddress.ip_network("64:ff9b::/96")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TelemetryEvent(StrictModel):
    observed_at: datetime
    department: str = Field(min_length=2, max_length=80)
    user_hash: str = Field(pattern=r"^[0-9a-f]{64}$", description="SHA-256 of the user id, hashed at source")
    domain: str = Field(min_length=3, max_length=253)
    bytes_out: int = Field(default=0, ge=0, le=10_000_000_000)
    bytes_in: int = Field(default=0, ge=0, le=10_000_000_000)
    dest_ip: str | None = Field(default=None, max_length=45, description="The vendor's public address, never a client's")
    source: Literal["proxy", "dns", "firewall"] = "proxy"

    @field_validator("observed_at")
    @classmethod
    def _sane_time(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("observed_at must include a timezone offset")
        now = datetime.now(timezone.utc)
        if v > now + timedelta(minutes=5):
            raise ValueError("observed_at is in the future")
        if v < now - timedelta(days=30):
            raise ValueError("observed_at is older than 30 days")
        return v

    @field_validator("domain")
    @classmethod
    def _valid_domain(cls, v: str) -> str:
        v = v.lower().rstrip(".")
        if not HOSTNAME_RE.fullmatch(v):
            raise ValueError("domain must be a bare hostname (no scheme, path or port)")
        return v

    @field_validator("dest_ip")
    @classmethod
    def _valid_dest_ip(cls, v: str | None) -> str | None:
        """An internal address could identify a member of staff, so it is refused."""
        if v is None:
            return None
        try:
            ip = ipaddress.ip_address(v)
        except ValueError:
            raise ValueError("dest_ip must be a bare IP address (no port or hostname)") from None
        if isinstance(ip, ipaddress.IPv6Address):
            if ip.ipv4_mapped:
                ip = ip.ipv4_mapped
            elif ip.sixtofour:
                ip = ip.sixtofour
            elif ip.teredo:
                ip = ip.teredo[1]
            elif ip in NAT64_NET:
                ip = ipaddress.IPv4Address(ip.packed[-4:])
        if not any(ip in net for net in DOCUMENTATION_NETS) and (not ip.is_global or ip.is_multicast):
            raise ValueError("dest_ip must be a public address")
        return str(ip)

    @field_validator("department")
    @classmethod
    def _valid_department(cls, v: str) -> str:
        if not DEPARTMENT_RE.fullmatch(v):
            raise ValueError("department contains unsupported characters")
        return v


class TelemetryBatch(StrictModel):
    events: list[TelemetryEvent] = Field(min_length=1, max_length=1000)


class AnalyseRequest(StrictModel):
    policy_text: str | None = Field(default=None, min_length=50, max_length=200_000)
    fetch: bool = Field(default=False, description="Fetch the vendor's stored policy_url (SSRF-guarded)")
    persist: bool = Field(
        default=True,
        description="False = dry run: analyse and score the text but change nothing in the database",
    )


class RateLimitCheck(StrictModel):
    """One shared limit. The caller hashes the bucket name, so no client IP reaches the database."""

    bucket: str = Field(pattern=r"^[0-9a-f]{64}$")
    limit: int = Field(ge=1, le=1000)
    window_seconds: int = Field(ge=1, le=3600)


class RateLimitRequest(StrictModel):
    checks: list[RateLimitCheck] = Field(min_length=1, max_length=4)


class DecisionRequest(StrictModel):
    decision: Literal["approve", "reject"]
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def _printable(cls, v: str) -> str:
        # Strip control characters so the note cannot corrupt logs (log injection).
        return "".join(ch for ch in v if ch.isprintable())


class BlockProposalRequest(StrictModel):
    """An administrator proposing a block by hand. It only queues the proposal; the decision is separate."""

    department: str = Field(min_length=2, max_length=80)
    reason: str = Field(min_length=10, max_length=300)

    @field_validator("department")
    @classmethod
    def _valid_department(cls, v: str) -> str:
        if not DEPARTMENT_RE.fullmatch(v):
            raise ValueError("department contains unsupported characters")
        return v

    @field_validator("reason")
    @classmethod
    def _printable(cls, v: str) -> str:
        # The reason is stored in the action's detail and shown to the deciding admin, so it stays one clean line.
        cleaned = "".join(ch for ch in " ".join(v.split()) if ch.isprintable())
        if len(cleaned) < 10:
            raise ValueError("reason must say why, in at least 10 characters")
        return cleaned


Severity = Literal["critical", "high", "moderate", "low"]
SortKey = Literal["exposure", "users", "last_seen", "name"]

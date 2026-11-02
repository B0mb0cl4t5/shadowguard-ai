"""Request and response schemas.

OWASP A03 (Injection) / A08 (Integrity): every inbound field is validated
against a strict type, length and pattern before it reaches business logic or
the database. ``extra="forbid"`` rejects unexpected fields instead of silently
ignoring them (blocks mass-assignment style attacks).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"
)
DEPARTMENT_RE = re.compile(r"^[A-Za-z0-9 &()'.,-]{2,80}$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TelemetryEvent(StrictModel):
    observed_at: datetime
    department: str = Field(min_length=2, max_length=80)
    user_hash: str = Field(pattern=r"^[0-9a-f]{64}$", description="SHA-256 of the user id, hashed at source")
    domain: str = Field(min_length=3, max_length=253)
    bytes_out: int = Field(default=0, ge=0, le=10_000_000_000)
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


class DecisionRequest(StrictModel):
    decision: Literal["approve", "reject"]
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def _printable(cls, v: str) -> str:
        # Strip control characters so the note cannot corrupt logs (log injection).
        return "".join(ch for ch in v if ch.isprintable())


Severity = Literal["critical", "high", "moderate", "low"]
SortKey = Literal["exposure", "users", "last_seen", "name"]

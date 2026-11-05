"""Runtime configuration, read once from environment variables.

OWASP A05 (Security Misconfiguration): every setting has a safe default, and
the app refuses to start a database connection without TLS unless the host is
local. Secrets are only ever read from the environment, never from source.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache

ROLES = ("viewer", "ingest", "admin")


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(lo, min(hi, value))


def _parse_api_keys(raw: str) -> dict[str, str]:
    """Parse ``role:sha256hex,role:sha256hex`` into ``{sha256hex: role}``.

    Only SHA-256 digests of the keys live in configuration (OWASP A02
    Cryptographic Failures): a leaked environment dump does not leak usable
    keys. Malformed entries are skipped rather than trusted.
    """
    mapping: dict[str, str] = {}
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk or ":" not in chunk:
            continue
        role, digest = (part.strip() for part in chunk.split(":", 1))
        digest = digest.lower()
        if role in ROLES and re.fullmatch(r"[0-9a-f]{64}", digest):
            mapping[digest] = role
    return mapping


@dataclass(frozen=True)
class Settings:
    database_url: str
    api_keys: dict[str, str] = field(default_factory=dict)
    environment: str = "production"
    enable_docs: bool = False
    allowed_origins: tuple[str, ...] = ()
    # The dashboard's server calls with one key for every signed-in user, so this is the ceiling for
    # all of them together; the dashboard caps each user before it gets here.
    rate_limit_per_minute: int = 600
    exposure_window_days: int = 7
    trust_proxy: bool = False
    teams_webhook_url: str | None = None
    approved_regions: tuple[str, ...] = ("MY", "SG", "EU")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Read settings from environment once and cache them.

    Because the result is cached, environment variables must be set **before**
    the first import of this module. Changing ``DATABASE_URL`` (or any other
    setting) after import has no effect — this is why DB integration tests skip
    when ``TEST_DATABASE_URL`` is unset (``conftest.py`` sets it before import).
    """
    origins = tuple(
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip().startswith("https://")
    )
    webhook = os.getenv("TEAMS_WEBHOOK_URL", "").strip() or None
    if webhook and not webhook.startswith("https://"):
        webhook = None  # never send notifications over plaintext HTTP
    return Settings(
        database_url=os.getenv("DATABASE_URL", "").strip(),
        api_keys=_parse_api_keys(os.getenv("SHADOWGUARD_API_KEYS", "")),
        environment=os.getenv("SHADOWGUARD_ENV", "production").strip().lower(),
        enable_docs=_bool("ENABLE_DOCS", False),
        allowed_origins=origins,
        rate_limit_per_minute=_int("RATE_LIMIT_PER_MINUTE", 600, 10, 10_000),
        exposure_window_days=_int("EXPOSURE_WINDOW_DAYS", 7, 1, 30),
        trust_proxy=_bool("TRUST_PROXY", False),
        teams_webhook_url=webhook,
    )

"""Database connection handling.

OWASP A02 (Cryptographic Failures): connections to any non-local host must use
TLS (``sslmode=require`` or stricter). A connection string that asks for
``sslmode=disable`` against a remote host is rejected outright.

OWASP A03 (Injection): this module only opens connections. Every query in the
codebase lives in ``repository.py`` and passes values as bound parameters.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import parse_qs, urlparse

import psycopg
from psycopg.rows import dict_row

from .config import get_settings

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}
STRONG_SSL_MODES = {"require", "verify-ca", "verify-full"}


class DatabaseNotConfigured(RuntimeError):
    """Raised when DATABASE_URL is missing or unsafe."""


def validate_database_url(url: str) -> str:
    if not url:
        raise DatabaseNotConfigured("DATABASE_URL is not set")
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise DatabaseNotConfigured("DATABASE_URL must be a postgres:// URL")
    host = (parsed.hostname or "").lower()
    query = parse_qs(parsed.query)
    sslmode = (query.get("sslmode") or [""])[0].lower()
    is_local = host in LOCAL_HOSTS or host.startswith("/") or "host" in query
    if not is_local and sslmode not in STRONG_SSL_MODES:
        raise DatabaseNotConfigured("Remote databases require sslmode=require (or stricter)")
    return url


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    """Yield a connection inside a transaction; commit on success, roll back on error.

    ``prepare_threshold=None`` keeps psycopg compatible with Neon/Supabase
    poolers running PgBouncer in transaction mode.
    """
    url = validate_database_url(get_settings().database_url)
    conn = psycopg.connect(
        url,
        row_factory=dict_row,
        prepare_threshold=None,
        connect_timeout=10,
        application_name="shadowguard-api",
    )
    try:
        with conn.transaction():
            # Bound the blast radius of any slow or runaway query.
            conn.execute("SET LOCAL statement_timeout = '15s'")
            yield conn
    finally:
        conn.close()

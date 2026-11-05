"""Database connection handling.

OWASP A02 (Cryptographic Failures): connections to any non-local host must use
TLS (``sslmode=require`` or stricter). A connection string that asks for
``sslmode=disable`` against a remote host is rejected outright.

OWASP A03 (Injection): this module only opens connections. Every query in the
codebase lives in ``repository.py`` and passes values as bound parameters.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import ParseResult, parse_qs, unquote, urlparse

import psycopg
from psycopg.rows import dict_row

from . import repository as repo
from .config import get_settings

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}
STRONG_SSL_MODES = {"require", "verify-ca", "verify-full"}


class DatabaseNotConfigured(RuntimeError):
    """Raised when DATABASE_URL is missing or unsafe."""


def _connection_hosts(parsed: ParseResult, query: dict[str, list[str]]) -> list[str]:
    """Every host libpq could dial: ``host``/``hostaddr`` in the query override the URL's own."""
    override = query.get("host", []) + query.get("hostaddr", [])
    if override:
        return [h.strip().lower() for value in override for h in value.split(",")]
    authority = parsed.netloc.rpartition("@")[2]
    return [unquote(urlparse(f"//{h}").hostname or "").lower() for h in authority.split(",")]


def validate_database_url(url: str) -> str:
    if not url:
        raise DatabaseNotConfigured("DATABASE_URL is not set")
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise DatabaseNotConfigured("DATABASE_URL must be a postgres:// URL")
    query = parse_qs(parsed.query)
    sslmode = (query.get("sslmode") or [""])[0].lower()
    is_local = all(h in LOCAL_HOSTS or h.startswith("/") for h in _connection_hosts(parsed, query))
    if not is_local and sslmode not in STRONG_SSL_MODES:
        raise DatabaseNotConfigured("Remote databases require sslmode=require (or stricter)")
    return url


_after_commit: ContextVar[list[Callable[[], None]] | None] = ContextVar("after_commit", default=None)


def after_commit(callback: Callable[[], None]) -> None:
    """Run ``callback`` once the current ``get_connection`` transaction has committed, never on rollback.

    For outside calls, such as a Teams webhook, that must not hold the transaction and its
    locks open while they wait. With no ``get_connection`` in progress (a script driving the
    service on its own connection) it runs straight away.
    """
    pending = _after_commit.get()
    if pending is None:
        callback()
    else:
        pending.append(callback)


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
    callbacks: list[Callable[[], None]] = []
    token = _after_commit.set(callbacks)
    try:
        with conn.transaction():
            repo.set_statement_timeout(conn)
            yield conn
    finally:
        _after_commit.reset(token)
        conn.close()
    # Only reached when the transaction committed: an error above propagates past this.
    for callback in callbacks:
        callback()

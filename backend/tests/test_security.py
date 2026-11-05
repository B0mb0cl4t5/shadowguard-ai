"""Security tests that need no database."""

import inspect
import logging
import socket
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from conftest import ROOT, headers
from shadowguard import repository as repo
from shadowguard.config import _parse_api_keys
from shadowguard.db import DatabaseNotConfigured, validate_database_url
from shadowguard.fetcher import UnsafeURLError, html_to_text, validate_url
from shadowguard.models import DecisionRequest, TelemetryEvent
from shadowguard.pipeline import PairState, aggregate, match_domain, plan_response
from shadowguard.security import AUTH_FAILURES_PER_MINUTE
from simulate_live import is_safe_api_url

HASH = "a" * 64


def fake_resolver(addr):
    return lambda host, port, type=0: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port))]


# --- OWASP A10: SSRF ----------------------------------------------------------

@pytest.mark.parametrize("url", [
    "http://example.com/privacy",          # not https
    "https://user:pw@example.com/",        # credentials
    "https://example.com:8443/privacy",    # non-default port
    "file:///etc/passwd",
])
def test_unsafe_url_shapes_rejected(url):
    with pytest.raises(UnsafeURLError):
        validate_url(url, resolver=fake_resolver("93.184.216.34"))


@pytest.mark.parametrize("addr", ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1"])
def test_private_and_metadata_addresses_rejected(addr):
    with pytest.raises(UnsafeURLError):
        validate_url("https://vendor.example/privacy", resolver=fake_resolver(addr))


def test_public_address_allowed():
    assert validate_url("https://vendor.example/p", resolver=fake_resolver("93.184.216.34"))


def test_html_to_text_drops_scripts():
    assert "alert" not in html_to_text("<p>Policy</p><script>alert(1)</script><style>p{}</style>")


# --- OWASP A02: crypto / transport ----------------------------------------------

def test_remote_database_requires_tls():
    with pytest.raises(DatabaseNotConfigured):
        validate_database_url("postgresql://u:p@db.neon.tech/app")
    with pytest.raises(DatabaseNotConfigured):
        validate_database_url("postgresql://u:p@db.neon.tech/app?sslmode=disable")
    assert validate_database_url("postgresql://u:p@db.neon.tech/app?sslmode=require")
    assert validate_database_url("postgresql://u:p@localhost/app")


@pytest.mark.parametrize("url", [
    "postgresql://u:p@/app?host=db.neon.tech",
    "postgresql://u:p@localhost/app?host=db.neon.tech",
    "postgresql://u:p@localhost/app?hostaddr=203.0.113.5",
    "postgresql://u:p@/app?host=/var/run/postgresql&hostaddr=203.0.113.5",
    "postgresql://u:p@/app?host=localhost,db.neon.tech",
    "postgresql://u:p@localhost:5432,db.neon.tech:5432/app",
])
def test_host_overrides_cannot_skip_database_tls(url):
    with pytest.raises(DatabaseNotConfigured):
        validate_database_url(url)
    assert validate_database_url(f"{url}{'&' if '?' in url else '?'}sslmode=require")


@pytest.mark.parametrize("url", [
    "postgresql://u:p@/app?host=/var/run/postgresql",
    "postgresql://u:p@/app?host=localhost",
    "postgresql://%2Fvar%2Frun%2Fpostgresql/app",
    "postgresql://u:p@[::1]:5432/app",
    "postgresql:///app",
])
def test_local_databases_do_not_need_tls(url):
    assert validate_database_url(url)


@pytest.mark.parametrize("url", ["https://api.example.com", "http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000"])
def test_simulator_allows_https_and_local_http(url):
    assert is_safe_api_url(url)


@pytest.mark.parametrize("url", [
    "http://localhost.evil.com",
    "http://127.0.0.1.evil.com",
    "http://evil.com/localhost",
    "http://localhost@evil.com",
    "ftp://localhost",
    "http://[bad",
])
def test_simulator_refuses_plain_http_to_remote_hosts(url):
    assert not is_safe_api_url(url)


def test_api_key_config_only_accepts_sha256_digests():
    parsed = _parse_api_keys(f"admin:{HASH},viewer:not-a-hash,root:{HASH.replace('a', 'b')},bad")
    assert parsed == {HASH: "admin"}


# --- OWASP A03: input validation ------------------------------------------------

def event(**over):
    base = dict(observed_at=datetime.now(timezone.utc), department="Library", user_hash=HASH,
                domain="summarix.ai", bytes_out=10, source="proxy")
    base.update(over)
    return base


@pytest.mark.parametrize("bad", [
    {"domain": "summarix.ai'; DROP TABLE vendors;--"},
    {"domain": "https://summarix.ai/path"},
    {"user_hash": "alice@uni.edu.my"},                      # raw identity must never be stored
    {"department": "Library<script>"},
    {"observed_at": datetime.now(timezone.utc) + timedelta(hours=2)},
    {"observed_at": datetime(2026, 1, 1)},                   # naive datetime
    {"source": "smtp"},
    {"bytes_out": -1},
    {"bytes_in": -1},
    {"extra_field": "x"},                                   # mass assignment
    {"source_ip": "8.8.8.8"},                               # a client's address is never accepted
    {"dest_ip": "10.0.0.5"},                                # an internal address could identify a person
    {"dest_ip": "192.168.1.20"},
    {"dest_ip": "127.0.0.1"},
    {"dest_ip": "169.254.169.254"},
    {"dest_ip": "100.64.0.1"},
    {"dest_ip": "::ffff:10.0.0.5"},
    {"dest_ip": "fe80::1"},
    {"dest_ip": "224.0.0.1"},
    {"dest_ip": "8.8.8.8:443"},
    {"dest_ip": "summarix.ai"},
])
def test_telemetry_validation_rejects(bad):
    with pytest.raises(ValidationError):
        TelemetryEvent(**event(**bad))


@pytest.mark.parametrize("ip", ["8.8.8.8", "203.0.113.7", "2606:4700:4700::1111"])
def test_public_and_example_destination_addresses_are_accepted(ip):
    assert TelemetryEvent(**event(dest_ip=ip)).dest_ip == ip


def test_collectors_that_send_neither_new_field_keep_working():
    ev = TelemetryEvent(**event())
    assert ev.bytes_in == 0 and ev.dest_ip is None


def test_aggregate_adds_up_both_directions():
    now = datetime.now(timezone.utc)
    agg = aggregate([(now, "a", 10, 1), (now, "b", 20, 2)])
    assert (agg.bytes_out, agg.bytes_in, agg.users) == (30, 3, 2)


def test_decision_note_strips_control_characters():
    assert DecisionRequest(decision="approve", note="ok\nFAKE LOG LINE\x1b[31m").note == "okFAKE LOG LINE[31m"


# --- OWASP A01: access control (no DB needed: auth fails before any query) ----

def assert_security_headers(response):
    for name in ("Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options",
                 "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy",
                 "Cross-Origin-Resource-Policy", "X-Request-ID"):
        assert name in response.headers, name


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert_security_headers(r)


def test_early_rejections_carry_security_headers(client):
    too_big = client.post("/api/v1/telemetry", content=b"x" * 1_100_000)
    assert too_big.status_code == 413
    bad_length = client.post("/api/v1/telemetry", content=b"{}", headers={"Content-Length": "abc"})
    assert bad_length.status_code == 400
    chunked = client.post("/api/v1/telemetry", content=iter([b"{}"]))
    assert chunked.status_code == 411
    for response in (too_big, bad_length, chunked):
        assert_security_headers(response)


def test_unhandled_error_carries_security_headers(monkeypatch):
    from fastapi.testclient import TestClient

    from shadowguard.app import app

    def boom():
        raise RuntimeError("database exploded with a secret in the message")

    monkeypatch.setattr("shadowguard.app.get_connection", boom)
    r = TestClient(app, raise_server_exceptions=False).get("/api/v1/dashboard", headers=headers("viewer"))
    assert r.status_code == 500
    assert "secret" not in r.text
    assert_security_headers(r)


def test_missing_key_is_401(client):
    assert client.get("/api/v1/dashboard").status_code == 401


def test_wrong_key_is_401(client):
    assert client.get("/api/v1/dashboard", headers={"X-API-Key": "sg_admin_guess"}).status_code == 401


def test_repeated_auth_failures_lock_out_that_ip_only(client):
    attacker = {"X-Forwarded-For": "203.0.113.9"}
    for i in range(AUTH_FAILURES_PER_MINUTE):
        guess = {} if i % 2 else {"X-API-Key": f"sg_admin_guess_{i}"}   # a missing key counts as a failure too
        assert client.get("/api/v1/dashboard", headers={**attacker, **guess}).status_code == 401
    # Locked out even with a correct key, so a lucky guess cannot be confirmed.
    assert client.get("/api/v1/dashboard", headers={**attacker, "X-API-Key": "sg_admin_guess"}).status_code == 429
    assert client.get("/api/v1/dashboard", headers={**attacker, **headers("viewer")}).status_code == 429
    other = {"X-Forwarded-For": "203.0.113.10"}
    assert client.get("/api/v1/dashboard", headers={**other, "X-API-Key": "sg_admin_guess"}).status_code == 401


@pytest.mark.parametrize("sent", [{}, {"X-API-Key": "x" * 300}, {"X-API-Key": "sg_admin_guess"}])
def test_failed_key_attempts_are_logged_without_the_secret(client, caplog, sent):
    ip = "203.0.113.20"
    with caplog.at_level(logging.WARNING, logger="shadowguard.security"):
        assert client.get("/api/v1/dashboard", headers={"X-Forwarded-For": ip, **sent}).status_code == 401
    assert ip in caplog.text
    assert "sg_admin_guess" not in caplog.text and "xxxx" not in caplog.text


def test_viewer_cannot_approve(client):
    r = client.post("/api/v1/remediations/1/decision", json={"decision": "approve"}, headers=headers("viewer"))
    assert r.status_code == 403


# --- OWASP A07: shared sign-in limits -------------------------------------------

def _limits(bucket, limit=5, window=60):
    return {"checks": [{"bucket": bucket, "limit": limit, "window_seconds": window}]}


def test_shared_rate_limit_takes_only_hashed_buckets(client):
    """The dashboard server hashes bucket names, so a raw IP is refused rather than stored."""
    for bucket in ["login:m:203.0.113.5", "A" * 64, "a" * 63]:
        assert client.post("/api/v1/rate-limit", json=_limits(bucket), headers=headers("viewer")).status_code == 422
    # A window longer than an hour would outlive the pruning, so it's refused too.
    assert client.post("/api/v1/rate-limit", json=_limits(HASH, window=7200), headers=headers("viewer")).status_code == 422


def test_shared_rate_limit_needs_a_dashboard_key(client):
    assert client.post("/api/v1/rate-limit", json=_limits(HASH)).status_code == 401
    assert client.post("/api/v1/rate-limit", json=_limits(HASH), headers=headers("ingest")).status_code == 403


def test_rate_limit_table_matches_schema_and_migration():
    """The backend can create the table itself, so its copy must match the other two."""
    flat = lambda text: " ".join(text.split())
    migration = flat((ROOT / "database" / "migrations" / "003_shared_rate_limits.sql").read_text())
    schema = flat((ROOT / "database" / "schema.sql").read_text())
    statements = [flat(s) for s in repo.RATE_LIMIT_TABLE.split(";") if s.strip()]
    assert len(statements) == 2
    for statement in statements:
        assert statement in migration
        assert statement.replace(" IF NOT EXISTS", "") in schema


def test_sign_in_checks_have_their_own_request_allowance():
    """A flood of sign-in attempts must not use up the dashboard's allowance for its own data."""
    from shadowguard import security

    source = inspect.getsource(security.authenticate)
    assert 'f"auth:{group}:{ip}"' in source and 'f"key:{group}:{principal.key_fingerprint}"' in source


def test_live_feed_needs_a_key(client):
    assert client.get("/api/v1/live").status_code == 401


def test_live_feed_never_selects_the_user_hash():
    assert "user_hash" not in inspect.getsource(repo.live_feed)


def test_ingest_key_cannot_read_dashboard(client):
    assert client.get("/api/v1/dashboard", headers=headers("ingest")).status_code == 403


def test_viewer_cannot_ingest(client):
    r = client.post("/api/v1/telemetry", json={"events": [event(observed_at=datetime.now(timezone.utc).isoformat())]},
                    headers=headers("viewer"))
    assert r.status_code == 403


def test_oversized_body_rejected(client):
    r = client.post("/api/v1/telemetry", content=b"x" * 1_100_000,
                    headers={**headers("admin"), "Content-Type": "application/json"})
    assert r.status_code == 413


def test_docs_disabled_by_default(client):
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


# --- OWASP A04: insecure design ---------------------------------------------------

def test_blocking_is_never_automatic():
    now = datetime.now(timezone.utc)
    plan = plan_response("critical", approved=False, state=PairState(), now=now)
    assert plan.propose_block and plan.nudge and plan.open_ticket and plan.open_incident
    # The plan only ever PROPOSES; there is no "execute block" output at all.
    assert not hasattr(plan, "execute_block")


def test_rejected_block_not_reproposed_for_a_week():
    now = datetime.now(timezone.utc)
    state = PairState(has_open_incident=True, last_block_rejected_at=now - timedelta(days=2))
    assert not plan_response("critical", False, state, now).propose_block
    state = PairState(has_open_incident=True, last_block_rejected_at=now - timedelta(days=8))
    assert plan_response("critical", False, state, now).propose_block


def test_escalation_writes_a_fresh_ticket_but_keeps_one_incident():
    now = datetime.now(timezone.utc)
    rising = plan_response("critical", False, PairState(has_open_incident=True, previous_severity="high"), now)
    assert rising.open_ticket and not rising.open_incident  # the open incident is updated, not duplicated
    steady = plan_response("critical", False, PairState(has_open_incident=True, previous_severity="critical"), now)
    assert not steady.open_ticket
    falling = plan_response("high", False, PairState(has_open_incident=True, previous_severity="critical"), now)
    assert not falling.open_ticket


def test_rescoring_stays_on_the_requests_connection():
    # Events and policies written in this request are uncommitted, so another connection
    # (a worker thread) would score without them. Keep scoring on the caller's connection.
    from shadowguard import service

    source = inspect.getsource(service)
    assert "ThreadPoolExecutor" not in source and "get_connection" not in source


def test_domain_matching_does_not_accept_lookalikes():
    apps = {"summarix.ai": 1}
    assert match_domain("eu.api.summarix.ai", apps) == 1
    assert match_domain("notsummarix.ai", apps) is None
    assert match_domain("summarix.ai.evil.com", apps) is None

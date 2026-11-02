"""Security tests that need no database."""

import socket
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from conftest import headers
from shadowguard.config import _parse_api_keys
from shadowguard.db import DatabaseNotConfigured, validate_database_url
from shadowguard.fetcher import UnsafeURLError, html_to_text, validate_url
from shadowguard.models import DecisionRequest, TelemetryEvent
from shadowguard.pipeline import PairState, match_domain, plan_response

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
    {"extra_field": "x"},                                   # mass assignment
])
def test_telemetry_validation_rejects(bad):
    with pytest.raises(ValidationError):
        TelemetryEvent(**event(**bad))


def test_decision_note_strips_control_characters():
    assert DecisionRequest(decision="approve", note="ok\nFAKE LOG LINE\x1b[31m").note == "okFAKE LOG LINE[31m"


# --- OWASP A01: access control (no DB needed: auth fails before any query) ----

def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "Strict-Transport-Security" in r.headers


def test_missing_key_is_401(client):
    assert client.get("/api/v1/dashboard").status_code == 401


def test_wrong_key_is_401(client):
    assert client.get("/api/v1/dashboard", headers={"X-API-Key": "sg_admin_guess"}).status_code == 401


def test_viewer_cannot_approve(client):
    r = client.post("/api/v1/remediations/1/decision", json={"decision": "approve"}, headers=headers("viewer"))
    assert r.status_code == 403


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


def test_domain_matching_does_not_accept_lookalikes():
    apps = {"summarix.ai": 1}
    assert match_domain("eu.api.summarix.ai", apps) == 1
    assert match_domain("notsummarix.ai", apps) is None
    assert match_domain("summarix.ai.evil.com", apps) is None

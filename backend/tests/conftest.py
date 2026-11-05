import hashlib
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

KEYS = {
    "viewer": "sg_viewer_test_key_000000000000000000000000",
    "ingest": "sg_ingest_test_key_000000000000000000000000",
    "admin": "sg_admin_test_key_0000000000000000000000000",
}

# Settings are read once at import, so configure the environment first.
os.environ["SHADOWGUARD_API_KEYS"] = ",".join(
    f"{role}:{hashlib.sha256(k.encode()).hexdigest()}" for role, k in KEYS.items()
)
os.environ["SHADOWGUARD_ENV"] = "test"
os.environ["RATE_LIMIT_PER_MINUTE"] = "10000"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("TEAMS_WEBHOOK_URL", None)
os.environ["TRUST_PROXY"] = "true"  # Test client is the trusted proxy; X-Forwarded-For simulates client IPs
TEST_DB = os.getenv("TEST_DATABASE_URL", "")
os.environ["DATABASE_URL"] = TEST_DB


def headers(role: str) -> dict:
    return {"X-API-Key": KEYS[role]}


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from shadowguard.app import app

    return TestClient(app)


@pytest.fixture()
def seeded_db():
    """Reset the test database to schema + seed before a test that mutates it."""
    if not TEST_DB:
        pytest.skip("TEST_DATABASE_URL not set; skipping database integration tests")
    import psycopg

    with psycopg.connect(TEST_DB, autocommit=True) as conn:
        conn.execute((ROOT / "database" / "schema.sql").read_text())
        conn.execute((ROOT / "database" / "seed_data.sql").read_text())
    yield TEST_DB

"""Delete raw traffic events older than TELEMETRY_RETENTION_DAYS (default 90).

    DATABASE_URL="postgresql://...?...sslmode=require" python backend/scripts/prune_telemetry.py

The API applies the retention period by itself, at most hourly, while traffic arrives.
Run this from a scheduler (or by hand) so it also holds when no traffic comes in.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from shadowguard import repository as repo  # noqa: E402
from shadowguard.config import get_settings  # noqa: E402
from shadowguard.db import validate_database_url  # noqa: E402


def main() -> None:
    url = validate_database_url(os.getenv("DATABASE_URL", "").strip())
    days = get_settings().telemetry_retention_days
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        removed = repo.prune_telemetry(conn, days)
    print(f"Deleted {removed} traffic events older than {days} days.")


if __name__ == "__main__":
    main()

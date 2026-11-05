"""Apply database/migrations/*.sql to DATABASE_URL, keeping the data that is there.

    DATABASE_URL="postgresql://...?...sslmode=require" python backend/scripts/migrate_db.py

Each migration is safe to run twice. Use the database owner's login: the app's
least-privilege role can't change tables.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from shadowguard.db import validate_database_url  # noqa: E402


def main() -> None:
    url = validate_database_url(os.getenv("DATABASE_URL", "").strip())
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        for f in sorted((ROOT / "database" / "migrations").glob("*.sql")):
            print(f"Applying {f.relative_to(ROOT)} ...")
            conn.execute(f.read_text(encoding="utf-8"))
    print("Done.")


if __name__ == "__main__":
    main()

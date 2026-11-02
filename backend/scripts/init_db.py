"""Apply database/schema.sql and database/seed_data.sql to DATABASE_URL.

    DATABASE_URL="postgresql://...?...sslmode=require" python backend/scripts/init_db.py
    python backend/scripts/init_db.py --schema-only

WARNING: schema.sql drops and recreates every ShadowGuard table.
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
    files = [ROOT / "database" / "schema.sql"]
    if "--schema-only" not in sys.argv:
        files.append(ROOT / "database" / "seed_data.sql")
    if "--yes" not in sys.argv:
        answer = input("This DROPS and recreates all ShadowGuard tables. Type 'yes' to continue: ")
        if answer.strip().lower() != "yes":
            sys.exit("Aborted.")
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        for f in files:
            print(f"Applying {f.relative_to(ROOT)} ...")
            conn.execute(f.read_text(encoding="utf-8"))
    print("Done.")


if __name__ == "__main__":
    main()

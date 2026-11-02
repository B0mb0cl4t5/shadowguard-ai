"""Generate an API key for one role and print the line to add to SHADOWGUARD_API_KEYS.

    python backend/scripts/create_api_key.py admin
    python backend/scripts/create_api_key.py viewer
    python backend/scripts/create_api_key.py ingest

The raw key is printed ONCE. Store it in the frontend's (or the ingest job's)
environment. Only its SHA-256 digest goes into the backend's environment, so a
leaked backend config cannot be used to call the API (OWASP A02).
"""

from __future__ import annotations

import hashlib
import secrets
import sys

ROLES = ("viewer", "ingest", "admin")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ROLES:
        sys.exit(f"usage: create_api_key.py {{{'|'.join(ROLES)}}}")
    role = sys.argv[1]
    key = f"sg_{role}_{secrets.token_urlsafe(32)}"  # 256 bits of entropy
    digest = hashlib.sha256(key.encode()).hexdigest()
    print(f"\nRaw {role} key (shown once, keep it secret):\n  {key}\n")
    print("Add this entry to the backend's SHADOWGUARD_API_KEYS (comma-separated):")
    print(f"  {role}:{digest}\n")


if __name__ == "__main__":
    main()

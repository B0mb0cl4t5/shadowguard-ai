"""Stream synthetic telemetry into a running ShadowGuard API so the dashboard moves live.

    SHADOWGUARD_API_URL=https://your-backend.vercel.app \\
    SHADOWGUARD_INGEST_KEY=sg_ingest_... \\
    python backend/scripts/simulate_live.py --interval 10 --batch 25

Use --surge <domain> to push a burst of new usage for one tool (great for the
demo: watch an incident, a nudge, a risk ticket and a block proposal appear).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from demo_catalog import USAGE  # noqa: E402

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def is_safe_api_url(url: str) -> bool:
    """An API key may go to any https URL, but over plain http only to this machine."""
    try:
        parts = urlsplit(url)
        return parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOCAL_HOSTS)
    except ValueError:
        return False


def make_event(domain: str, dept: str, pool: int, rng: random.Random) -> dict:
    user = hashlib.sha256(f"{dept}|user-{rng.randint(1, pool)}".encode()).hexdigest()
    return {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "department": dept,
        "user_hash": user,
        "domain": domain,
        "bytes_out": int(rng.lognormvariate(11, 1.3)),
        "source": "proxy",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=10.0)
    ap.add_argument("--batch", type=int, default=25)
    ap.add_argument("--rounds", type=int, default=0, help="0 = run until Ctrl+C")
    ap.add_argument("--surge", help="domain to surge, e.g. paperpilot.ai")
    ap.add_argument("--surge-department", default="Examinations & Assessment")
    args = ap.parse_args()

    base = os.getenv("SHADOWGUARD_API_URL", "http://127.0.0.1:8000").rstrip("/")
    key = os.getenv("SHADOWGUARD_INGEST_KEY", "")
    if not key:
        sys.exit("Set SHADOWGUARD_INGEST_KEY (an 'ingest' or 'admin' key).")
    if not is_safe_api_url(base):
        sys.exit("Refusing to send an API key over plain http to a remote host.")

    rng = random.Random()
    weights = [u[2] for u in USAGE]
    rounds = 0
    with httpx.Client(timeout=20.0, headers={"X-API-Key": key}) as client:
        while True:
            events = []
            for _ in range(args.batch):
                domain, dept, _, pool, _, last = rng.choices(USAGE, weights=weights)[0]
                if last > 0:
                    continue  # pairs that stopped (e.g. blocked) stay quiet
                events.append(make_event(domain, dept, pool, rng))
            if args.surge:
                events += [make_event(args.surge, args.surge_department, 30, rng) for _ in range(30)]
            if not events:
                continue
            resp = client.post(f"{base}/api/v1/telemetry", json={"events": events})
            print(time.strftime("%H:%M:%S"), resp.status_code, resp.json())
            rounds += 1
            if args.rounds and rounds >= args.rounds:
                break
            time.sleep(args.interval)


if __name__ == "__main__":
    main()

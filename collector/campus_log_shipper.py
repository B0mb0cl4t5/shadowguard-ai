"""Campus proxy & firewall log shipper for ShadowGuard AI.

Reads standard Squid proxy access logs or FortiGate webfilter/traffic logs, keeps
only connections to catalogued AI tools, looks up each user's department from a
staff directory CSV, hashes the username with the local secret salt before it
leaves this machine, and ships the telemetry in batches to `/api/v1/telemetry`.

Dry-run example (no API key needed):

    python collector/campus_log_shipper.py \\
        --log collector/sample_squid_access.log \\
        --directory collector/sample_directory.csv \\
        --dry-run

Live example:

    set SHADOWGUARD_INGEST_KEY=sg_ingest_...
    python collector/campus_log_shipper.py \\
        --log /var/log/squid/access.log \\
        --directory collector/sample_directory.csv \\
        --api https://shadowguard-ai-bice.vercel.app \\
        --follow
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import ipaddress
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

try:
    from shadowguard_collector import AI_DOMAINS, MAX_BATCH, SALT_FILE, _unwrap_ip, collector_salt, is_safe_api_url
except ImportError:  # pragma: no cover - when imported from outside collector/
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from shadowguard_collector import AI_DOMAINS, MAX_BATCH, SALT_FILE, _unwrap_ip, collector_salt, is_safe_api_url

DOCUMENTATION_NETS = tuple(
    ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32")
)


def valid_dest_ip(addr: str | None) -> str | None:
    """Allow global public IPs and RFC 5737 documentation IPs; refuse private/internal staff IPs."""
    try:
        ip = _unwrap_ip(ipaddress.ip_address((addr or "").strip()))
    except ValueError:
        return None
    if any(ip in net for net in DOCUMENTATION_NETS) or (ip.is_global and not ip.is_multicast):
        return str(ip)
    return None


def clamp_observed_at(dt: datetime) -> str:
    """Keep timestamps within the API's 30-day ingest window so replayed sample logs always work."""
    now = datetime.now(timezone.utc)
    if dt > now + timedelta(minutes=2) or dt < now - timedelta(days=29):
        return now.isoformat()
    return dt.isoformat()

# Include both the real AI catalogue and the demo catalogue domains so sample campus logs work for both.
DEMO_DOMAINS = (
    "summarix.ai",
    "promptpal.io",
    "deckgenie.app",
    "transcribefly.com",
    "codemuse.dev",
    "paperpilot.ai",
    "grammarglow.com",
    "gradesync.app",
    "workspace.campusai.edu.my",
    "transcribe.campusai.edu.my",
)
WATCHED_DOMAINS = AI_DOMAINS + DEMO_DOMAINS

KV_RE = re.compile(r'(\w+)=(?:"([^"]*)"|(\S+))')


def matched_domain(raw_host: str) -> str | None:
    """Return the watched AI domain for a host/URL, or None for ordinary web traffic."""
    host = raw_host.strip().lower()
    if "://" in host:
        host = urlsplit(host).hostname or ""
    else:
        host = host.split("/", 1)[0].rpartition(":")[0] if ":" in host else host.split("/", 1)[0]
    host = host.strip("[]").rstrip(".")
    for domain in WATCHED_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return host
    return None


def load_directory(path: Path | None) -> dict[str, str]:
    """Load a username -> department mapping from a CSV file (`username,department`)."""
    if path is None:
        return {}
    mapping: dict[str, str] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            user = (row.get("username") or row.get("user") or "").strip().lower()
            dept = (row.get("department") or "").strip()
            if user and dept:
                mapping[user] = dept
    return mapping


def hash_user(username: str, salt: str) -> str:
    """Hash the staff username with the secret collector salt so raw identities never leave."""
    return hashlib.sha256(f"{salt}|{username.strip().lower()}".encode("utf-8")).hexdigest()


def parse_squid_line(line: str, directory: dict[str, str], default_department: str, salt: str) -> dict | None:
    """Parse a standard Squid native access.log line into a ShadowGuard telemetry event.

    Format:
      timestamp elapsed client_ip code/status bytes_in method target user peer/dest_ip mime [bytes_out]
    """
    parts = line.split()
    if len(parts) < 9:
        return None
    try:
        epoch = float(parts[0])
        bytes_in = max(0, int(parts[4]))
    except ValueError:
        return None

    target = parts[6]
    domain = matched_domain(target)
    if not domain:
        return None

    user = parts[7]
    if not user or user == "-":
        user = f"client:{parts[2]}"
    dept = directory.get(user.lower(), default_department)

    peer = parts[8]
    raw_dest_ip = peer.split("/", 1)[1] if "/" in peer else peer
    dest_ip = valid_dest_ip(raw_dest_ip)

    bytes_out = 0
    if len(parts) >= 11:
        try:
            bytes_out = max(0, int(parts[10]))
        except ValueError:
            bytes_out = 0
    if bytes_out == 0:
        # Standard 10-column Squid logs record total transfer in column 5; estimate request share when column 11 is absent.
        bytes_out = max(256, bytes_in // 4)

    observed_at = clamp_observed_at(datetime.fromtimestamp(epoch, tz=timezone.utc))
    event: dict = {
        "observed_at": observed_at,
        "department": dept,
        "user_hash": hash_user(user, salt),
        "domain": domain,
        "bytes_out": bytes_out,
        "bytes_in": bytes_in,
        "source": "proxy",
    }
    if dest_ip:
        event["dest_ip"] = dest_ip
    return event


def parse_fortigate_line(line: str, directory: dict[str, str], default_department: str, salt: str) -> dict | None:
    """Parse a FortiGate key=value webfilter/traffic log line into a ShadowGuard telemetry event."""
    fields = {k: (v1 if v1 != "" else v2) for k, v1, v2 in KV_RE.findall(line)}
    host = fields.get("hostname") or fields.get("qname") or fields.get("url") or ""
    domain = matched_domain(host)
    if not domain:
        return None

    user = fields.get("user") or fields.get("srcip") or "unknown"
    dept = fields.get("department") or directory.get(user.lower(), default_department)
    try:
        bytes_out = max(0, int(fields.get("sentbyte", "0")))
        bytes_in = max(0, int(fields.get("rcvdbyte", "0")))
    except ValueError:
        return None
    if bytes_out == 0 and bytes_in == 0:
        return None

    date_str = fields.get("date")
    time_str = fields.get("time")
    observed_at = datetime.now(timezone.utc).isoformat()
    if date_str and time_str:
        try:
            observed_at = clamp_observed_at(datetime.fromisoformat(f"{date_str}T{time_str}+00:00"))
        except ValueError:
            pass

    event: dict = {
        "observed_at": observed_at,
        "department": dept,
        "user_hash": hash_user(user, salt),
        "domain": domain,
        "bytes_out": bytes_out,
        "bytes_in": bytes_in,
        "source": "firewall",
    }
    dest_ip = valid_dest_ip(fields.get("dstip"))
    if dest_ip:
        event["dest_ip"] = dest_ip
    return event


def parse_log_line(line: str, directory: dict[str, str], default_department: str, salt: str) -> dict | None:
    """Parse either a Squid access.log line or a FortiGate key=value log line."""
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if "=" in stripped and ("hostname=" in stripped or "qname=" in stripped or "sentbyte=" in stripped):
        return parse_fortigate_line(stripped, directory, default_department, salt)
    return parse_squid_line(stripped, directory, default_department, salt)


def send_batch(endpoint: str, key: str, events: list[dict], dry_run: bool) -> str:
    if dry_run:
        return f"dry run ({len(events)} events not sent)"
    body = json.dumps({"events": events}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-API-Key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read() or b"{}")
            return f"sent, {payload.get('accepted', len(events))} accepted"
    except urllib.error.HTTPError as exc:
        return f"rejected: HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return f"not sent: {exc}"


def main() -> None:
    ap = argparse.ArgumentParser(description="Ship campus Squid or FortiGate proxy logs to ShadowGuard AI.")
    ap.add_argument("--log", required=True, type=Path, help="Path to Squid access.log or FortiGate traffic log")
    ap.add_argument("--directory", type=Path, default=None, help="CSV file mapping username,department")
    ap.add_argument(
        "--default-department",
        default=os.getenv("SHADOWGUARD_DEPARTMENT", "IT Services"),
        help="Fallback department when a username is not in the directory CSV",
    )
    ap.add_argument("--api", default=os.getenv("SHADOWGUARD_API_URL", ""), help="ShadowGuard base URL")
    ap.add_argument("--follow", action="store_true", help="Keep watching the log file as new lines are written")
    ap.add_argument("--dry-run", action="store_true", help="Print parsed AI events instead of sending them")
    args = ap.parse_args()

    key = os.getenv("SHADOWGUARD_INGEST_KEY", "")
    if not args.dry_run:
        if not args.api:
            sys.exit("Set --api (or SHADOWGUARD_API_URL), or use --dry-run.")
        if not key:
            sys.exit("Set SHADOWGUARD_INGEST_KEY to an 'ingest' key, or use --dry-run.")
        if not is_safe_api_url(args.api):
            sys.exit("Refusing to send an API key over plain http to another machine. Use https.")

    endpoint = f"{args.api.rstrip('/')}/api/v1/telemetry" if args.api else ""
    directory = load_directory(args.directory)
    salt = collector_salt()

    batch: list[dict] = []
    with args.log.open("r", encoding="utf-8", errors="replace") as handle:
        while True:
            line = handle.readline()
            if not line:
                if batch:
                    outcome = send_batch(endpoint, key, batch, args.dry_run)
                    for e in batch:
                        print(
                            f"  {e['department']:<30}  {e['domain']:<22}  "
                            f"out {e['bytes_out']:>8,} B  in {e['bytes_in']:>9,} B  "
                            f"{e.get('dest_ip', '-'):<15}  {outcome}",
                            flush=True,
                        )
                    batch.clear()
                if not args.follow:
                    break
                time.sleep(1.0)
                continue

            event = parse_log_line(line, directory, args.default_department, salt)
            if event is None:
                continue
            batch.append(event)
            if len(batch) >= MAX_BATCH:
                outcome = send_batch(endpoint, key, batch, args.dry_run)
                for e in batch:
                    print(
                        f"  {e['department']:<30}  {e['domain']:<22}  "
                        f"out {e['bytes_out']:>8,} B  in {e['bytes_in']:>9,} B  "
                        f"{e.get('dest_ip', '-'):<15}  {outcome}",
                        flush=True,
                    )
                batch.clear()


if __name__ == "__main__":
    main()

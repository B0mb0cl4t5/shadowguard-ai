"""ShadowGuard laptop collector: a tiny local web proxy that reports visits to AI tools.

Point a browser at it, and for every connection to a known AI tool it reports the
same metadata a university web proxy logs: which site, when, and how many bytes
went each way. It never decrypts anything. For HTTPS the browser only tells a proxy
the site name (the CONNECT line); the content stays encrypted end to end. Visits
to other sites pass straight through and are not recorded or reported.

    set SHADOWGUARD_INGEST_KEY=sg_ingest_...
    python collector/shadowguard_collector.py --api https://YOUR-SITE.vercel.app --department "Examinations & Assessment"

Then start a browser that uses it, in its own profile so your normal browsing is untouched:

    start msedge --proxy-server=127.0.0.1:8899 --user-data-dir=%TEMP%\\shadowguard-demo

--dry-run prints the events instead of sending them, and needs no key.
Standard library only: nothing to install.

The account name is sent only as a SHA-256 hash mixed with a secret salt (collector_salt),
which keeps it pseudonymous: without the salt, nobody can test names against the hash.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import hashlib
import ipaddress
import json
import os
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

# The catalogued AI tools (backend/scripts/real_catalog.py). A subdomain counts:
# chatgpt.com covers ab.chatgpt.com. A test keeps the two lists identical.
AI_DOMAINS = (
    "chatgpt.com", "chat.openai.com", "gemini.google.com", "claude.ai", "copilot.microsoft.com",
    "perplexity.ai", "grammarly.com", "quillbot.com", "otter.ai", "deepseek.com", "gamma.app",
)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
MAX_BATCH = 500
BUFFER = 64 * 1024
SALT_FILE = Path.home() / ".shadowguard" / "collector-salt"


_FALLBACK_SALT: str | None = None


def collector_salt(env=os.environ, path: Path = SALT_FILE) -> str:
    """The secret mixed into the account name before it is hashed.

    A hash of guessable values (a computer name and a username) can be reversed by trying
    names, so the hash is pseudonymous only while this stays secret. It comes from
    SHADOWGUARD_HASH_SALT, or a random value made on first run and kept in your user folder.
    It never leaves this computer.
    """
    global _FALLBACK_SALT
    if env.get("SHADOWGUARD_HASH_SALT"):
        return env["SHADOWGUARD_HASH_SALT"]
    try:
        saved = path.read_text(encoding="ascii").strip()
        if saved:
            return saved
    except OSError:
        pass
    salt = secrets.token_hex(32)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(salt, encoding="ascii")
        os.chmod(path, 0o600)  # owner only where the OS supports it; a Windows user folder is private already
    except OSError:
        if _FALLBACK_SALT is None:
            _FALLBACK_SALT = salt
        return _FALLBACK_SALT
    return salt


def ai_domain(host: str) -> str | None:
    """The catalogued domain a host belongs to, or None for every other site."""
    host = host.lower().rstrip(".")
    for domain in AI_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return host
    return None


def is_safe_api_url(url: str) -> bool:
    """An API key may go to any https URL, but over plain http only to this machine."""
    parts = urlsplit(url)
    return parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOCAL_HOSTS)


NAT64_NET = ipaddress.ip_network("64:ff9b::/96")


def _unwrap_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            return ip.ipv4_mapped
        if ip.sixtofour:
            return ip.sixtofour
        if ip.teredo:
            return ip.teredo[1]
        if ip in NAT64_NET:
            return ipaddress.IPv4Address(ip.packed[-4:])
    return ip


def public_ip(addr: str | None) -> str | None:
    try:
        ip = _unwrap_ip(ipaddress.ip_address(addr or ""))
    except ValueError:
        return None
    return str(ip) if ip.is_global and not ip.is_multicast else None


@dataclass(eq=False)  # each connection is its own record, so it can sit in a set
class Flow:
    """One open connection to an AI tool, with the bytes not yet reported."""
    host: str
    dest_ip: str | None
    out_bytes: int = 0
    in_bytes: int = 0
    closed: bool = False


class Collector:
    def __init__(self, api: str | None, key: str, department: str, user_hash: str, dry_run: bool) -> None:
        self.endpoint = f"{api.rstrip('/')}/api/v1/telemetry" if api else None
        self.key = key
        self.department = department
        self.user_hash = user_hash
        self.dry_run = dry_run
        self.flows: set[Flow] = set()
        self.pending: list[dict] = []

    # ---- proxying

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
            writer.close()
            return
        request_line = head.split(b"\r\n", 1)[0].decode("latin-1")
        try:
            method, target, _ = request_line.split(" ", 2)
        except ValueError:
            writer.close()
            return
        if method.upper() == "CONNECT":
            host, _, port_str = target.rpartition(":")
            try:
                port = int(port_str or 443)
            except ValueError:
                writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
                writer.close()
                return
            await self.tunnel(reader, writer, host.strip("[]"), port, None)
        else:
            parts = urlsplit(target)
            try:
                port = parts.port or 80
            except ValueError:
                writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
                writer.close()
                return
            if not parts.hostname:
                writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
                writer.close()
                return
            await self.tunnel(reader, writer, parts.hostname, port, head)

    async def tunnel(self, reader, writer, host: str, port: int, first: bytes | None) -> None:
        if not host or port not in (80, 443):
            writer.write(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            writer.close()
            return
        try:
            infos = await asyncio.wait_for(
                asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM),
                timeout=10,
            )
        except (OSError, asyncio.TimeoutError):
            writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            writer.close()
            return
        if not infos or not all(public_ip(info[4][0]) is not None for info in infos):
            writer.write(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            writer.close()
            return
        target_ip = infos[0][4][0]
        try:
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(target_ip, port), timeout=15)
        except (OSError, asyncio.TimeoutError):
            writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            writer.close()
            return
        domain = ai_domain(host)
        flow = None
        if domain:
            peer = up_writer.get_extra_info("peername")
            flow = Flow(host=domain, dest_ip=public_ip(peer[0] if peer else target_ip))
            self.flows.add(flow)
        if first is None:
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        else:
            up_writer.write(first)
            if flow:
                flow.out_bytes += len(first)
        await asyncio.gather(self.pipe(reader, up_writer, flow, "out"), self.pipe(up_reader, writer, flow, "in"))
        if flow:
            flow.closed = True

    @staticmethod
    async def pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter, flow: Flow | None, direction: str) -> None:
        try:
            while data := await src.read(BUFFER):
                dst.write(data)
                await dst.drain()
                if flow and direction == "out":
                    flow.out_bytes += len(data)
                elif flow:
                    flow.in_bytes += len(data)
        except (ConnectionError, OSError):
            pass
        finally:
            try:
                dst.close()
            except Exception:
                pass

    # ---- reporting

    def take_events(self) -> list[dict]:
        """Turn the bytes counted since the last report into events, one per site."""
        now = datetime.now(timezone.utc).isoformat()
        per_host: dict[str, dict] = {e["domain"]: e for e in self.pending[:MAX_BATCH]}
        self.pending.clear()
        for flow in list(self.flows):
            if flow.out_bytes or flow.in_bytes:
                if flow.host not in per_host and len(per_host) >= MAX_BATCH:
                    continue
                event = per_host.setdefault(flow.host, {
                    "observed_at": now, "department": self.department, "user_hash": self.user_hash,
                    "domain": flow.host, "bytes_out": 0, "bytes_in": 0, "source": "proxy",
                })
                event["bytes_out"] += flow.out_bytes
                event["bytes_in"] += flow.in_bytes
                if flow.dest_ip and "dest_ip" not in event:
                    event["dest_ip"] = flow.dest_ip
                flow.out_bytes = flow.in_bytes = 0
            if flow.closed:
                self.flows.discard(flow)
        return list(per_host.values())[:MAX_BATCH]

    def send(self, events: list[dict]) -> str:
        if self.dry_run:
            return "dry run, not sent"
        body = json.dumps({"events": events}).encode()
        request = urllib.request.Request(
            self.endpoint, data=body, method="POST",
            headers={"Content-Type": "application/json", "X-API-Key": self.key},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as resp:
                result = json.loads(resp.read() or b"{}")
                return f"sent, {result.get('accepted', '?')} accepted"
        except urllib.error.HTTPError as exc:
            return f"rejected: HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return f"not sent: {exc}"

    async def report_every(self, seconds: float) -> None:
        while True:
            await asyncio.sleep(seconds)
            events = self.take_events()
            if not events:
                continue
            outcome = await asyncio.to_thread(self.send, events)
            if outcome.startswith("not sent:") or outcome == "rejected: HTTP 429" or outcome.startswith("rejected: HTTP 5"):
                self.pending = events[:MAX_BATCH]
            for e in events:
                print(f"{time.strftime('%H:%M:%S')}  {e['domain']:<28} out {e['bytes_out']:>9,} B  "
                      f"in {e['bytes_in']:>10,} B  {outcome}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Report visits to AI tools from this computer to ShadowGuard.")
    ap.add_argument("--api", default=os.getenv("SHADOWGUARD_API_URL", ""), help="ShadowGuard address, e.g. https://your-site.vercel.app")
    ap.add_argument("--department", default=os.getenv("SHADOWGUARD_DEPARTMENT", "Examinations & Assessment"),
                    help="Must match a department name in ShadowGuard")
    ap.add_argument("--listen", default="127.0.0.1:8899", help="Address for the browser's proxy setting (this computer only)")
    ap.add_argument("--every", type=float, default=5.0, help="Seconds between reports")
    ap.add_argument("--dry-run", action="store_true", help="Print events instead of sending them")
    args = ap.parse_args()

    key = os.getenv("SHADOWGUARD_INGEST_KEY", "")
    if not args.dry_run:
        if not args.api:
            sys.exit("Set --api (or SHADOWGUARD_API_URL), or use --dry-run.")
        if not key:
            sys.exit("Set SHADOWGUARD_INGEST_KEY to an 'ingest' key, or use --dry-run.")
        if not is_safe_api_url(args.api):
            sys.exit("Refusing to send an API key over plain http to another machine. Use https.")

    host, _, port = args.listen.rpartition(":")
    if host not in LOCAL_HOSTS:
        sys.exit("Listen on this computer only (127.0.0.1), so nobody else can use the proxy.")

    # The account name is hashed here with a secret salt, before anything leaves this computer.
    user_hash = hashlib.sha256(f"{collector_salt()}|{getpass.getuser()}".encode()).hexdigest()

    collector = Collector(args.api or None, key, args.department, user_hash, args.dry_run)

    async def run() -> None:
        server = await asyncio.start_server(collector.handle, host, int(port))
        print(f"ShadowGuard collector listening on {args.listen}. Department: {args.department}. "
              f"{'Dry run: nothing is sent.' if args.dry_run else 'Reporting to ' + args.api}", flush=True)
        print("Watching: " + ", ".join(AI_DOMAINS), flush=True)
        if not os.getenv("SHADOWGUARD_HASH_SALT"):
            print(f"Account names are hashed with the secret salt in {SALT_FILE} (not shown, never sent).", flush=True)
        async with server:
            await asyncio.gather(server.serve_forever(), collector.report_every(args.every))

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    main()

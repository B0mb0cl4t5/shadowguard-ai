"""SSRF-hardened fetcher for vendor privacy policy pages.

OWASP A10 (Server-Side Request Forgery). Fetching a URL stored in the database
is exactly how an attacker reaches cloud metadata endpoints or internal
services, so every request goes through these checks:

* ``https`` only, default port only, no credentials in the URL.
* The hostname must resolve, and **every** resolved address must be a public
  (globally routable) IP. Loopback, private, link-local (incl. 169.254.169.254),
  CGNAT, multicast and reserved ranges are refused.
* The request connects to an address from that same check, so the name is never
  resolved twice and DNS rebinding has no second answer to swap in. TLS still
  verifies the certificate against the hostname (sent as SNI and Host).
* Every request opens a fresh connection, so a redirect to another site on the
  same CDN address can't reuse a connection verified for the first site.
* Redirects are followed manually (max 3) and each hop is re-validated and re-pinned.
* The body is streamed with a 2 MB cap and a 10 s timeout.
"""

from __future__ import annotations

import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10.0
ALLOWED_CONTENT_TYPES = ("text/html", "text/plain", "application/xhtml+xml")


class UnsafeURLError(ValueError):
    """The URL failed SSRF validation."""


class FetchError(RuntimeError):
    """The page could not be fetched safely."""


def _is_public(addr: str) -> bool:
    ip = ipaddress.ip_address(addr)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _public_addresses(url: str, resolver=None) -> tuple[str, list[str]]:
    """The URL's hostname and every address it resolves to, refused unless all are public."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise UnsafeURLError("Only https URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeURLError("Credentials in URLs are not allowed")
    if parsed.port not in (None, 443):
        raise UnsafeURLError("Only the default https port is allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")
    if resolver is None:
        resolver = socket.getaddrinfo
    try:
        infos = resolver(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeURLError("Host does not resolve") from exc
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    if not addresses or not all(_is_public(a) for a in addresses):
        raise UnsafeURLError("Host resolves to a non-public address")
    return host, addresses


def validate_url(url: str, resolver=None) -> str:
    _public_addresses(url, resolver)
    return url


def pin_url(url: str, resolver=None) -> tuple[str, str]:
    """Validate ``url`` and rewrite it to an address from that check. Returns (pinned URL, hostname)."""
    host, addresses = _public_addresses(url, resolver)
    address = addresses[0]
    netloc = f"[{address}]" if ":" in address else address
    return urlunparse(urlparse(url)._replace(netloc=netloc)), host


class _TextExtractor(HTMLParser):
    _SKIP = {"script", "style", "noscript", "template", "svg", "head"}
    _BLOCK = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "tr", "article"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._depth += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._depth:
            self._depth -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._depth:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)


def fetch_policy_text(url: str, client: httpx.Client | None = None, resolver=None) -> str:
    own_client = client is None
    client = client or httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=False,
        # No keep-alive: each request does its own TLS handshake against its own hostname.
        limits=httpx.Limits(max_keepalive_connections=0),
        headers={"User-Agent": "ShadowGuard-PolicyReader/1.0 (+policy review bot)"},
    )
    try:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            target, host = pin_url(current, resolver)
            # Connect to the checked address; the hostname goes in SNI (so TLS verifies the
            # certificate for it) and in Host (so the server knows which site is meant).
            with client.stream("GET", target, headers={"Host": host}, extensions={"sni_hostname": host}) as resp:
                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("location")
                    if not location:
                        raise FetchError("Redirect without a Location header")
                    current = urljoin(current, location)
                    continue
                if resp.status_code != 200:
                    raise FetchError(f"Upstream returned HTTP {resp.status_code}")
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if ctype not in ALLOWED_CONTENT_TYPES:
                    raise FetchError("Unsupported content type")
                body = bytearray()
                for chunk in resp.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise FetchError("Policy page is larger than 2 MB")
                text = body.decode(resp.encoding or "utf-8", errors="replace")
                return html_to_text(text) if ctype != "text/plain" else text
        raise FetchError("Too many redirects")
    except httpx.HTTPError as exc:
        raise FetchError("Network error while fetching the policy") from exc
    finally:
        if own_client:
            client.close()

"""Fetcher tests: SSRF validation, DNS-rebinding pinning, and encoding fallback."""

import inspect
import socket
from unittest.mock import patch

import httpx
import pytest

from shadowguard import fetcher
from shadowguard.fetcher import (
    FetchError,
    UnsafeURLError,
    fetch_policy_text,
    pin_url,
    validate_url,
)


def fake_resolver(addr):
    return lambda host, port, type=0: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port))]


PUBLIC_ADDR = "93.184.216.34"
OTHER_PUBLIC_ADDR = "151.101.1.69"


def recording_client(responses):
    """An httpx client that answers from ``responses`` in order and records each request."""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return responses[len(seen) - 1]

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False), seen


# --- OWASP A10: SSRF ----------------------------------------------------------

def test_dns_rebinding_cannot_redirect_the_request():
    """A rebinding resolver answers public for the check, then private. The fetch must
    connect to the address it checked, never resolving the name a second time."""
    calls = []

    def rebinding(host, port, type=0):
        calls.append(host)
        addr = PUBLIC_ADDR if len(calls) == 1 else "169.254.169.254"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port))]

    client, seen = recording_client([httpx.Response(200, headers={"content-type": "text/plain"}, text="Policy text.")])
    assert fetch_policy_text("https://vendor.example/privacy", client=client, resolver=rebinding) == "Policy text."
    assert len(calls) == 1
    request = seen[0]
    assert request.url.host == PUBLIC_ADDR
    assert request.url.path == "/privacy"
    # TLS checks the certificate for the hostname, and the server is told which site is meant.
    assert request.extensions["sni_hostname"] == "vendor.example"
    assert request.headers["host"] == "vendor.example"


def test_each_redirect_is_rechecked_and_repinned():
    def resolver(host, port, type=0):
        addr = {"vendor.example": PUBLIC_ADDR, "cdn.example": OTHER_PUBLIC_ADDR}.get(host, "10.0.0.7")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port))]

    client, seen = recording_client([
        httpx.Response(302, headers={"location": "https://cdn.example/legal/privacy"}),
        httpx.Response(200, headers={"content-type": "text/plain"}, text="Moved policy."),
    ])
    assert fetch_policy_text("https://vendor.example/privacy", client=client, resolver=resolver) == "Moved policy."
    assert [r.url.host for r in seen] == [PUBLIC_ADDR, OTHER_PUBLIC_ADDR]
    assert seen[1].extensions["sni_hostname"] == "cdn.example"

    # A redirect into a private network is refused before any connection is made to it.
    client, seen = recording_client([httpx.Response(302, headers={"location": "https://internal.example/admin"})])
    with pytest.raises(UnsafeURLError):
        fetch_policy_text("https://vendor.example/privacy", client=client, resolver=resolver)
    assert len(seen) == 1


def test_pin_url_keeps_the_path_and_brackets_ipv6():
    assert pin_url("https://vendor.example/a/b?x=1", resolver=fake_resolver(PUBLIC_ADDR)) == (f"https://{PUBLIC_ADDR}/a/b?x=1", "vendor.example")
    v6 = "2606:4700:4700::1111"
    assert pin_url("https://vendor.example/p", resolver=fake_resolver(v6))[0] == f"https://[{v6}]/p"


def test_every_request_gets_its_own_tls_handshake():
    """No keep-alive, so a redirect to another site on the same CDN address can't reuse a
    connection whose certificate was checked for the first site."""
    assert "max_keepalive_connections=0" in inspect.getsource(fetcher.fetch_policy_text)


def test_private_and_metadata_addresses_rejected():
    for addr in ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1"]:
        with pytest.raises(UnsafeURLError):
            validate_url("https://vendor.example/privacy", resolver=fake_resolver(addr))


def test_public_address_allowed():
    assert validate_url("https://vendor.example/p", resolver=fake_resolver(PUBLIC_ADDR))


# --- encoding fallback ---------------------------------------------------------

def test_fetch_policy_text_uses_utf8_when_encoding_is_none():
    """``resp.encoding`` may be ``None``; fall back to UTF-8 instead of crashing."""
    class FakeResp:
        status_code = 200
        headers = {"content-type": "text/html"}
        encoding = None

        def iter_bytes(self):
            yield b"<p>Policy text.</p>"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeClient:
        def stream(self, method, url, **kwargs):
            return FakeResp()

    with patch("shadowguard.fetcher.socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_ADDR, 443))]):
        text = fetch_policy_text("https://vendor.example/p", client=FakeClient())
    assert text == "\nPolicy text.\n"


def test_fetch_policy_text_uses_declared_encoding():
    class FakeResp:
        status_code = 200
        headers = {"content-type": "text/html; charset=iso-8859-1"}
        encoding = "iso-8859-1"

        def iter_bytes(self):
            yield b"<p>Policy text.</p>"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeClient:
        def stream(self, method, url, **kwargs):
            return FakeResp()

    with patch("shadowguard.fetcher.socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_ADDR, 443))]):
        text = fetch_policy_text("https://vendor.example/p", client=FakeClient())
    assert text == "\nPolicy text.\n"

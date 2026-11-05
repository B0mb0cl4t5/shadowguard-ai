"""Fetcher tests: SSRF validation, DNS-rebinding TOCTOU, and encoding fallback."""

import socket
from unittest.mock import patch

import pytest

from shadowguard.fetcher import (
    FetchError,
    UnsafeURLError,
    fetch_policy_text,
    validate_url,
)


def fake_resolver(addr):
    return lambda host, port, type=0: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port))]


PUBLIC_ADDR = "93.184.216.34"


# --- OWASP A10: SSRF ----------------------------------------------------------

def test_dns_rebinding_toctou_is_documented():
    """``validate_url`` resolves once; httpx may resolve again later.

    A rebinding resolver returns a public address for ``validate_url``'s check
    but a private address on httpx's own resolution. The single resolution in
    ``validate_url`` cannot catch this, which is why production must route the
    fetcher through an egress proxy that enforces the same allow-list at the
    network layer. See DEPLOYMENT.md.
    """
    calls = []

    def rebinding(host, port, type=0):
        calls.append(host)
        # First call (validate_url): public address. Second call (httpx): private.
        addr = PUBLIC_ADDR if len(calls) == 1 else "169.254.169.254"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, port))]

    # validate_url passes because it only sees the first (public) resolution.
    assert validate_url("https://vendor.example/privacy", resolver=rebinding)
    assert len(calls) == 1


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
        def stream(self, method, url):
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
        def stream(self, method, url):
            return FakeResp()

    with patch("shadowguard.fetcher.socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_ADDR, 443))]):
        text = fetch_policy_text("https://vendor.example/p", client=FakeClient())
    assert text == "\nPolicy text.\n"

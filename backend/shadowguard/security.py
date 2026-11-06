"""Authentication, authorisation, rate limiting and HTTP hardening.

OWASP A01 (Broken Access Control)
    Every route declares the role it needs through ``require_role``. Roles are
    ordered viewer < ingest < admin is NOT assumed: each route lists exactly
    which roles may call it, so an ``ingest`` key can push telemetry but can
    never approve a block, and a ``viewer`` key is read-only.

OWASP A02 (Cryptographic Failures)
    API keys are random 256-bit tokens. Only their SHA-256 digests are kept in
    configuration, and comparison uses ``hmac.compare_digest`` so response time
    does not leak how many characters matched.

OWASP A07 (Identification & Authentication Failures)
    Failed authentications are rate-limited per client and logged without the
    submitted key.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader

from .config import get_settings

log = logging.getLogger("shadowguard.security")

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

AUTH_FAILURES_PER_MINUTE = 20


@dataclass(frozen=True)
class Principal:
    role: str
    key_fingerprint: str  # first 12 hex chars of the key's SHA-256; safe to log


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _lookup(raw_key: str) -> Principal | None:
    digest = hash_key(raw_key)
    match: Principal | None = None
    # Compare against every configured digest (no early exit) so timing does
    # not reveal which entry matched.
    for stored, role in get_settings().api_keys.items():
        if hmac.compare_digest(stored, digest):
            match = Principal(role=role, key_fingerprint=digest[:12])
    return match


class SlidingWindowLimiter:
    """In-memory sliding-window limiter for API requests.

    Each warm Vercel instance has its own memory, so these limits are per instance.
    That is enough here: API keys are 256-bit random values that can't be guessed, so
    the failure lockout controls noise rather than guarding a guessable secret. The
    dashboard's password sign-in, which is guessable, uses the database-backed limit
    shared by every instance (``service.shared_rate_limit``).
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def exhausted(self, bucket: str, limit: int, window_seconds: float = 60.0) -> bool:
        """True when ``bucket`` is full. Unlike ``allow``, this records no hit."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(bucket)
            if q is None:
                return False
            while q and now - q[0] > window_seconds:
                q.popleft()
            return len(q) >= limit

    def allow(self, bucket: str, limit: int, window_seconds: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.pop(bucket, None) or deque()
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= limit:
                self._hits[bucket] = q
                return False
            q.append(now)
            self._hits[bucket] = q
            if len(self._hits) > 10_000:  # bound memory under a spray of fake clients
                for key in [k for k, v in self._hits.items() if not v or now - v[-1] > window_seconds]:
                    self._hits.pop(key, None)
                if len(self._hits) > 10_000:
                    for key in list(self._hits)[:5_000]:
                        self._hits.pop(key, None)
            return True


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    settings = get_settings()
    # Only trust X-Forwarded-For when running behind a known proxy (TRUST_PROXY=true).
    # Otherwise a client can forge the first hop and evade per-IP rate limiting.
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def _rejected_key(request: Request, ip: str) -> HTTPException:
    log.warning("Rejected API key from %s on %s", ip, request.url.path)
    limiter.allow(f"authfail:{ip}", AUTH_FAILURES_PER_MINUTE)
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid API key",
                         headers={"WWW-Authenticate": "ApiKey"})


def authenticate(request: Request, api_key: str | None = Depends(api_key_header)) -> Principal:
    settings = get_settings()
    ip = client_ip(request)
    # Shared sign-in checks count separately, so a flood of sign-in attempts against the
    # dashboard can't use up the allowance its own data requests need.
    group = "limits" if request.url.path == "/api/v1/rate-limit" else "api"
    if not limiter.allow(f"auth:{group}:{ip}", settings.rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")
    if not settings.api_keys:
        # Fail closed: an unconfigured deployment serves nothing.
        log.error("No API keys configured; rejecting request")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Service not configured")
    # Tighter bucket for failures: once full, this client gets no more guesses.
    if limiter.exhausted(f"authfail:{ip}", AUTH_FAILURES_PER_MINUTE):
        log.warning("Too many failed API key attempts from %s", ip)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")
    if not api_key or len(api_key) > 256:
        raise _rejected_key(request, ip)
    principal = _lookup(api_key)
    if principal is None:
        raise _rejected_key(request, ip)
    if not limiter.allow(f"key:{group}:{principal.key_fingerprint}", settings.rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")
    return principal


def require_role(*roles: str):
    allowed = frozenset(roles)

    def dependency(principal: Principal = Depends(authenticate)) -> Principal:
        if principal.role not in allowed:
            # 403, not 404: the caller is authenticated, just not authorised.
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role for this action")
        return principal

    return dependency


SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": "no-store",
}

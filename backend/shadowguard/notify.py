"""Outbound notifications (Microsoft Teams incoming webhook).

If TEAMS_WEBHOOK_URL is not configured the nudge is recorded as 'simulated',
which is what the hackathon demo uses. The webhook URL is a secret: it is read
from the environment, only ever sent over https, and never logged.

Called only after the database transaction has committed (``db.after_commit``),
so a slow Teams delays one response but never holds a connection or its locks.
"""

from __future__ import annotations

import logging

import httpx

from .config import get_settings

log = logging.getLogger("shadowguard.notify")


def send_nudge(text: str) -> str:
    """Return the remediation status to record: executed | simulated | failed."""
    url = get_settings().teams_webhook_url
    if not url:
        return "simulated"
    try:
        resp = httpx.post(url, json={"text": text[:1000]}, timeout=3.0, follow_redirects=False)
        if 200 <= resp.status_code < 300:
            return "executed"
        log.warning("Teams webhook returned HTTP %s", resp.status_code)
    except httpx.HTTPError:
        log.warning("Teams webhook request failed")
    return "failed"

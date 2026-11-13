"""Tamper-evident SHA-256 hash chain helpers for the audit log."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

GENESIS_HASH = "0" * 64


def canonical_ts(at: datetime | str) -> str:
    """Format a timestamp consistently in UTC with microsecond precision."""
    if isinstance(at, str):
        parsed = datetime.fromisoformat(at)
    else:
        parsed = at
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat(timespec="microseconds")


def normalize_detail(detail: Mapping[str, Any] | None) -> dict[str, Any]:
    """Round-trip detail through canonical JSON so write and read-back match."""
    raw = json.dumps(dict(detail or {}), sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def canonical_detail(detail: Mapping[str, Any] | None) -> str:
    """Serialize audit detail deterministically."""
    return json.dumps(normalize_detail(detail), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def compute_hash(
    *,
    at: datetime | str,
    actor_role: str,
    actor_key: str,
    action: str,
    target: str,
    detail: Mapping[str, Any] | None,
    prev_hash: str,
) -> str:
    """Compute SHA-256 digest binding an audit row to its predecessor."""
    payload = [
        canonical_ts(at),
        actor_role,
        actor_key,
        action,
        target,
        canonical_detail(detail),
        prev_hash,
    ]
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verify_chain(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Verify hash-chain continuity across ordered audit_log rows.

    Rows before the first hashed entry (pre-004 legacy rows with NULL hashes) are
    counted in ``legacy_unhashed`` and do not invalidate subsequent chained rows.
    Once the chain starts, any NULL hash, prev_hash mismatch, or entry_hash mismatch
    marks the chain broken and identifies ``first_broken_id``.
    """
    expected_prev = GENESIS_HASH
    checked = 0
    legacy_unhashed = 0
    hashed_started = False
    head_hash: str | None = None

    for row in rows:
        row_id = row.get("id")
        prev_hash = row.get("prev_hash")
        entry_hash = row.get("entry_hash")

        if prev_hash is None and entry_hash is None:
            if hashed_started:
                return {
                    "intact": False,
                    "checked": checked,
                    "legacy_unhashed": legacy_unhashed,
                    "first_broken_id": row_id,
                    "head_hash": head_hash,
                    "reason": "unhashed_row_after_chain_start",
                }
            legacy_unhashed += 1
            continue

        hashed_started = True
        if not prev_hash or not entry_hash:
            return {
                "intact": False,
                "checked": checked,
                "legacy_unhashed": legacy_unhashed,
                "first_broken_id": row_id,
                "head_hash": head_hash,
                "reason": "incomplete_hash_pair",
            }

        if prev_hash != expected_prev:
            return {
                "intact": False,
                "checked": checked,
                "legacy_unhashed": legacy_unhashed,
                "first_broken_id": row_id,
                "head_hash": head_hash,
                "reason": "prev_hash_mismatch",
            }

        recomputed = compute_hash(
            at=row["at"],
            actor_role=row["actor_role"],
            actor_key=row["actor_key"],
            action=row["action"],
            target=row["target"],
            detail=row.get("detail"),
            prev_hash=prev_hash,
        )
        if recomputed != entry_hash:
            return {
                "intact": False,
                "checked": checked,
                "legacy_unhashed": legacy_unhashed,
                "first_broken_id": row_id,
                "head_hash": head_hash,
                "reason": "entry_hash_mismatch",
            }

        expected_prev = entry_hash
        head_hash = entry_hash
        checked += 1

    return {
        "intact": True,
        "checked": checked,
        "legacy_unhashed": legacy_unhashed,
        "first_broken_id": None,
        "head_hash": head_hash,
        "reason": None,
    }

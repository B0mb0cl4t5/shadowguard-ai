"""Transparent, explainable risk scoring.

ShadowGuard deliberately uses a weighted rubric rather than a trained model:
there is no labelled data to train on, and every score must be explainable to
an IT officer (and disputable by a vendor). Each function returns the factors
that produced the number alongside the number itself.

Two stages:

1. ``vendor_posture`` — 0–100, how risky the vendor's data practices are,
   from the five answers the IDP stage extracts from its privacy policy.
2. ``exposure`` — 0–100, posture scaled by how sensitive the department's
   data is and how widely the tool is used there.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

Severity = Literal["critical", "high", "moderate", "low"]
TriState = Literal["yes", "no", "unknown"]

SEVERITY_ORDER: tuple[Severity, ...] = ("critical", "high", "moderate", "low")
SEVERITY_THRESHOLDS: tuple[tuple[int, Severity], ...] = ((70, "critical"), (50, "high"), (30, "moderate"))

DATA_CLASS_SENSITIVITY: dict[str, float] = {
    "student_records": 1.00,
    "staff_hr": 1.00,
    "finance": 0.95,
    "research_unpublished": 0.90,
    "general": 0.55,
}

# Usage factor saturates at this many distinct users in the window.
USAGE_SATURATION_USERS = 50


@dataclass(frozen=True)
class Factor:
    label: str
    points: float
    note: str
    max_points: float | None = None

    def as_dict(self) -> dict:
        result = {"label": self.label, "points": round(self.points, 2), "note": self.note}
        if self.max_points is not None:
            result["max_points"] = round(self.max_points, 2)
        return result


@dataclass(frozen=True)
class VendorPosture:
    trains_on_inputs: TriState = "unknown"
    retention_days: int | None = None
    retention_indefinite: bool = False
    data_location: str = "unknown"
    third_party_sharing: TriState = "unknown"
    opt_out: TriState = "unknown"


@dataclass(frozen=True)
class ScoreResult:
    score: int
    factors: list[Factor] = field(default_factory=list)

    def factors_as_dicts(self) -> list[dict]:
        return [f.as_dict() for f in self.factors]


def severity_for(score: float) -> Severity:
    for threshold, label in SEVERITY_THRESHOLDS:
        if score >= threshold:
            return label
    return "low"


UNVERIFIED_FLOOR = 50  # an unverified policy is never scored below High


def vendor_posture(p: VendorPosture, approved_regions: tuple[str, ...] = ("MY", "SG", "EU"),
                   verified: bool = True) -> ScoreResult:
    """Score a vendor's data practices. Maximum 100 points (riskiest).

    Unverified policies (a claim failed quote-matching, statements conflict, or
    the page tried to instruct the AI reviewer) are floored at High: a page
    caught doing any of this can never talk its way down to Low.
    """
    factors: list[Factor] = []

    trains = {"yes": 35, "unknown": 18, "no": 0}[p.trains_on_inputs]
    factors.append(Factor("Trains on user inputs", trains, {
        "yes": "Policy states inputs may be used to train or improve models",
        "no": "Policy states inputs are not used for training",
        "unknown": "Policy is silent on training; treated as partial risk",
    }[p.trains_on_inputs], max_points=35))

    if p.retention_indefinite:
        retention, note = 20, "Data kept indefinitely or 'as long as necessary'"
    elif p.retention_days is None:
        retention, note = 12, "No retention period stated"
    elif p.retention_days > 365:
        retention, note = 15, f"Retained for {p.retention_days} days (over a year)"
    elif p.retention_days > 30:
        retention, note = 8, f"Retained for {p.retention_days} days"
    else:
        retention, note = 0, f"Retained for {p.retention_days} days or less"
    factors.append(Factor("Data retention", retention, note, max_points=20))

    sharing = {"yes": 20, "unknown": 10, "no": 0}[p.third_party_sharing]
    factors.append(Factor("Third-party sharing", sharing, {
        "yes": "Policy permits sharing with partners or advertisers",
        "no": "Policy rules out selling or sharing data",
        "unknown": "Policy does not say whether data is shared",
    }[p.third_party_sharing], max_points=20))

    loc = p.data_location
    if loc == "MY":
        location, note = 0, "Stored in Malaysia"
    elif loc in approved_regions:
        location, note = 4, f"Stored in an approved region ({loc})"
    elif loc == "unknown":
        location, note = 10, "Storage location not stated"
    else:
        location, note = 8, f"Stored outside approved regions ({loc})"
    factors.append(Factor("Data location", location, note, max_points=10))

    opt = {"no": 15, "unknown": 8, "yes": 0}[p.opt_out]
    factors.append(Factor("Opt-out available", opt, {
        "yes": "Users or organisations can opt out of training/data use",
        "no": "Policy states users cannot opt out",
        "unknown": "No opt-out mechanism described",
    }[p.opt_out], max_points=15))

    total = sum(f.points for f in factors)
    if not verified and total < UNVERIFIED_FLOOR:
        factors.append(Factor("Unverified policy", UNVERIFIED_FLOOR - total,
                              "Verification failed; score raised to the High floor by default"))
        total = UNVERIFIED_FLOOR
    return ScoreResult(score=int(round(min(100, max(0, total)))), factors=factors)


def usage_factor(users: int) -> float:
    """0.6 at zero users, about 0.67 for one, rising to 1.0 at USAGE_SATURATION_USERS (log scale)."""
    users = max(0, users)
    ratio = math.log10(1 + users) / math.log10(1 + USAGE_SATURATION_USERS)
    return round(0.6 + 0.4 * min(1.0, ratio), 4)


def exposure(posture_score: int, sensitivity: float, users: int, approved: bool) -> ScoreResult:
    """Exposure of one department to one tool. Approved tools score zero."""
    if approved:
        return ScoreResult(0, [Factor("Approved tool", 0, "Sanctioned by IT; no shadow-AI exposure")])
    sensitivity = max(0.30, min(1.0, float(sensitivity)))
    usage = usage_factor(users)
    raw = posture_score * sensitivity * usage
    factors = [
        Factor("Vendor posture", posture_score, "From the five policy answers (0–100)"),
        Factor("Department data sensitivity", sensitivity, "Multiplier for the class of data this department holds"),
        Factor("Usage spread", usage, f"{users} distinct user(s) in the window"),
    ]
    return ScoreResult(int(round(min(100, raw))), factors)


def exposure_index(rows: list[tuple[int, int]]) -> float:
    """Organisation-wide index: event-weighted mean of (score, events) pairs."""
    total_events = sum(max(0, events) for _, events in rows)
    if total_events == 0:
        return 0.0
    weighted = sum(score * max(0, events) for score, events in rows)
    return round(weighted / total_events, 2)

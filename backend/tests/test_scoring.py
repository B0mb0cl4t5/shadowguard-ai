from shadowguard.scoring import (
    UNVERIFIED_FLOOR, VendorPosture, exposure, exposure_index, severity_for, usage_factor, vendor_posture,
)


def test_worst_vendor_scores_100():
    p = VendorPosture("yes", None, True, "unknown", "yes", "no")
    assert vendor_posture(p).score == 100


def test_best_vendor_scores_zero():
    p = VendorPosture("no", 7, False, "MY", "no", "yes")
    assert vendor_posture(p).score == 0


def test_factors_sum_to_score():
    p = VendorPosture("unknown", 400, False, "US", "unknown", "unknown")
    r = vendor_posture(p)
    assert round(sum(f.points for f in r.factors)) == r.score
    assert {f.label for f in r.factors} >= {"Trains on user inputs", "Data retention"}


def test_unverified_policy_is_floored_at_high():
    p = VendorPosture("no", 7, False, "MY", "no", "yes")
    r = vendor_posture(p, verified=False)
    assert r.score == UNVERIFIED_FLOOR
    assert severity_for(r.score) == "high"
    assert any(f.label == "Unverified policy" for f in r.factors)


def test_unverified_does_not_lower_a_higher_score():
    p = VendorPosture("yes", None, True, "US", "yes", "no")
    assert vendor_posture(p, verified=False).score == vendor_posture(p).score


def test_approved_tool_has_no_exposure():
    assert exposure(98, 1.0, 40, approved=True).score == 0


def test_exposure_scales_with_sensitivity_and_usage():
    low = exposure(80, 0.55, 2, approved=False).score
    high = exposure(80, 1.0, 40, approved=False).score
    assert high > low


def test_usage_factor_bounds():
    assert usage_factor(0) == 0.6
    assert usage_factor(1) == 0.6705
    assert usage_factor(50) == 1.0
    assert usage_factor(10_000) == 1.0


def test_severity_thresholds():
    assert [severity_for(s) for s in (70, 69, 50, 30, 29)] == ["critical", "high", "high", "moderate", "low"]


def test_exposure_index_is_event_weighted():
    assert exposure_index([(100, 1), (0, 3)]) == 25.0
    assert exposure_index([]) == 0.0

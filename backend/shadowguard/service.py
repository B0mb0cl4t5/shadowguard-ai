"""Database-backed orchestration of the four pipeline stages.

Discover (ingest_telemetry) → Read the terms (analyse_vendor)
→ Score the risk (recompute_pair) → Respond (_respond, decide_remediation)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import psycopg

from . import repository as repo
from . import gemini
from .config import get_settings
from .idp import analyse_policy
from .models import TelemetryEvent
from .notify import send_nudge
from .pipeline import (
    PairState, aggregate, incident_text, match_domain, nudge_message, plan_response, ticket_text,
)
from .scoring import VendorPosture, exposure, exposure_index, severity_for, vendor_posture


POLICY_DISPLAY_CHARS = 50_000


def recompute_pairs(conn: psycopg.Connection, pairs: list[tuple[int, int]]) -> int:
    """Rescore pairs on the caller's connection. Returns total actions created.

    Deliberately serial and on the same connection: the events or policy just written
    are still uncommitted, so a pair scored on any other connection would miss them,
    and one failure must roll the whole request back together.
    """
    return sum(recompute_pair(conn, a, d) for a, d in pairs)


class NotFound(LookupError):
    pass


class Conflict(RuntimeError):
    pass


# ------------------------------------------------------------------ stage 1: discover

def ingest_telemetry(conn: psycopg.Connection, events: list[TelemetryEvent]) -> dict[str, Any]:
    departments = repo.departments_by_name(conn)
    domains = repo.app_domain_index(conn)
    rows, touched = [], set()
    unknown_departments, unmatched = 0, 0
    for ev in events:
        dept = departments.get(ev.department.lower())
        if dept is None:
            unknown_departments += 1
            continue
        app_id = match_domain(ev.domain, domains)
        if app_id is None:
            unmatched += 1
            continue
        touched.add((app_id, dept["id"]))
        rows.append((ev.observed_at, dept["id"], ev.user_hash, ev.domain, app_id, ev.bytes_out, ev.bytes_in,
                     ev.dest_ip, ev.source))
    if rows:
        repo.insert_events(conn, rows)
    actions = recompute_pairs(conn, sorted(touched))
    if touched:
        # Today's point on the trend chart comes from the snapshot, so it moves with live traffic.
        refresh_snapshot(conn)
    return {
        "accepted": len(rows),
        "rejected_unknown_department": unknown_departments,
        "unmatched_domains": unmatched,
        "pairs_rescored": len(touched),
        "remediation_actions": actions,
    }


# ------------------------------------------------------------ stage 3 + 4: score, respond

def recompute_pair(conn: psycopg.Connection, app_id: int, department_id: int) -> int:
    """Rescore one (app, department) pair and run the response stage. Returns actions created."""
    settings = get_settings()
    ctx = repo.pair_context(conn, app_id, department_id)
    if ctx is None:
        return 0
    agg = aggregate(repo.window_rows(conn, app_id, department_id, settings.exposure_window_days))
    if agg is None:
        repo.delete_exposure(conn, app_id, department_id)
        repo.resolve_incidents(conn, app_id, department_id)
        return 0
    result = exposure(ctx["posture_score"], float(ctx["sensitivity"]), agg.users, ctx["approved"])
    severity = severity_for(result.score)
    # Read before the upsert overwrites it, so an escalation can be told apart from a repeat.
    previous_severity = repo.exposure_severity(conn, app_id, department_id)
    status = repo.upsert_exposure(conn, app_id, department_id, agg, result.score, severity,
                                  result.factors_as_dicts())
    if status != "open":
        # A human already mitigated or accepted this pair; don't re-alert on it.
        return 0
    return _respond(conn, ctx, severity, result.score, agg.users, previous_severity)


def _respond(conn: psycopg.Connection, ctx: dict, severity: str, score: int, users: int,
             previous_severity: str | None) -> int:
    app_id, dept_id = ctx["app_id"], ctx["department_id"]
    state_row = repo.pair_state(conn, app_id, dept_id)
    state = PairState(
        has_open_incident=state_row["has_open_incident"],
        last_nudge_at=state_row["last_nudge_at"],
        has_pending_block=state_row["has_pending_block"],
        last_block_rejected_at=state_row["last_block_rejected_at"],
        previous_severity=previous_severity,
    )
    plan = plan_response(severity, ctx["approved"], state, repo.now(conn))
    created = 0

    if plan.resolve_incident:
        repo.resolve_incidents(conn, app_id, dept_id)
    incident_id = repo.current_incident_id(conn, app_id, dept_id)
    if plan.open_incident:
        title, desc = incident_text(ctx["app_name"], ctx["department"], severity, score, users)
        incident_id = repo.open_incident(conn, app_id, dept_id, severity, title, desc) or incident_id
    elif incident_id is not None:
        repo.update_incident_severity(conn, incident_id, severity)

    if plan.open_ticket:
        answers = _answers(ctx)
        text = ticket_text(ctx["app_name"], ctx["department"], severity, score, users, ctx["vendor"],
                           answers, ctx["verification_status"] == "verified")
        # Recorded as 'simulated': connect your ITSM (ServiceNow / Jira SM) webhook to make it 'executed'.
        if repo.insert_remediation(conn, app_id, dept_id, incident_id, "risk_ticket", "simulated", False, text):
            created += 1
    if plan.nudge:
        text = nudge_message(ctx["app_name"], ctx["department"], users, ctx["trains_on_inputs"], ctx["alternative"])
        status = send_nudge(text)
        if repo.insert_remediation(conn, app_id, dept_id, incident_id, "nudge", status, False, text):
            created += 1
    if plan.propose_block:
        detail = (f"Proposed: block {ctx['app_name']} for {ctx['department']} at the proxy. "
                  f"Exposure {score}/100 (critical). Awaiting admin approval.")
        if repo.insert_remediation(conn, app_id, dept_id, incident_id, "block_domain",
                                   "pending_approval", True, detail):
            created += 1
    return created


def _answers(v: dict) -> dict[str, str]:
    if v["retention_indefinite"]:
        retention = "indefinite"
    elif v["retention_days"] is not None:
        retention = f"{v['retention_days']} days"
    else:
        retention = "unknown"
    return {
        "trains_on_inputs": v["trains_on_inputs"],
        "retention": retention,
        "data_location": v["data_location"],
        "third_party_sharing": v["third_party_sharing"],
        "opt_out": v["opt_out"],
    }


def refresh_snapshot(conn: psycopg.Connection) -> None:
    rows = repo.open_exposure_rows(conn)
    breakdown = repo.severity_breakdown(conn)
    repo.upsert_snapshot(conn, exposure_index(rows), sum(breakdown.values()), breakdown["critical"])


def recompute_all(conn: psycopg.Connection) -> dict[str, int]:
    pairs = repo.all_pairs(conn)
    actions = recompute_pairs(conn, pairs)
    refresh_snapshot(conn)
    return {"pairs_rescored": len(pairs), "remediation_actions": actions}


# --------------------------------------------------------------- stage 2: read the terms

def _analysis_payload(result, score) -> dict[str, Any]:
    p = result.posture
    return {
        "posture_score": score.score,
        "severity": severity_for(score.score),
        "factors": score.factors_as_dicts(),
        "answers": _answers({
            "trains_on_inputs": p.trains_on_inputs, "retention_days": p.retention_days,
            "retention_indefinite": p.retention_indefinite, "data_location": p.data_location,
            "third_party_sharing": p.third_party_sharing, "opt_out": p.opt_out,
        }),
        "evidence": result.evidence_dicts(),
        "injection_flags": result.injection_flags,
        "verification_status": "verified" if result.verified else "unverified",
        "verification_notes": result.verification_notes(),
        "extractor": result.extractor,
        "discarded_claims": len(result.discarded),
    }


def preview_policy(conn: psycopg.Connection, vendor_id: int, policy_text: str) -> dict[str, Any]:
    """Dry run for the live 'test a policy' box: full analysis and scoring, no writes."""
    if repo.vendor(conn, vendor_id) is None:
        raise NotFound("vendor")
    llm = gemini.extract_claims if gemini.is_enabled() else None
    result = analyse_policy(policy_text, llm_extractor=llm)
    score = vendor_posture(result.posture, get_settings().approved_regions, verified=result.verified)
    return {"vendor_id": vendor_id, "dry_run": True, **_analysis_payload(result, score)}


def analyse_vendor(conn: psycopg.Connection, vendor_id: int, policy_text: str) -> dict[str, Any]:
    if repo.vendor(conn, vendor_id) is None:
        raise NotFound("vendor")
    llm = gemini.extract_claims if gemini.is_enabled() else None
    result = analyse_policy(policy_text, llm_extractor=llm)
    score = vendor_posture(result.posture, get_settings().approved_regions, verified=result.verified)
    repo.update_vendor_analysis(conn, vendor_id, result.posture, score.score, result.evidence_dicts(),
                                result.injection_flags, policy_text, result.verified,
                                result.verification_notes(), result.extractor)
    repo.record_policy_version(conn, vendor_id, policy_text, score.score, result.verified)
    pairs = repo.pairs_for_vendor(conn, vendor_id)
    actions = recompute_pairs(conn, pairs)
    refresh_snapshot(conn)
    return {
        "vendor_id": vendor_id,
        "dry_run": False,
        **_analysis_payload(result, score),
        "pairs_rescored": len(pairs),
        "remediation_actions": actions,
    }


def vendor_detail(conn: psycopg.Connection, vendor_id: int) -> dict[str, Any]:
    v = repo.vendor(conn, vendor_id)
    if v is None:
        raise NotFound("vendor")
    posture = VendorPosture(
        trains_on_inputs=v["trains_on_inputs"], retention_days=v["retention_days"],
        retention_indefinite=v["retention_indefinite"], data_location=v["data_location"],
        third_party_sharing=v["third_party_sharing"], opt_out=v["opt_out"],
    )
    verified = v["verification_status"] == "verified"
    score = vendor_posture(posture, get_settings().approved_regions, verified=verified)
    return {
        "id": v["id"], "name": v["name"], "website": v["website"], "policy_url": v["policy_url"],
        "answers": _answers(v),
        "posture_score": v["posture_score"],
        "severity": severity_for(v["posture_score"]),
        "factors": score.factors_as_dicts(),
        "evidence": v["evidence"],
        "injection_flags": v["injection_flags"],
        "verification_status": v["verification_status"],
        "verification_notes": v["verification_notes"],
        "extractor": v["extractor"],
        "analyzed_at": v["analyzed_at"],
        "apps": repo.vendor_apps(conn, vendor_id),
        # Newest first. Two entries = the policy changed; the dashboard diffs them.
        "policy_history": [
            {
                "captured_at": h["captured_at"],
                "posture_score": h["posture_score"],
                "severity": severity_for(h["posture_score"]),
                "verification_status": h["verification_status"],
                "policy_text": h["policy_text"][:POLICY_DISPLAY_CHARS],
                "truncated": len(h["policy_text"]) > POLICY_DISPLAY_CHARS,
            }
            for h in repo.policy_history(conn, vendor_id, 2)
        ],
    }


def vendor_policy_source(conn: psycopg.Connection, vendor_id: int) -> tuple[str | None, str | None]:
    v = repo.vendor(conn, vendor_id)
    if v is None:
        raise NotFound("vendor")
    return v["policy_url"], v["policy_text"]


# --------------------------------------------------------------------- human decision

def decide_remediation(conn: psycopg.Connection, action_id: int, decision: str, actor: str, note: str) -> dict:
    action = repo.remediation(conn, action_id, for_update=True)
    if action is None:
        raise NotFound("remediation")
    if action["status"] != "pending_approval":
        raise Conflict("This action has already been decided")
    if decision == "approve":
        suffix = (" — APPROVED: domain added to the proxy block list "
                  "(simulated in this build; wire to the FortiGate/proxy API in production).")
        row = repo.decide_remediation(conn, action_id, "approved", actor, note, suffix)
        repo.set_exposure_status(conn, action["app_id"], action["department_id"], "mitigated")
        repo.resolve_incidents(conn, action["app_id"], action["department_id"], "mitigated")
    else:
        row = repo.decide_remediation(conn, action_id, "rejected", actor, note,
                                      " — REJECTED by admin; tool stays reachable, nudges continue.")
    if row is None:
        raise Conflict("This action has already been decided")
    refresh_snapshot(conn)
    return {"id": row["id"], "status": row["status"], "decided_at": row["decided_at"]}


# --------------------------------------------------------------------------- dashboard

def dashboard(conn: psycopg.Connection) -> dict[str, Any]:
    kpis = repo.dashboard_kpis(conn)
    index_now = exposure_index(repo.open_exposure_rows(conn))
    week_ago = repo.snapshot_on(conn, 7)
    apps = repo.shadow_apps(conn, limit=50, window_days=get_settings().exposure_window_days)
    for a in apps:
        a["severity"] = severity_for(a["max_score"])
    return {
        "generated_at": datetime.now(timezone.utc),
        "kpis": {
            "shadow_ai_apps": kpis["shadow_ai_apps"],
            "active_leak_risks": kpis["active_leak_risks"],
            "exposure_index": index_now,
            "exposure_severity": severity_for(index_now),
            "exposure_delta_7d": round(index_now - week_ago["exposure_index"], 2) if week_ago else None,
            "remediations_24h": kpis["remediations_24h"],
            "pending_approvals": kpis["pending_approvals"],
            "departments_affected": kpis["departments_affected"],
        },
        "exposure_window_days": get_settings().exposure_window_days,
        "severity_breakdown": repo.severity_breakdown(conn),
        "trend": repo.trend(conn, 14),
        "apps": apps,
        "departments": repo.department_exposure(conn),
        "remediations": repo.recent_remediations(conn, 30),
    }

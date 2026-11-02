"""Generate database/seed_data.sql from the fictional demo catalogue.

The seed is produced by the SAME code the live API runs — the IDP extractor,
the scoring rubric and the response planner — replayed day by day over 14 days
of synthetic telemetry. That keeps every number in the seed consistent with
what the API would compute.

All timestamps are written relative to NOW() / CURRENT_DATE, so the data always
looks fresh, whenever the seed is loaded.

Usage:  python backend/scripts/build_seed.py   (writes database/seed_data.sql)

Note on quoting: this build-time script turns constant demo data into SQL
literals with q() below. It never handles user input; the running API uses
bound parameters exclusively (see shadowguard/repository.py).
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from demo_catalog import (  # noqa: E402
    APPS, BACKGROUND_DOMAINS, CURRENT_POLICY_DAYS_AGO, DECISIONS, DEPARTMENTS, POLICY_HISTORY, USAGE, VENDORS,
)
from shadowguard.idp import analyse_policy  # noqa: E402
from shadowguard.pipeline import (  # noqa: E402
    PairState, aggregate, incident_text, nudge_message, plan_response, ticket_text,
)
from shadowguard.scoring import (  # noqa: E402
    DATA_CLASS_SENSITIVITY, exposure, exposure_index, severity_for, vendor_posture,
)

DAY = 86_400
HISTORY_DAYS = 14
WINDOW_DAYS = 7
EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)  # stand-in for NOW() during replay


def q(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def jq(obj) -> str:
    return q(json.dumps(obj, ensure_ascii=False)) + "::jsonb"


def ts(seconds_ago: int) -> str:
    return f"NOW() - INTERVAL '{int(seconds_ago)} seconds'"


def as_dt(seconds_ago: int) -> datetime:
    return EPOCH - timedelta(seconds=seconds_ago)


def ago(dt: datetime) -> int:
    return int((EPOCH - dt).total_seconds())


def user_hash(dept: str, k: int) -> str:
    return hashlib.sha256(f"{dept}|user-{k}".encode()).hexdigest()


@dataclass
class Remediation:
    id: int
    seconds_ago: int
    app_id: int
    dept_id: int
    incident_id: int | None
    action_type: str
    status: str
    requires_approval: bool
    detail: str
    decided_by: str | None = None
    decided_ago: int | None = None
    note: str | None = None


@dataclass
class Incident:
    id: int
    seconds_ago: int
    app_id: int
    dept_id: int
    severity: str
    title: str
    description: str
    status: str = "open"
    resolved_ago: int | None = None


@dataclass
class PairRuntime:
    status: str = "open"
    first_seen: datetime | None = None
    incident: Incident | None = None
    last_nudge: datetime | None = None
    pending_block: Remediation | None = None
    last_rejected: datetime | None = None
    exposure: dict = field(default_factory=dict)


def main() -> None:
    rng = random.Random(2026)

    dept_ids = {name: i + 1 for i, (name, _) in enumerate(DEPARTMENTS)}
    dept_class = dict(DEPARTMENTS)
    vendor_ids = {v[0]: i + 1 for i, v in enumerate(VENDORS)}
    app_ids = {a[0]: i + 1 for i, a in enumerate(APPS)}
    app_by_domain = {a[2]: a for a in APPS}

    # ---- stage 2 on every vendor policy (same extractor as the API)
    vendor_rows, posture_by_vendor, trains_by_vendor = [], {}, {}
    answers_by_vendor, verified_by_vendor = {}, {}
    for name, website, url, text in VENDORS:
        result = analyse_policy(text)
        score = vendor_posture(result.posture, verified=result.verified)
        posture_by_vendor[name] = score.score
        trains_by_vendor[name] = result.posture.trains_on_inputs
        verified_by_vendor[name] = result.verified
        p = result.posture
        answers_by_vendor[name] = {
            "trains_on_inputs": p.trains_on_inputs,
            "retention": "indefinite" if p.retention_indefinite else
                         (f"{p.retention_days} days" if p.retention_days is not None else "unknown"),
            "data_location": p.data_location,
            "third_party_sharing": p.third_party_sharing,
            "opt_out": p.opt_out,
        }
        vendor_rows.append(
            f"({vendor_ids[name]}, {q(name)}, {q(website)}, {q(url)}, {q(text)}, {q(p.trains_on_inputs)}, "
            f"{p.retention_days if p.retention_days is not None else 'NULL'}, "
            f"{'TRUE' if p.retention_indefinite else 'FALSE'}, {q(p.data_location)}, "
            f"{q(p.third_party_sharing)}, {q(p.opt_out)}, {score.score}, {jq(result.evidence_dicts())}, "
            f"{jq(result.injection_flags)}, {q('verified' if result.verified else 'unverified')}, "
            f"{jq(result.verification_notes())}, {q(result.extractor)}, "
            f"{ts(CURRENT_POLICY_DAYS_AGO.get(name, HISTORY_DAYS) * DAY + 3600)})"
        )

    # ---- policy versions: earlier texts, then the current one (scored by the same code)
    version_rows = []
    for name, _website, _url, text in VENDORS:
        history = [(d, t) for d, t in POLICY_HISTORY.get(name, [])]
        history.append((CURRENT_POLICY_DAYS_AGO.get(name, HISTORY_DAYS), text))
        for days_ago, body in sorted(history, key=lambda h: -h[0]):
            r = analyse_policy(body)
            sc = vendor_posture(r.posture, verified=r.verified).score
            digest = hashlib.sha256(body.strip().encode("utf-8")).hexdigest()
            version_rows.append(
                f"({vendor_ids[name]}, {q(body)}, {q(digest)}, {sc}, "
                f"{q('verified' if r.verified else 'unverified')}, {ts(days_ago * DAY + 3600)})"
            )

    # ---- synthetic telemetry, metadata only
    events: list[tuple[int, int, str, str, int | None, int, str]] = []  # ago, dept, user, domain, app, bytes, src
    for domain, dept, mean, pool, first_day, last_day in USAGE:
        app = app_by_domain[domain]
        for day in range(first_day, last_day - 1, -1):
            for _ in range(max(1, mean + rng.randint(-2, 2))):
                seconds_ago = day * DAY + rng.randint(60, DAY - 60)
                sub = rng.choice(["", "api.", "app.", "eu.api."]) if not app[4] else ""
                events.append((
                    seconds_ago, dept_ids[dept], user_hash(dept, rng.randint(1, pool)), sub + domain,
                    app_ids[app[0]], int(rng.lognormvariate(11, 1.3)), rng.choice(["proxy", "proxy", "dns"]),
                ))
    for day in range(HISTORY_DAYS - 1, -1, -1):
        for _ in range(rng.randint(4, 8)):
            dept = rng.choice(DEPARTMENTS)[0]
            events.append((day * DAY + rng.randint(60, DAY - 60), dept_ids[dept],
                           user_hash(dept, rng.randint(1, 12)), rng.choice(BACKGROUND_DOMAINS),
                           None, rng.randint(500, 40_000), "proxy"))
    events.sort(key=lambda e: -e[0])

    # ---- replay stages 3 and 4, one evaluation per day
    pairs = sorted({(e[4], e[1]) for e in events if e[4] is not None})
    app_meta = {app_ids[a[0]]: a for a in APPS}
    dept_name = {v: k for k, v in dept_ids.items()}
    decisions = {(app_ids[app_by_domain[d][0]], dept_ids[dep]): (dec, day, note)
                 for d, dep, dec, day, note in DECISIONS}
    runtime = {p: PairRuntime() for p in pairs}
    incidents: list[Incident] = []
    remediations: list[Remediation] = []
    snapshots: list[tuple[int, float, int, int]] = []

    for day in range(HISTORY_DAYS - 1, -1, -1):
        eval_ago = day * DAY
        now = as_dt(eval_ago)
        for idx, (app_id, dept_id) in enumerate(pairs):
            rt = runtime[(app_id, dept_id)]
            app = app_meta[app_id]
            dept = dept_name[dept_id]
            act_ago = eval_ago + 600 + idx * 420  # deterministic per-pair offset → exact 24h nudge spacing
            act_dt = as_dt(act_ago)

            # Seeded human decision on a pending block, taken at this evaluation.
            dec = decisions.get((app_id, dept_id))
            if dec and dec[1] == day and rt.pending_block is not None:
                r = rt.pending_block
                r.decided_by, r.decided_ago, r.note = "admin:seed0001", act_ago, dec[2]
                if dec[0] == "approve":
                    r.status = "approved"
                    r.detail += (" — APPROVED: domain added to the proxy block list "
                                 "(simulated in this build; wire to the FortiGate/proxy API in production).")
                    rt.status = "mitigated"
                    if rt.incident:
                        rt.incident.status, rt.incident.resolved_ago = "mitigated", act_ago
                        rt.incident = None
                else:
                    r.status = "rejected"
                    r.detail += " — REJECTED by admin; tool stays reachable, nudges continue."
                    rt.last_rejected = act_dt
                rt.pending_block = None

            window = [(as_dt(e[0]), e[2], e[5]) for e in events
                      if e[4] == app_id and e[1] == dept_id and eval_ago <= e[0] <= eval_ago + WINDOW_DAYS * DAY]
            agg = aggregate(window)
            if agg is None:
                rt.exposure = {}
                continue
            rt.first_seen = min(rt.first_seen or agg.first_seen, agg.first_seen)
            sens = DATA_CLASS_SENSITIVITY[dept_class[dept]]
            result = exposure(posture_by_vendor[app[1]], sens, agg.users, app[4])
            severity = severity_for(result.score)
            rt.exposure = {"agg": agg, "score": result.score, "severity": severity,
                           "factors": result.factors_as_dicts()}
            if rt.status != "open":
                continue

            plan = plan_response(severity, app[4], PairState(
                has_open_incident=rt.incident is not None, last_nudge_at=rt.last_nudge,
                has_pending_block=rt.pending_block is not None, last_block_rejected_at=rt.last_rejected,
            ), now)
            if plan.resolve_incident and rt.incident:
                rt.incident.status, rt.incident.resolved_ago = "mitigated", act_ago
                rt.incident = None
            if plan.open_incident:
                title, desc = incident_text(app[0], dept, severity, result.score, agg.users)
                rt.incident = Incident(len(incidents) + 1, act_ago, app_id, dept_id, severity, title, desc)
                incidents.append(rt.incident)
            elif rt.incident:
                rt.incident.severity = severity
            inc_id = rt.incident.id if rt.incident else None
            if plan.open_ticket:
                text = ticket_text(app[0], dept, severity, result.score, agg.users, app[1],
                                   answers_by_vendor[app[1]], verified_by_vendor[app[1]])
                remediations.append(Remediation(len(remediations) + 1, act_ago + 2, app_id, dept_id, inc_id,
                                                "risk_ticket", "simulated", False, text))
            if plan.nudge:
                text = nudge_message(app[0], dept, agg.users, trains_by_vendor[app[1]], app[5])
                remediations.append(Remediation(len(remediations) + 1, act_ago, app_id, dept_id, inc_id,
                                                "nudge", "simulated", False, text))
                rt.last_nudge = act_dt
            if plan.propose_block:
                detail = (f"Proposed: block {app[0]} for {dept} at the proxy. "
                          f"Exposure {result.score}/100 (critical). Awaiting admin approval.")
                rt.pending_block = Remediation(len(remediations) + 1, act_ago + 5, app_id, dept_id, inc_id,
                                               "block_domain", "pending_approval", True, detail)
                remediations.append(rt.pending_block)

        open_rows = [(rt.exposure["score"], rt.exposure["agg"].events) for (a, _), rt in runtime.items()
                     if rt.exposure and rt.status == "open" and not app_meta[a][4]]
        sev = [rt.exposure["severity"] for (a, _), rt in runtime.items()
               if rt.exposure and rt.status == "open" and not app_meta[a][4]]
        snapshots.append((day, exposure_index(open_rows), len(sev), sev.count("critical")))

    # ---- write SQL
    out: list[str] = [
        "-- =============================================================================",
        "-- ShadowGuard AI — seed data (GENERATED by backend/scripts/build_seed.py; do not hand-edit)",
        "-- Every vendor, app and domain below is FICTIONAL. Telemetry is synthetic.",
        "-- Timestamps are relative to NOW(), so the dashboard always looks live.",
        "-- Load AFTER schema.sql:  psql \"$DATABASE_URL\" -f database/seed_data.sql",
        "-- =============================================================================",
        "",
        "BEGIN;",
        "",
        "INSERT INTO departments (id, name, data_class, sensitivity) VALUES",
        ",\n".join(f"({dept_ids[n]}, {q(n)}, {q(c)}, {DATA_CLASS_SENSITIVITY[c]:.2f})" for n, c in DEPARTMENTS) + ";",
        "",
        "INSERT INTO vendors (id, name, website, policy_url, policy_text, trains_on_inputs, retention_days,",
        "    retention_indefinite, data_location, third_party_sharing, opt_out, posture_score, evidence,",
        "    injection_flags, verification_status, verification_notes, extractor, analyzed_at) VALUES",
        ",\n".join(vendor_rows) + ";",
        "",
        "INSERT INTO policy_versions (vendor_id, policy_text, text_sha256, posture_score, verification_status,",
        "    captured_at) VALUES",
        ",\n".join(version_rows) + ";",
        "",
        "INSERT INTO saas_apps (id, vendor_id, name, domain, category, is_ai, approved) VALUES",
        ",\n".join(f"({app_ids[a[0]]}, {vendor_ids[a[1]]}, {q(a[0])}, {q(a[2])}, {q(a[3])}, TRUE, "
                   f"{'TRUE' if a[4] else 'FALSE'})" for a in APPS) + ";",
    ]
    for a in APPS:
        if a[5]:
            out.append(f"UPDATE saas_apps SET approved_alternative_id = {app_ids[a[5]]} WHERE id = {app_ids[a[0]]};")

    out += ["", "INSERT INTO telemetry_events (observed_at, department_id, user_hash, domain, app_id, bytes_out, source) VALUES"]
    out.append(",\n".join(
        f"({ts(e[0])}, {e[1]}, {q(e[2])}, {q(e[3])}, {e[4] if e[4] is not None else 'NULL'}, {e[5]}, {q(e[6])})"
        for e in events) + ";")

    exp_rows = []
    for (app_id, dept_id), rt in runtime.items():
        if not rt.exposure:
            continue
        x = rt.exposure
        exp_rows.append(
            f"({app_id}, {dept_id}, {x['agg'].users}, {x['agg'].events}, {x['agg'].bytes_out}, "
            f"{ts(ago(rt.first_seen))}, {ts(ago(x['agg'].last_seen))}, {x['score']}, {q(x['severity'])}, "
            f"{jq(x['factors'])}, {q(rt.status)}, NOW())"
        )
    out += ["", "INSERT INTO app_exposure (app_id, department_id, users, events, bytes_out, first_seen, last_seen,",
            "    exposure_score, severity, factors, status, updated_at) VALUES", ",\n".join(exp_rows) + ";"]

    if incidents:
        out += ["", "INSERT INTO security_incidents (id, detected_at, app_id, department_id, severity, title,",
                "    description, status, resolved_at) VALUES"]
        out.append(",\n".join(
            f"({i.id}, {ts(i.seconds_ago)}, {i.app_id}, {i.dept_id}, {q(i.severity)}, {q(i.title)}, "
            f"{q(i.description)}, {q(i.status)}, {ts(i.resolved_ago) if i.resolved_ago is not None else 'NULL'})"
            for i in incidents) + ";")

    if remediations:
        out += ["", "INSERT INTO remediation_actions (id, created_at, app_id, department_id, incident_id,",
                "    action_type, status, requires_approval, detail, decided_by, decided_at, decision_note) VALUES"]
        out.append(",\n".join(
            f"({r.id}, {ts(r.seconds_ago)}, {r.app_id}, {r.dept_id}, "
            f"{r.incident_id if r.incident_id else 'NULL'}, {q(r.action_type)}, {q(r.status)}, "
            f"{'TRUE' if r.requires_approval else 'FALSE'}, {q(r.detail)}, {q(r.decided_by)}, "
            f"{ts(r.decided_ago) if r.decided_ago is not None else 'NULL'}, {q(r.note)})"
            for r in remediations) + ";")

    out += ["", "INSERT INTO risk_snapshots (day, exposure_index, detections, critical) VALUES"]
    out.append(",\n".join(f"(CURRENT_DATE - {d}, {idx:.2f}, {n}, {c})" for d, idx, n, c in snapshots) + ";")

    out += [
        "",
        "-- Keep sequences ahead of the explicit ids used above.",
        "SELECT setval('departments_id_seq', (SELECT MAX(id) FROM departments));",
        "SELECT setval('vendors_id_seq', (SELECT MAX(id) FROM vendors));",
        "SELECT setval('saas_apps_id_seq', (SELECT MAX(id) FROM saas_apps));",
        "SELECT setval('security_incidents_id_seq', GREATEST((SELECT MAX(id) FROM security_incidents), 1));",
        "SELECT setval('remediation_actions_id_seq', GREATEST((SELECT MAX(id) FROM remediation_actions), 1));",
        "",
        "COMMIT;",
        "",
    ]
    target = ROOT / "database" / "seed_data.sql"
    target.write_text("\n".join(out), encoding="utf-8")

    open_inc = sum(1 for i in incidents if i.status == "open")
    pending = sum(1 for r in remediations if r.status == "pending_approval")
    print(f"Wrote {target.relative_to(ROOT)}: {len(events)} events, {len(exp_rows)} exposures, "
          f"{len(incidents)} incidents ({open_inc} open), {len(remediations)} remediations ({pending} pending), "
          f"index today {snapshots[-1][1]}")


if __name__ == "__main__":
    main()

"""Every SQL statement the API runs lives in this file.

OWASP A03 (Injection) — the rules this module follows, without exception:

1. Values are NEVER formatted into SQL strings. They are passed as bound
   parameters (``%s`` / ``%(name)s``) and sent separately from the query text,
   so the database never parses user input as SQL.
2. The one piece of dynamic SQL (ORDER BY for the apps list) is chosen from a
   fixed allow-list of ``psycopg.sql.SQL`` fragments keyed by a validated enum.
   User input selects a key; it is never part of the SQL text.
3. JSON is written with ``psycopg.types.json.Jsonb`` adaptation, not string
   concatenation.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

Row = dict[str, Any]

# --------------------------------------------------------------------------- session


def set_statement_timeout(conn: psycopg.Connection) -> None:
    """Bound the blast radius of any slow or runaway query, for this transaction only."""
    conn.execute("SET LOCAL statement_timeout = '15s'")


# --------------------------------------------------------------------------- reads


def departments_by_name(conn: psycopg.Connection) -> dict[str, Row]:
    rows = conn.execute("SELECT id, name, data_class, sensitivity FROM departments").fetchall()
    return {r["name"].lower(): r for r in rows}


def app_domain_index(conn: psycopg.Connection) -> dict[str, int]:
    return {r["domain"]: r["id"] for r in conn.execute("SELECT id, domain FROM saas_apps").fetchall()}


def pair_context(conn: psycopg.Connection, app_id: int, department_id: int) -> Row | None:
    return conn.execute(
        """
        SELECT a.id AS app_id, a.name AS app_name, a.approved, a.is_ai,
               v.id AS vendor_id, v.name AS vendor, v.posture_score, v.trains_on_inputs,
               v.retention_days, v.retention_indefinite, v.data_location, v.third_party_sharing,
               v.opt_out, v.verification_status,
               d.id AS department_id, d.name AS department, d.sensitivity,
               alt.name AS alternative
          FROM saas_apps a
          JOIN vendors v       ON v.id = a.vendor_id
          JOIN departments d   ON d.id = %(dept)s
          LEFT JOIN saas_apps alt ON alt.id = a.approved_alternative_id
         WHERE a.id = %(app)s
        """,
        {"app": app_id, "dept": department_id},
    ).fetchone()


def window_rows(conn: psycopg.Connection, app_id: int, department_id: int, window_days: int) -> list[tuple]:
    rows = conn.execute(
        """
        SELECT observed_at, user_hash, bytes_out
          FROM telemetry_events
         WHERE app_id = %s AND department_id = %s
           AND observed_at >= NOW() - make_interval(days => %s)
        """,
        (app_id, department_id, window_days),
    ).fetchall()
    return [(r["observed_at"], r["user_hash"], r["bytes_out"]) for r in rows]


def pairs_for_vendor(conn: psycopg.Connection, vendor_id: int) -> list[tuple[int, int]]:
    rows = conn.execute(
        """
        SELECT DISTINCT t.app_id, t.department_id
          FROM telemetry_events t
          JOIN saas_apps a ON a.id = t.app_id
         WHERE a.vendor_id = %s
        """,
        (vendor_id,),
    ).fetchall()
    return [(r["app_id"], r["department_id"]) for r in rows]


def all_pairs(conn: psycopg.Connection) -> list[tuple[int, int]]:
    rows = conn.execute(
        "SELECT DISTINCT app_id, department_id FROM telemetry_events WHERE app_id IS NOT NULL"
    ).fetchall()
    return [(r["app_id"], r["department_id"]) for r in rows]


def pair_state(conn: psycopg.Connection, app_id: int, department_id: int) -> Row:
    return conn.execute(
        """
        SELECT
          EXISTS (SELECT 1 FROM security_incidents
                   WHERE app_id = %(a)s AND department_id = %(d)s AND status = 'open') AS has_open_incident,
          (SELECT MAX(created_at) FROM remediation_actions
            WHERE app_id = %(a)s AND department_id = %(d)s AND action_type = 'nudge') AS last_nudge_at,
          EXISTS (SELECT 1 FROM remediation_actions
                   WHERE app_id = %(a)s AND department_id = %(d)s
                     AND action_type = 'block_domain' AND status = 'pending_approval') AS has_pending_block,
          (SELECT MAX(decided_at) FROM remediation_actions
            WHERE app_id = %(a)s AND department_id = %(d)s
              AND action_type = 'block_domain' AND status = 'rejected') AS last_block_rejected_at
        """,
        {"a": app_id, "d": department_id},
    ).fetchone()


def vendor(conn: psycopg.Connection, vendor_id: int) -> Row | None:
    return conn.execute(
        """
        SELECT id, name, website, policy_url, policy_text, trains_on_inputs, retention_days,
               retention_indefinite, data_location, third_party_sharing, opt_out,
               posture_score, evidence, injection_flags, verification_status,
               verification_notes, extractor, analyzed_at
          FROM vendors WHERE id = %s
        """,
        (vendor_id,),
    ).fetchone()


def vendor_apps(conn: psycopg.Connection, vendor_id: int) -> list[Row]:
    return conn.execute(
        "SELECT id, name, domain, category, approved FROM saas_apps WHERE vendor_id = %s ORDER BY name",
        (vendor_id,),
    ).fetchall()


def remediation(conn: psycopg.Connection, action_id: int, for_update: bool = False) -> Row | None:
    query = sql.SQL(
        "SELECT id, app_id, department_id, incident_id, action_type, status, detail "
        "FROM remediation_actions WHERE id = %s"
    )
    if for_update:
        query = query + sql.SQL(" FOR UPDATE")  # fixed fragment, no user input
    return conn.execute(query, (action_id,)).fetchone()


# Allow-list for ORDER BY. Keys come from a validated Literal; values are fixed SQL.
_SORTS: dict[str, sql.Composable] = {
    "exposure": sql.SQL("max_score DESC, total_users DESC"),
    "users": sql.SQL("total_users DESC, max_score DESC"),
    "last_seen": sql.SQL("last_seen DESC"),
    "name": sql.SQL("a.name ASC"),
}


def shadow_apps(conn: psycopg.Connection, severity: str | None = None, sort: str = "exposure",
                limit: int = 100) -> list[Row]:
    order = _SORTS.get(sort, _SORTS["exposure"])
    query = sql.SQL(
        """
        SELECT a.id, a.name, a.domain, a.category, v.id AS vendor_id, v.name AS vendor,
               v.posture_score, v.trains_on_inputs, v.verification_status, alt.name AS alternative,
               CASE WHEN pv.n > 1 THEN pv.latest END   AS policy_changed_at,
               MAX(e.exposure_score)                   AS max_score,
               SUM(e.users)::int                       AS total_users,
               SUM(e.events)::int                      AS total_events,
               MIN(e.first_seen)                       AS first_seen,
               MAX(e.last_seen)                        AS last_seen,
               json_agg(json_build_object(
                   'department', d.name, 'severity', e.severity,
                   'score', e.exposure_score, 'users', e.users, 'status', e.status,
                   'factors', e.factors
               ) ORDER BY e.exposure_score DESC)       AS departments
          FROM app_exposure e
          JOIN saas_apps a     ON a.id = e.app_id
          JOIN vendors v       ON v.id = a.vendor_id
          JOIN departments d   ON d.id = e.department_id
          LEFT JOIN saas_apps alt ON alt.id = a.approved_alternative_id
          LEFT JOIN LATERAL (
                SELECT COUNT(*) AS n, MAX(captured_at) AS latest
                  FROM policy_versions WHERE vendor_id = v.id
          ) pv ON TRUE
         WHERE a.approved = FALSE AND a.is_ai = TRUE
         GROUP BY a.id, v.id, alt.name, pv.n, pv.latest
        HAVING (%(severity)s::text IS NULL OR bool_or(e.severity = %(severity)s::text))
         ORDER BY {order}
         LIMIT %(limit)s
        """
    ).format(order=order)
    return conn.execute(query, {"severity": severity, "limit": limit}).fetchall()


def dashboard_kpis(conn: psycopg.Connection) -> Row:
    return conn.execute(
        """
        SELECT
          (SELECT COUNT(DISTINCT e.app_id) FROM app_exposure e
             JOIN saas_apps a ON a.id = e.app_id
            WHERE a.approved = FALSE AND a.is_ai = TRUE)                              AS shadow_ai_apps,
          (SELECT COUNT(*) FROM security_incidents WHERE status = 'open')            AS active_leak_risks,
          (SELECT COUNT(*) FROM remediation_actions
            WHERE created_at >= NOW() - INTERVAL '24 hours')                          AS remediations_24h,
          (SELECT COUNT(*) FROM remediation_actions WHERE status = 'pending_approval') AS pending_approvals,
          (SELECT COUNT(DISTINCT department_id) FROM app_exposure)                    AS departments_affected
        """
    ).fetchone()


def open_exposure_rows(conn: psycopg.Connection) -> list[tuple[int, int]]:
    rows = conn.execute(
        """
        SELECT e.exposure_score, e.events
          FROM app_exposure e JOIN saas_apps a ON a.id = e.app_id
         WHERE a.approved = FALSE AND e.status = 'open'
        """
    ).fetchall()
    return [(r["exposure_score"], r["events"]) for r in rows]


def severity_breakdown(conn: psycopg.Connection) -> dict[str, int]:
    rows = conn.execute(
        """
        SELECT e.severity, COUNT(*)::int AS n
          FROM app_exposure e JOIN saas_apps a ON a.id = e.app_id
         WHERE a.approved = FALSE AND e.status = 'open'
         GROUP BY e.severity
        """
    ).fetchall()
    out = {"critical": 0, "high": 0, "moderate": 0, "low": 0}
    out.update({r["severity"]: r["n"] for r in rows})
    return out


def trend(conn: psycopg.Connection, days: int = 14) -> list[Row]:
    return conn.execute(
        """
        SELECT day, exposure_index::float AS exposure_index, detections, critical
          FROM risk_snapshots
         WHERE day > CURRENT_DATE - %s
         ORDER BY day
        """,
        (days,),
    ).fetchall()


def snapshot_on(conn: psycopg.Connection, days_ago: int) -> Row | None:
    return conn.execute(
        "SELECT exposure_index::float AS exposure_index FROM risk_snapshots WHERE day = CURRENT_DATE - %s",
        (days_ago,),
    ).fetchone()


def department_exposure(conn: psycopg.Connection) -> list[Row]:
    return conn.execute(
        """
        SELECT d.name, d.data_class, d.sensitivity::float AS sensitivity,
               COALESCE(MAX(e.exposure_score) FILTER (WHERE a.approved = FALSE AND e.status = 'open'), 0) AS max_score,
               COUNT(e.app_id) FILTER (WHERE a.approved = FALSE AND e.status = 'open')::int AS shadow_tools
          FROM departments d
          LEFT JOIN app_exposure e ON e.department_id = d.id
          LEFT JOIN saas_apps a    ON a.id = e.app_id
         GROUP BY d.id
         ORDER BY max_score DESC, d.name
        """
    ).fetchall()


def recent_remediations(conn: psycopg.Connection, limit: int = 30) -> list[Row]:
    return conn.execute(
        """
        SELECT r.id, r.created_at, r.action_type, r.status, r.requires_approval, r.detail,
               r.decided_by, r.decided_at, r.decision_note,
               a.name AS app, a.domain, d.name AS department
          FROM remediation_actions r
          JOIN saas_apps a   ON a.id = r.app_id
          JOIN departments d ON d.id = r.department_id
         ORDER BY (r.status = 'pending_approval') DESC, r.created_at DESC
         LIMIT %s
        """,
        (limit,),
    ).fetchall()


# -------------------------------------------------------------------------- writes


def insert_events(conn: psycopg.Connection, rows: list[tuple]) -> None:
    """rows = (observed_at, department_id, user_hash, domain, app_id, bytes_out, source)."""
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO telemetry_events
                   (observed_at, department_id, user_hash, domain, app_id, bytes_out, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )


def upsert_exposure(conn: psycopg.Connection, app_id: int, department_id: int, agg, score: int,
                    severity: str, factors: list[dict]) -> str:
    """Insert or refresh a pair's exposure; returns its status (open / mitigated / accepted)."""
    row = conn.execute(
        """
        INSERT INTO app_exposure (app_id, department_id, users, events, bytes_out, first_seen,
                                  last_seen, exposure_score, severity, factors, status, updated_at)
        VALUES (%(app)s, %(dept)s, %(users)s, %(events)s, %(bytes)s, %(first)s, %(last)s,
                %(score)s, %(sev)s, %(factors)s, 'open', NOW())
        ON CONFLICT (app_id, department_id) DO UPDATE SET
            users = EXCLUDED.users, events = EXCLUDED.events, bytes_out = EXCLUDED.bytes_out,
            first_seen = LEAST(app_exposure.first_seen, EXCLUDED.first_seen),
            last_seen = EXCLUDED.last_seen, exposure_score = EXCLUDED.exposure_score,
            severity = EXCLUDED.severity, factors = EXCLUDED.factors, updated_at = NOW()
        RETURNING status
        """,
        {
            "app": app_id, "dept": department_id, "users": agg.users, "events": agg.events,
            "bytes": agg.bytes_out, "first": agg.first_seen, "last": agg.last_seen,
            "score": score, "sev": severity, "factors": Jsonb(factors),
        },
    ).fetchone()
    return row["status"]


def delete_exposure(conn: psycopg.Connection, app_id: int, department_id: int) -> None:
    conn.execute("DELETE FROM app_exposure WHERE app_id = %s AND department_id = %s", (app_id, department_id))


def open_incident(conn: psycopg.Connection, app_id: int, department_id: int, severity: str,
                  title: str, description: str) -> int | None:
    row = conn.execute(
        """
        INSERT INTO security_incidents (app_id, department_id, severity, title, description)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (app_id, department_id) WHERE status = 'open' DO NOTHING
        RETURNING id
        """,
        (app_id, department_id, severity, title, description),
    ).fetchone()
    return row["id"] if row else None


def current_incident_id(conn: psycopg.Connection, app_id: int, department_id: int) -> int | None:
    row = conn.execute(
        "SELECT id FROM security_incidents WHERE app_id = %s AND department_id = %s AND status = 'open'",
        (app_id, department_id),
    ).fetchone()
    return row["id"] if row else None


def update_incident_severity(conn: psycopg.Connection, incident_id: int, severity: str) -> None:
    conn.execute("UPDATE security_incidents SET severity = %s WHERE id = %s", (severity, incident_id))


def resolve_incidents(conn: psycopg.Connection, app_id: int, department_id: int, status: str = "mitigated") -> None:
    conn.execute(
        """
        UPDATE security_incidents SET status = %s, resolved_at = NOW()
         WHERE app_id = %s AND department_id = %s AND status = 'open'
        """,
        (status, app_id, department_id),
    )


def insert_remediation(conn: psycopg.Connection, app_id: int, department_id: int, incident_id: int | None,
                       action_type: str, status: str, requires_approval: bool, detail: str) -> int | None:
    row = conn.execute(
        """
        INSERT INTO remediation_actions
               (app_id, department_id, incident_id, action_type, status, requires_approval, detail)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (app_id, department_id, action_type) WHERE status = 'pending_approval' DO NOTHING
        RETURNING id
        """,
        (app_id, department_id, incident_id, action_type, status, requires_approval, detail),
    ).fetchone()
    return row["id"] if row else None


def decide_remediation(conn: psycopg.Connection, action_id: int, status: str, actor: str,
                       note: str, detail_suffix: str) -> Row:
    return conn.execute(
        """
        UPDATE remediation_actions
           SET status = %s, decided_by = %s, decided_at = NOW(), decision_note = %s,
               detail = detail || %s
         WHERE id = %s AND status = 'pending_approval'
        RETURNING id, status, decided_at
        """,
        (status, actor, note or None, detail_suffix, action_id),
    ).fetchone()


def set_exposure_status(conn: psycopg.Connection, app_id: int, department_id: int, status: str) -> None:
    conn.execute(
        "UPDATE app_exposure SET status = %s, updated_at = NOW() WHERE app_id = %s AND department_id = %s",
        (status, app_id, department_id),
    )


def update_vendor_analysis(conn: psycopg.Connection, vendor_id: int, posture, score: int,
                           evidence: list[dict], injection_flags: list[str], policy_text: str,
                           verified: bool, notes: list[str], extractor: str) -> None:
    conn.execute(
        """
        UPDATE vendors SET
            trains_on_inputs = %(trains)s, retention_days = %(ret_days)s,
            retention_indefinite = %(ret_inf)s, data_location = %(loc)s,
            third_party_sharing = %(share)s, opt_out = %(opt)s, posture_score = %(score)s,
            evidence = %(evidence)s, injection_flags = %(flags)s, policy_text = %(text)s,
            verification_status = %(verif)s, verification_notes = %(notes)s, extractor = %(extractor)s,
            analyzed_at = NOW()
         WHERE id = %(id)s
        """,
        {
            "trains": posture.trains_on_inputs, "ret_days": posture.retention_days,
            "ret_inf": posture.retention_indefinite, "loc": posture.data_location
            if posture.data_location in {"MY", "SG", "EU", "US", "OTHER"} else "unknown",
            "share": posture.third_party_sharing, "opt": posture.opt_out, "score": score,
            "evidence": Jsonb(evidence), "flags": Jsonb(injection_flags), "text": policy_text,
            "verif": "verified" if verified else "unverified", "notes": Jsonb(notes),
            "extractor": extractor, "id": vendor_id,
        },
    )


def record_policy_version(conn: psycopg.Connection, vendor_id: int, policy_text: str, score: int,
                          verified: bool) -> int | None:
    """Store the policy as a new version only if its text differs from the latest one."""
    digest = hashlib.sha256(policy_text.strip().encode("utf-8")).hexdigest()
    row = conn.execute(
        """
        INSERT INTO policy_versions (vendor_id, policy_text, text_sha256, posture_score, verification_status)
        SELECT %(v)s, %(t)s, %(h)s, %(s)s, %(vs)s
         WHERE %(h)s IS DISTINCT FROM (
               SELECT text_sha256 FROM policy_versions
                WHERE vendor_id = %(v)s ORDER BY captured_at DESC, id DESC LIMIT 1)
        RETURNING id
        """,
        {"v": vendor_id, "t": policy_text, "h": digest, "s": score,
         "vs": "verified" if verified else "unverified"},
    ).fetchone()
    return row["id"] if row else None


def policy_history(conn: psycopg.Connection, vendor_id: int, limit: int = 2) -> list[Row]:
    return conn.execute(
        """
        SELECT id, policy_text, posture_score, verification_status, captured_at
          FROM policy_versions
         WHERE vendor_id = %s
         ORDER BY captured_at DESC, id DESC
         LIMIT %s
        """,
        (vendor_id, limit),
    ).fetchall()


def upsert_snapshot(conn: psycopg.Connection, index: float, detections: int, critical: int) -> None:
    conn.execute(
        """
        INSERT INTO risk_snapshots (day, exposure_index, detections, critical)
        VALUES (CURRENT_DATE, %s, %s, %s)
        ON CONFLICT (day) DO UPDATE SET exposure_index = EXCLUDED.exposure_index,
            detections = EXCLUDED.detections, critical = EXCLUDED.critical
        """,
        (index, detections, critical),
    )


def audit(conn: psycopg.Connection, role: str, key_fp: str, action: str, target: str,
          detail: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO audit_log (actor_role, actor_key, action, target, detail) VALUES (%s, %s, %s, %s, %s)",
        (role, key_fp[:12].ljust(12, "0"), action[:48], target[:120], Jsonb(detail or {})),
    )


def now(conn: psycopg.Connection) -> datetime:
    return conn.execute("SELECT NOW() AS now").fetchone()["now"]

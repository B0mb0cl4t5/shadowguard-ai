-- =============================================================================
-- ShadowGuard AI — PostgreSQL schema (Neon / Supabase / any PostgreSQL 14+)
--
-- Design notes (security-relevant):
--   * Telemetry is METADATA ONLY: domain, department, timestamp, bytes out and
--     in, the vendor's public IP and a pre-hashed user id. No client IPs, no
--     URLs, no request bodies, no typed content. The user_hash column is constrained to a 64-char hex digest so raw usernames
--     or emails cannot be stored here by mistake (OWASP A04 Insecure Design,
--     privacy by design).
--   * Every enumerated value is enforced with a CHECK constraint, so the
--     database rejects bad data even if an application-layer check is bypassed
--     (defence in depth for OWASP A03 Injection / A08 Integrity Failures).
--   * The application connects with a role that only needs SELECT/INSERT/
--     UPDATE on these tables. See DEPLOYMENT.md "a least-privilege role for
--     the app".
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS rate_limit_hits     CASCADE;
DROP TABLE IF EXISTS audit_log           CASCADE;
DROP TABLE IF EXISTS remediation_actions CASCADE;
DROP TABLE IF EXISTS security_incidents  CASCADE;
DROP TABLE IF EXISTS risk_snapshots      CASCADE;
DROP TABLE IF EXISTS app_exposure        CASCADE;
DROP TABLE IF EXISTS telemetry_events    CASCADE;
DROP TABLE IF EXISTS saas_apps           CASCADE;
DROP TABLE IF EXISTS policy_versions     CASCADE;
DROP TABLE IF EXISTS vendors             CASCADE;
DROP TABLE IF EXISTS departments         CASCADE;

-- -----------------------------------------------------------------------------
-- Departments and the class of data each one handles.
-- sensitivity is the multiplier the risk rubric applies (0.30 – 1.00).
-- -----------------------------------------------------------------------------
CREATE TABLE departments (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(80)  NOT NULL UNIQUE,
    data_class   VARCHAR(32)  NOT NULL
                 CHECK (data_class IN ('student_records', 'staff_hr', 'finance',
                                       'research_unpublished', 'general')),
    sensitivity  NUMERIC(3,2) NOT NULL CHECK (sensitivity BETWEEN 0.30 AND 1.00)
);

-- -----------------------------------------------------------------------------
-- Vendors and the posture extracted from their public privacy policy (IDP).
-- evidence holds the verbatim quote behind every extracted answer.
-- -----------------------------------------------------------------------------
CREATE TABLE vendors (
    id                   SERIAL PRIMARY KEY,
    name                 VARCHAR(120) NOT NULL UNIQUE,
    website              VARCHAR(255) NOT NULL,
    policy_url           VARCHAR(500),
    policy_text          TEXT,
    trains_on_inputs     VARCHAR(8)  NOT NULL DEFAULT 'unknown'
                         CHECK (trains_on_inputs IN ('yes', 'no', 'unknown')),
    retention_days       INTEGER     CHECK (retention_days IS NULL OR retention_days >= 0),
    retention_indefinite BOOLEAN     NOT NULL DEFAULT FALSE,
    data_location        VARCHAR(16) NOT NULL DEFAULT 'unknown'
                         CHECK (data_location IN ('MY', 'SG', 'EU', 'US', 'OTHER', 'unknown')),
    third_party_sharing  VARCHAR(8)  NOT NULL DEFAULT 'unknown'
                         CHECK (third_party_sharing IN ('yes', 'no', 'unknown')),
    opt_out              VARCHAR(8)  NOT NULL DEFAULT 'unknown'
                         CHECK (opt_out IN ('yes', 'no', 'unknown')),
    posture_score        SMALLINT    NOT NULL DEFAULT 50 CHECK (posture_score BETWEEN 0 AND 100),
    evidence             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    injection_flags      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- Deterministic fallback: 'unverified' (any failed quote check, conflicting
    -- statements or injection attempt) floors the posture score at High.
    verification_status  VARCHAR(12) NOT NULL DEFAULT 'unverified'
                         CHECK (verification_status IN ('verified', 'unverified')),
    verification_notes   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    extractor            VARCHAR(8)  NOT NULL DEFAULT 'rules' CHECK (extractor IN ('rules', 'gemini')),
    analyzed_at          TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- Every distinct policy text a vendor has published, so a silent change can be
-- shown as a diff. A new row is written only when the text actually changes.
-- -----------------------------------------------------------------------------
CREATE TABLE policy_versions (
    id                   SERIAL      PRIMARY KEY,
    vendor_id            INTEGER     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    policy_text          TEXT        NOT NULL,
    text_sha256          CHAR(64)    NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    posture_score        SMALLINT    NOT NULL CHECK (posture_score BETWEEN 0 AND 100),
    verification_status  VARCHAR(12) NOT NULL CHECK (verification_status IN ('verified', 'unverified')),
    captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_policy_versions_vendor ON policy_versions (vendor_id, captured_at DESC, id DESC);

-- -----------------------------------------------------------------------------
-- Catalogue of SaaS / AI apps the discovery stage can recognise.
-- approved = sanctioned by university IT. approved_alternative_id points at
-- the sanctioned tool a nudge should recommend instead.
-- -----------------------------------------------------------------------------
CREATE TABLE saas_apps (
    id                       SERIAL PRIMARY KEY,
    vendor_id                INTEGER      NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    name                     VARCHAR(120) NOT NULL,
    domain                   VARCHAR(253) NOT NULL UNIQUE
                             CHECK (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
    category                 VARCHAR(40)  NOT NULL
                             CHECK (category IN ('chat_assistant', 'summariser', 'writing',
                                                 'transcription', 'code_assistant',
                                                 'slides', 'research', 'image', 'grading')),
    is_ai                    BOOLEAN      NOT NULL DEFAULT TRUE,
    approved                 BOOLEAN      NOT NULL DEFAULT FALSE,
    approved_alternative_id  INTEGER      REFERENCES saas_apps(id) ON DELETE SET NULL
);

-- -----------------------------------------------------------------------------
-- Raw network telemetry (proxy / DNS / firewall), metadata only.
-- -----------------------------------------------------------------------------
CREATE TABLE telemetry_events (
    id             BIGSERIAL    PRIMARY KEY,
    observed_at    TIMESTAMPTZ  NOT NULL,
    department_id  INTEGER      NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    user_hash      CHAR(64)     NOT NULL CHECK (user_hash ~ '^[0-9a-f]{64}$'),
    domain         VARCHAR(253) NOT NULL,
    app_id         INTEGER      REFERENCES saas_apps(id) ON DELETE SET NULL,
    bytes_out      BIGINT       NOT NULL DEFAULT 0 CHECK (bytes_out >= 0),
    bytes_in       BIGINT       NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
    dest_ip        INET,
    source         VARCHAR(10)  NOT NULL CHECK (source IN ('proxy', 'dns', 'firewall')),
    ingested_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_telemetry_app_dept_time ON telemetry_events (app_id, department_id, observed_at DESC);
CREATE INDEX idx_telemetry_time          ON telemetry_events (observed_at DESC);

-- -----------------------------------------------------------------------------
-- Current exposure of each (app, department) pair over the trailing window.
-- factors = the rubric breakdown shown to analysts (explainable scoring).
-- -----------------------------------------------------------------------------
CREATE TABLE app_exposure (
    app_id          INTEGER     NOT NULL REFERENCES saas_apps(id)   ON DELETE CASCADE,
    department_id   INTEGER     NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    users           INTEGER     NOT NULL CHECK (users >= 0),
    events          INTEGER     NOT NULL CHECK (events >= 0),
    bytes_out       BIGINT      NOT NULL DEFAULT 0 CHECK (bytes_out >= 0),
    bytes_in        BIGINT      NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
    first_seen      TIMESTAMPTZ NOT NULL,
    last_seen       TIMESTAMPTZ NOT NULL,
    exposure_score  SMALLINT    NOT NULL CHECK (exposure_score BETWEEN 0 AND 100),
    severity        VARCHAR(10) NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low')),
    factors         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status          VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'accepted')),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (app_id, department_id)
);
CREATE INDEX idx_exposure_severity ON app_exposure (severity, exposure_score DESC);

-- -----------------------------------------------------------------------------
-- Data-leakage incidents: opened when a pair reaches High or Critical.
-- At most one OPEN incident per (app, department) pair.
-- -----------------------------------------------------------------------------
CREATE TABLE security_incidents (
    id             SERIAL       PRIMARY KEY,
    detected_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    app_id         INTEGER      NOT NULL REFERENCES saas_apps(id)   ON DELETE CASCADE,
    department_id  INTEGER      NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    severity       VARCHAR(10)  NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low')),
    title          VARCHAR(200) NOT NULL,
    description    TEXT         NOT NULL,
    status         VARCHAR(12)  NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'mitigated', 'accepted', 'false_positive')),
    resolved_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_open_incident ON security_incidents (app_id, department_id) WHERE status = 'open';

-- -----------------------------------------------------------------------------
-- Remediation log. Soft actions run automatically: a nudge to staff and a
-- pre-filled IT risk-assessment ticket. Anything that blocks or revokes is
-- created as 'pending_approval' and only a human admin can approve it
-- (human-in-the-loop by design — OWASP A04 Insecure Design).
-- -----------------------------------------------------------------------------
CREATE TABLE remediation_actions (
    id                 SERIAL       PRIMARY KEY,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    app_id             INTEGER      NOT NULL REFERENCES saas_apps(id)   ON DELETE CASCADE,
    department_id      INTEGER      NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    incident_id        INTEGER      REFERENCES security_incidents(id)   ON DELETE SET NULL,
    action_type        VARCHAR(16)  NOT NULL
                       CHECK (action_type IN ('nudge', 'risk_ticket', 'block_domain')),
    status             VARCHAR(18)  NOT NULL
                       CONSTRAINT remediation_actions_status_chk
                       CHECK (status IN ('executed', 'simulated', 'pending_approval',
                                         'approved', 'verified', 'rejected', 'failed')),
    requires_approval  BOOLEAN      NOT NULL DEFAULT FALSE,
    detail             TEXT         NOT NULL,
    requested_by       VARCHAR(64),
    decided_by         VARCHAR(64),
    decided_at         TIMESTAMPTZ,
    decision_note      VARCHAR(500),
    executed_by        VARCHAR(64),
    executed_at        TIMESTAMPTZ,
    verified_by        VARCHAR(64),
    verified_at        TIMESTAMPTZ,
    CHECK (requires_approval = (action_type = 'block_domain'))
);
CREATE INDEX idx_remediation_created ON remediation_actions (created_at DESC);
CREATE UNIQUE INDEX uq_pending_block ON remediation_actions (app_id, department_id, action_type)
    WHERE status = 'pending_approval';

-- -----------------------------------------------------------------------------
-- One row per day: the organisation-wide exposure index, for the trend chart.
-- -----------------------------------------------------------------------------
CREATE TABLE risk_snapshots (
    day             DATE         PRIMARY KEY,
    exposure_index  NUMERIC(5,2) NOT NULL CHECK (exposure_index BETWEEN 0 AND 100),
    detections      INTEGER      NOT NULL CHECK (detections >= 0),
    critical        INTEGER      NOT NULL CHECK (critical >= 0)
);

-- -----------------------------------------------------------------------------
-- Append-only audit trail for every state-changing API call (OWASP A09).
-- actor_key is a short fingerprint of the hashed API key, never the key.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGSERIAL    PRIMARY KEY,
    at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor_role  VARCHAR(16)  NOT NULL,
    actor_key   CHAR(12)     NOT NULL,
    action      VARCHAR(48)  NOT NULL,
    target      VARCHAR(120) NOT NULL,
    detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    prev_hash   CHAR(64),
    entry_hash  CHAR(64),
    CONSTRAINT audit_log_hash_pair_chk CHECK ((prev_hash IS NULL) = (entry_hash IS NULL))
);
CREATE INDEX idx_audit_at ON audit_log (at DESC);
CREATE UNIQUE INDEX uq_audit_entry_hash ON audit_log (entry_hash) WHERE entry_hash IS NOT NULL;

-- Enforce append-only semantics at the database layer across all roles.
CREATE OR REPLACE FUNCTION shadowguard_audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END;
$$;

CREATE TRIGGER trg_audit_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION shadowguard_audit_immutable();

CREATE TRIGGER trg_audit_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION shadowguard_audit_immutable();

-- -----------------------------------------------------------------------------
-- Shared sign-in rate limits, one count for every serverless instance (OWASP A07).
-- Buckets are SHA-256 digests, so no client IP is stored. UNLOGGED: counters for
-- windows of an hour or less need no crash safety, and it keeps writes cheap.
-- -----------------------------------------------------------------------------
CREATE UNLOGGED TABLE rate_limit_hits (
    bucket  TEXT         NOT NULL,
    hit_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rate_limit_bucket_time ON rate_limit_hits (bucket, hit_at);

COMMIT;

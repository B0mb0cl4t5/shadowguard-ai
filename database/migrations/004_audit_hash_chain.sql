-- Migration 004: Add SHA-256 hash chain columns and append-only triggers to audit_log.
-- Idempotent: safe to re-run; preserves any existing pre-004 rows with NULL hashes.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash CHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash CHAR(64);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'audit_log'::regclass
           AND conname = 'audit_log_hash_pair_chk'
    ) THEN
        ALTER TABLE audit_log
            ADD CONSTRAINT audit_log_hash_pair_chk
            CHECK ((prev_hash IS NULL) = (entry_hash IS NULL));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_entry_hash
    ON audit_log (entry_hash) WHERE entry_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION shadowguard_audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_no_update_delete ON audit_log;
CREATE TRIGGER trg_audit_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION shadowguard_audit_immutable();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION shadowguard_audit_immutable();

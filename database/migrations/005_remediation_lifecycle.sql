-- Migration 005: Extend remediation_actions lifecycle with verified status and execution/verification timestamps.
-- Idempotent: safe to re-run.

ALTER TABLE remediation_actions ADD COLUMN IF NOT EXISTS requested_by VARCHAR(64);
ALTER TABLE remediation_actions ADD COLUMN IF NOT EXISTS executed_by  VARCHAR(64);
ALTER TABLE remediation_actions ADD COLUMN IF NOT EXISTS executed_at  TIMESTAMPTZ;
ALTER TABLE remediation_actions ADD COLUMN IF NOT EXISTS verified_by  VARCHAR(64);
ALTER TABLE remediation_actions ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMPTZ;

DO $$
DECLARE
    cname TEXT;
BEGIN
    SELECT conname INTO cname
      FROM pg_constraint
     WHERE conrelid = 'remediation_actions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%pending_approval%'
       AND conname <> 'remediation_actions_status_chk';
    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE remediation_actions DROP CONSTRAINT %I', cname);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'remediation_actions'::regclass
           AND conname = 'remediation_actions_status_chk'
    ) THEN
        ALTER TABLE remediation_actions
            ADD CONSTRAINT remediation_actions_status_chk
            CHECK (status IN ('executed', 'simulated', 'pending_approval',
                              'approved', 'verified', 'rejected', 'failed'));
    END IF;
END $$;

-- Adds inbound bytes and the vendor's destination IP to an existing database.
-- Keeps every row, and is safe to run twice. Existing events stay at 0 bytes in
-- and no IP, because that was never recorded for them.
ALTER TABLE telemetry_events
    ADD COLUMN IF NOT EXISTS bytes_in BIGINT NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
    ADD COLUMN IF NOT EXISTS dest_ip  INET;

ALTER TABLE app_exposure
    ADD COLUMN IF NOT EXISTS bytes_in BIGINT NOT NULL DEFAULT 0 CHECK (bytes_in >= 0);

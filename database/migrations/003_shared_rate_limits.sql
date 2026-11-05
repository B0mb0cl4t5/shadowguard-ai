-- Shared sign-in rate limits, one count for every serverless instance (OWASP A07).
-- Buckets are SHA-256 digests, so no client IP is stored. UNLOGGED: counters for
-- windows of an hour or less need no crash safety. Safe to run twice; the backend
-- also creates this table on first use if no one has run this file.
CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_hits (
    bucket  TEXT         NOT NULL,
    hit_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_time ON rate_limit_hits (bucket, hit_at);

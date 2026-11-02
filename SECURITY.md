# Security — OWASP Top 10 (2021) implementation checklist

ShadowGuard is a security product, so every control below is implemented in code and most are covered by a test. File references point at where to look. "Test:" names the test that proves it (`backend/tests/`).

## A01 · Broken Access Control

- [x] **Role matrix on every backend route.** `viewer` reads, `ingest` writes telemetry only, `admin` approves blocks and re-analyses vendors. No role inherits another. `backend/shadowguard/app.py` (header docstring), `security.require_role`. Tests: `test_viewer_cannot_approve`, `test_ingest_key_cannot_read_dashboard`, `test_viewer_cannot_ingest`.
- [x] **Dashboard sessions are role-bound and signed.** Role and expiry live inside an HMAC-signed token; editing the cookie invalidates it. `frontend/lib/session.ts`. Verified end to end: a cookie with `viewer` changed to `admin` returns 401.
- [x] **Defence in depth against middleware bypass.** `middleware.ts` gates every route, *and* every route handler and the page re-verify the session and role (`frontend/lib/request-guard.ts`). A bypass such as CVE-2025-29927 would not expose data. Next.js is pinned to a patched 15.5.x.
- [x] **CSRF.** Session cookie is `SameSite=Strict`, and every state-changing route also requires a matching `Origin` header.
- [x] **Strict path parameters.** IDs must match `^[1-9][0-9]{0,9}$` (frontend) and `1 ≤ id ≤ 2^31−1` (backend).
- [x] **Open-redirect guard** on the `?next=` sign-in parameter. The value is resolved with the browser's own URL rules, so `//host`, `/\host` and tab or newline tricks fall back to the dashboard. `frontend/lib/safe-next.ts`. Test: `frontend/lib/safe-next.test.mjs`.
- [x] **Backend has one public path.** `vercel.json` exposes only `/api/v1/telemetry`; every other backend route is reachable only through the frontend's private service binding. A binding does not authenticate, so the role matrix and API keys still apply to internal calls.
- [x] **Least-privilege database role** documented in DEPLOYMENT.md; the audit log is append-only.

## A02 · Cryptographic Failures

- [x] **TLS to the database is mandatory** for any non-local host, including hosts named in `?host=` or `?hostaddr=`; `sslmode=disable` or no `sslmode` is refused. `backend/shadowguard/db.py`. Tests: `test_remote_database_requires_tls`, `test_host_overrides_cannot_skip_database_tls`.
- [x] **API keys stored as SHA-256 digests only**; malformed entries are ignored rather than trusted. Keys are 256-bit random (`create_api_key.py`). Comparison uses `hmac.compare_digest` across all entries. Test: `test_api_key_config_only_accepts_sha256_digests`.
- [x] **Access codes hashed with PBKDF2-HMAC-SHA256, 600,000 iterations**, random 16-byte salt, constant-time compare. `frontend/lib/password.ts`.
- [x] **Session cookie:** `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` prefix in production, 8-hour expiry.
- [x] **No secrets in the browser.** Backend keys are server-only env vars, and `lib/backend.ts` imports `server-only` so the build fails if it is ever pulled into client code.
- [x] **No keys over plaintext.** The frontend refuses an `http://` backend URL unless it is localhost; the live simulator refuses to send a key over `http://` to a remote host (test: `test_simulator_refuses_plain_http_to_remote_hosts`); the Teams webhook must be `https://`.
- [x] **HSTS** with preload on both apps.
- [x] **Gemini key sent in a header**, never in the URL, so it cannot land in proxy or access logs. Test: `test_gemini_request_shape_and_parsing`.

## A03 · Injection

- [x] **SQL: bound parameters everywhere.** All SQL lives in `backend/shadowguard/repository.py`; values are always passed separately from the query text.
- [x] **The one dynamic SQL fragment** (ORDER BY) is chosen from a fixed allow-list of `psycopg.sql.SQL` fragments keyed by a validated enum. User input picks a key; it never becomes SQL text.
- [x] **Strict input models** (`backend/shadowguard/models.py`): hostname regex, department allow-pattern, 64-hex user hash, timestamp sanity, enum sources, numeric bounds, `extra="forbid"` against mass assignment. Tests: `test_telemetry_validation_rejects` (incl. `'; DROP TABLE vendors;--`), `test_sql_injection_in_query_params_is_rejected`.
- [x] **Database CHECK constraints** repeat the critical rules (enums, hash format, domain format), so bad data is rejected even if application checks were bypassed. `database/schema.sql`.
- [x] **XSS:** React escapes all output; no `dangerouslySetInnerHTML` anywhere. A per-request **nonce CSP** with `strict-dynamic` blocks any injected script. `frontend/middleware.ts`.
- [x] **Log injection:** control characters are stripped from decision notes; validation errors never echo submitted values. Test: `test_decision_note_strips_control_characters`.
- [x] **Prompt injection (LLM-specific):** vendor pages are untrusted. Instruction-like sentences are flagged and excluded (zero-width-character tricks are normalised first), and every extracted claim must quote one whole sentence verbatim or it is discarded. `backend/shadowguard/idp.py`. Tests: `test_injection_is_flagged_and_cannot_flip_an_answer`, `test_hidden_zero_width_characters_do_not_evade_screening`, `test_reworded_injection_is_flagged`, `test_llm_claim_with_fabricated_quote_is_discarded`, `test_llm_quote_must_be_a_whole_sentence`.
- [x] **LLM misinterpretation:** the quote check proves a sentence exists, not that it was read correctly. With Gemini on, the rule-based extractor runs as an independent second opinion; any disagreement, including an answer only one of them gives, marks the vendor Unverified. Tests: `test_llm_misreading_a_real_quote_is_caught_by_cross_check`, `test_llm_leaving_out_a_risky_answer_is_caught_by_cross_check`.

## A04 · Insecure Design

- [x] **Human in the loop for hard actions.** The response planner can only *propose* a block; there is no code path that executes one without an admin decision. The database enforces that only `block_domain` actions require approval. Test: `test_blocking_is_never_automatic`.
- [x] **No shortcut around approval in the UI.** The ⌘K menu can only *open* a proposal for review. The confirmation dialog puts initial focus on **Cancel**, so a stray Enter never approves a block.
- [x] **Policy history is write-once for the app.** Each stored policy version carries its SHA-256; a new version is written only when the text actually changes, dry runs write nothing, and the least-privilege role in DEPLOYMENT.md has no UPDATE on `policy_versions`. Test: `test_new_version_recorded_only_when_text_changes`.
- [x] **Fail-safe scoring.** Unverified, contradictory or manipulated policies have their vendor posture floored at High rather than trusted. Contradictions are checked for training, sharing, opt-out, retention and location. Exposure still scales with data sensitivity and usage, so a lightly used unverified tool can sit below the incident threshold. Tests: `test_unverified_policy_is_floored_at_high`, `test_contradictory_retention_marks_vendor_unverified`, `test_contradictory_locations_mark_vendor_unverified`, `test_opposite_clauses_in_one_sentence_conflict`.
- [x] **Safe live testing.** The admin "Live policy test" runs as a dry run (`persist:false`): full analysis, zero database writes, still audit-logged. Test: `test_dry_run_analysis_changes_nothing`.
- [x] **No nagging loops.** A rejected block is not re-proposed for 7 days; nudges are rate-limited to one per pair per 24 h. Tests: `test_rejected_block_not_reproposed_for_a_week`, `test_surge_creates_incident_ticket_nudge_and_pending_block`.
- [x] **Privacy by design.** Metadata only (domain, department, time, hashed user id). No URLs, no content, no TLS interception. The schema rejects anything that is not a SHA-256 hex digest in `user_hash`.
- [x] **Lookalike-domain resistance.** `notsummarix.ai` and `summarix.ai.evil.com` do not match `summarix.ai`. Test: `test_domain_matching_does_not_accept_lookalikes`.
- [x] **Fail closed.** No API keys configured → 503 for everything. No session secret → nobody can sign in.

## A05 · Security Misconfiguration

- [x] Security headers on both apps: CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP. Backend tests: `test_health_is_public`, `test_early_rejections_carry_security_headers`, `test_unhandled_error_carries_security_headers`.
- [x] API docs and OpenAPI schema **off by default** (`ENABLE_DOCS`). Test: `test_docs_disabled_by_default`.
- [x] `X-Powered-By` removed; generic error bodies with a request id, full detail only in server logs.
- [x] CORS off by default; only explicit `https://` origins can be enabled.
- [x] Request size limits (1 MB body; chunked bodies refused). Test: `test_oversized_body_rejected`.
- [x] 15-second statement timeout on every DB transaction.
- [x] `.gitignore` excludes every `.env*` file except the examples.

## A06 · Vulnerable and Outdated Components

- [x] Dependencies pinned (exact versions for the framework, bounded ranges for Python).
- [x] **Small supply chain by design:** the command menu, word diff, charts and table sorting are written in-house instead of adding `cmdk`, `diff`, a chart library or a table library. The frontend's runtime dependencies are only Next.js, React, the Geist font and `server-only`.
- [x] Next.js 15.5.28 and React 19.2.9 include the 2025 React Server Components security fixes.
- [x] `npm run audit` runs `npm audit` and `pip-audit`; both report zero known vulnerabilities at release. Next.js bundles its own PostCSS, so `frontend/package.json` uses an npm `overrides` entry to force the patched PostCSS 8.5.x.

## A07 · Identification and Authentication Failures

- [x] Sign-in rate limit: 5 per minute and 30 per hour per IP. The backend limits requests per IP and per valid key, and after 20 failed API-key attempts in a minute it refuses that IP. Test: `test_repeated_auth_failures_lock_out_that_ip_only`.
- [x] Same generic error for every sign-in failure; both role hashes are always checked so timing does not reveal which role a near-miss matched.
- [x] Session expiry enforced from inside the signed payload; `SESSION_SECRET` rotation signs everyone out.

## A08 · Software and Data Integrity Failures

- [x] The seed is generated by the same scoring code the API runs (`build_seed.py`), so demo numbers cannot drift from the real logic. Test: `test_recompute_is_consistent_with_seed`.
- [x] The service worker caches only versioned static assets, never pages or API responses.
- [x] Remediation decisions use `SELECT … FOR UPDATE` plus a `WHERE status = 'pending_approval'` guard, so a double-click or replay cannot decide twice. Test: `test_admin_decision_flow_and_double_decision_conflict`.

## A09 · Security Logging and Monitoring Failures

- [x] Every state-changing API call writes to `audit_log` (role, key fingerprint, action, target). Raw keys are never logged. Test: `test_mutations_are_audited`.
- [x] Failed API-key and sign-in attempts are logged with the client IP, never with the submitted secret. Test: `test_failed_key_attempts_are_logged_without_the_secret`.

## A10 · Server-Side Request Forgery

- [x] The vendor-policy fetcher allows `https` on port 443 only, no credentials in URLs, and requires **every** resolved address to be public. Loopback, private, link-local (including `169.254.169.254` cloud metadata), CGNAT and IPv4-mapped IPv6 are refused. `backend/shadowguard/fetcher.py`. Tests: `test_unsafe_url_shapes_rejected`, `test_private_and_metadata_addresses_rejected`, `test_analyse_rejects_ssrf_target`.
- [x] Redirects are followed manually (max 3), each hop re-validated; 2 MB body cap, 10 s timeout, content-type allow-list.

---

## Known limitations (stated honestly)

- **The policy reader is rule-based.** Injection screening and contradiction checks catch the wording they recognise, not every possible rewording, and a vendor that simply states clean terms is taken at its word. A policy listing several regions or retention periods is treated as contradictory, so it may be flagged Unverified even when it is accurate.
- **Policy digests are not signatures.** The SHA-256 on a policy version is unkeyed and is not re-checked on read, so it does not prove a row was never edited by someone with owner access to the database.
- **Services share one project's environment variables.** With both services in one Vercel project, `DATABASE_URL` is set alongside the raw viewer and admin keys and the session secret, so a compromise of either service's server code could read all of them. Browsers still see none of them. Use separate projects if you need that separation.
- **Rate limits are per serverless instance.** Vercel can run several warm instances, so the limits are not global. Back `lib/rate-limit.ts` and `security.SlidingWindowLimiter` with Upstash Redis / Vercel KV for a hard global limit.
- **DNS rebinding in the fetcher.** There is a small window between the address check and the HTTP client's own resolution. Route the fetcher through an egress proxy that enforces the same allow-list for production use.
- **Shared access codes, not individual accounts.** Two codes (admin, viewer) are fine for a demo; production should use the university's SSO (OIDC / Microsoft Entra ID) so decisions are attributable to a named person.
- **`style-src 'unsafe-inline'`.** Needed for React style attributes; scripts remain nonce-locked.

## Reporting a vulnerability

Please report privately to the repository owner rather than opening a public issue.

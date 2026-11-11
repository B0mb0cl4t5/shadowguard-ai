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
- [x] **Passwords hashed with PBKDF2-HMAC-SHA256, 600,000 iterations**, random 16-byte salt, constant-time compare. `frontend/lib/password.ts`.
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
- [x] **Privacy by design.** Metadata only (domain, department, time, bytes out and in, the vendor's IP, hashed user id). No URLs, no content, no TLS interception, no client IPs: `dest_ip` must be a public address, so an internal one sent by mistake is refused. Tests: `test_telemetry_validation_rejects`. The schema rejects anything that is not a SHA-256 hex digest in `user_hash`.
- [x] **Pseudonymous, said plainly.** A hashed ID is pseudonymous personal data, not anonymous: anyone holding the salt could hash candidate names and compare. So the hash is made at the source with a secret salt that never reaches ShadowGuard (the laptop collector creates a random one on first run), the dashboard and live feed never show a hash, and small counts stay counts. Test: `test_collector_hashes_with_a_secret_salt_it_keeps`.
- [x] **Storage limitation.** Raw traffic events, the only rows holding a hashed person, are deleted after `TELEMETRY_RETENTION_DAYS` (default 90, never shorter than the exposure window scoring reads). The API applies it at most hourly while traffic arrives, and `backend/scripts/prune_telemetry.py` applies it on a schedule. Incidents, decisions and daily snapshots hold no person and are kept as the record. Tests: `test_old_traffic_is_deleted_after_the_retention_period`, `test_retention_never_drops_below_the_exposure_window`.
- [x] **Lookalike-domain resistance.** `notsummarix.ai` and `summarix.ai.evil.com` do not match `summarix.ai`. Test: `test_domain_matching_does_not_accept_lookalikes`.
- [x] **Fail closed.** No API keys configured → 503 for everything. No session secret → nobody can sign in.
- [x] **Nothing slow runs inside a transaction.** A Teams nudge is recorded as `failed` with the rest of the response and sent only after the transaction commits (`db.after_commit`), then marked `executed` when Teams accepts it; a slow Teams delays one response but never holds a connection or its locks. A crash in between leaves `failed`, which is true. Tests: `test_teams_nudge_is_sent_only_after_the_transaction_commits`, `test_a_nudge_teams_refused_stays_failed`, `test_after_commit_runs_only_once_the_transaction_commits`.
- [x] **One client can't starve the rest.** Every signed-in user reaches the backend with the dashboard's one key, so each client is capped first: 240 reads and 20 changes a minute on the data routes (`overBudget` in `lib/request-guard.ts`). The backend's own limit (`RATE_LIMIT_PER_MINUTE`, default 600) is the ceiling for everyone together. Test: `every signed-in data route caps each client` in `lib/design-contract.test.mjs`.
- [x] **A hang never freezes the screen.** Every browser request has a deadline (10 s for the live polls, 15 s for reads, 30 s for policy reading), so a request that never answers ends, the badge says "Reconnecting…", and polling carries on. A panel that fails to draw shows a retry while the others keep working, and a failed screen offers a way back (`app/error.tsx`). Tests in `lib/design-contract.test.mjs`.

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
- [x] **Small supply chain by design:** the command menu, word diff, charts and table sorting are written in-house instead of adding `cmdk`, `diff`, a chart library or a table library. The frontend's runtime dependencies are only Next.js, React and `server-only`. Fonts are downloaded by `next/font` at build time and served from the app's own origin, so the CSP stays `font-src 'self'`.
- [x] Next.js 15.5.28 and React 19.2.9 include the 2025 React Server Components security fixes.
- [x] `npm run audit` runs `npm audit` and `pip-audit`; both report zero known vulnerabilities at release. Next.js bundles its own PostCSS, so `frontend/package.json` uses an npm `overrides` entry to force the patched PostCSS 8.5.x.

## A07 · Identification and Authentication Failures

- [x] Sign-in rate limit: 5 per minute and 30 per hour per IP, counted **once across every serverless instance** in the database (`rate_limit_hits`), so spreading guesses across instances gains nothing. Each instance checks its own memory first, which keeps floods off the database; bucket names are SHA-256 hashed before they leave the dashboard server, so no client IP is stored. If the shared count is unreachable the per-instance limit still applies; if the backend answers "too many requests" the attempt is refused. Tests: `frontend/lib/rate-limit.test.mjs`, `test_shared_rate_limit_is_one_count_for_every_caller`, `test_shared_rate_limit_takes_only_hashed_buckets`.
- [x] Client addresses come from `X-Forwarded-For` only behind a proxy that sets it: Vercel (`VERCEL=1`) or `TRUST_PROXY=true`, in both services. Anywhere else the header could be forged to dodge the limits, so all clients share one bucket instead. Tests: `frontend/lib/client-ip.test.mjs`, `test_forwarded_address_is_trusted_only_behind_a_known_proxy`.
- [x] The backend limits requests per IP and per valid key, and after 20 failed API-key attempts in a minute it refuses that IP. These limits are per instance on purpose: API keys are 256-bit random values that can't be guessed, so the lockout controls noise rather than guarding a guessable secret. Sign-in checks count separately from the dashboard's data requests, so a sign-in flood can't use up the dashboard's allowance. Tests: `test_repeated_auth_failures_lock_out_that_ip_only`, `test_sign_in_checks_have_their_own_request_allowance`.
- [x] Same generic error for every sign-in failure; both role hashes are always checked so timing does not reveal which role a near-miss matched or whether a username exists. Test: `frontend/lib/password.test.mjs`.
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
- [x] **DNS rebinding is closed by pinning.** Each request connects to an address from the same check that approved it, so the name is never resolved a second time; TLS still verifies the certificate against the hostname (sent as SNI and `Host`). Every request opens a fresh connection, so a redirect to another site on the same CDN address can't reuse a connection verified for the first. Tests: `test_dns_rebinding_cannot_redirect_the_request`, `test_each_redirect_is_rechecked_and_repinned`, `test_every_request_gets_its_own_tls_handshake`.
- [x] Redirects are followed manually (max 3), each hop re-validated and re-pinned; 2 MB body cap, 10 s timeout, content-type allow-list.

---

## Known limitations (stated honestly)

- **The policy reader is rule-based.** Injection screening and contradiction checks catch the wording they recognise, not every possible rewording, and a vendor that simply states clean terms is taken at its word. A policy listing several regions or retention periods is treated as contradictory, so it may be flagged Unverified even when it is accurate.
- **Policy digests are not signatures.** The SHA-256 on a policy version is unkeyed and is not re-checked on read, so it does not prove a row was never edited by someone with owner access to the database.
- **Services share one project's environment variables.** With both services in one Vercel project, `DATABASE_URL` is set alongside the raw viewer and admin keys and the session secret, so a compromise of either service's server code could read all of them. Browsers still see none of them. Use separate projects if you need that separation.
- **Demo sign-in removes the password.** With `DEMO_SIGN_IN` set, anyone with the link signs in with that role in one click (`app/api/auth/demo`). It is off by default, the route answers 404 when off, the dashboard shows a "Demo mode" badge while it is on, and each use is logged. Set it only while recording, never on a deployment holding real data. Tests: `lib/demo-mode.test.mjs`.
- **The shared sign-in count can overshoot slightly.** Two instances checking a nearly full bucket at the same moment can each let one more attempt in, so the overshoot is bounded by the number of instances, not by the attacker. API-key limits stay per instance (see A07 for why).
- **Blocks are recorded, not enforced.** An approved block is stored and audited but not pushed to a firewall or proxy; that integration (FortiGate or the university's proxy API) is the next step.
- **Two shared logins, not individual accounts.** One admin and one viewer login are fine for a demo; production should use the university's SSO (OIDC / Microsoft Entra ID) so decisions are attributable to a named person.
- **`style-src 'unsafe-inline'`.** Needed for React style attributes; scripts remain nonce-locked.
- **The lawful basis is the university's to decide.** Code can minimise and protect the data; it can't decide whether monitoring staff traffic to AI tools is lawful, or what staff must be told. [docs/privacy-impact-assessment.md](docs/privacy-impact-assessment.md) is a template for the data protection officer, pre-filled with what ShadowGuard collects and keeps.

## If a secret leaks

Contain it first, then check what it was used for, then tell the right people. Every step ends in a redeploy, because Vercel reads environment variables when a deployment starts.

| Leaked | What someone could do | Contain it |
|---|---|---|
| `SESSION_SECRET` | Forge a signed-in session for either role | Set a new value (`npm run gen-secret`). Every session ends and everyone signs in again. |
| A dashboard password | Sign in with that role | Choose a new one (`npm run hash-password`), replace `DASHBOARD_ADMIN_CODE_HASH` or `DASHBOARD_VIEWER_CODE_HASH`, and rotate `SESSION_SECRET` too so sessions already open end. |
| The raw admin or viewer API key | Call the backend with that role wherever it is reachable (on Vercel, only `/api/v1/telemetry` is public) | Make a new key (`python backend/scripts/create_api_key.py admin`), add its digest to `SHADOWGUARD_API_KEYS` beside the old one, put the raw key in `SHADOWGUARD_ADMIN_API_KEY` (or the viewer one), redeploy, then remove the old digest and redeploy again. |
| A collector's ingest key | Send fake traffic | Delete that key's `ingest:` entry from `SHADOWGUARD_API_KEYS` and give the collector a new key. |
| `DATABASE_URL` | Read and change everything | Reset the database password (Vercel → Storage → the database, or the Neon console) and check `DATABASE_URL` picked up the new one. |
| `TEAMS_WEBHOOK_URL` | Post into that Teams channel | Delete the webhook in Teams, create a new one, and update the variable. |
| `GEMINI_API_KEY` | Spend the Gemini quota | Revoke it in Google AI Studio and set a new one. |
| A collector's salt | Test names against that collector's hashes | Delete `~/.shadowguard/collector-salt` (or change `SHADOWGUARD_HASH_SALT`). New hashes can't be linked to the old ones, which age out with the retention period. |

**Check what it was used for.** Every change made through the API is in `audit_log` with the key's fingerprint, the first 12 hex characters of its SHA-256. Work it out without leaving the key in your shell history:

```bash
python -c "import getpass, hashlib; print(hashlib.sha256(getpass.getpass('Key: ').encode()).hexdigest()[:12])"
```

```sql
SELECT at, actor_role, action, target FROM audit_log WHERE actor_key = '<fingerprint>' ORDER BY at DESC;
```

Sign-ins are in Vercel's runtime logs: search for `[auth]` (failed attempts, and every demo sign-in). Review any block decisions made in the window under *Reviews* (Remediation and reviews); blocks aren't pushed to a firewall automatically, so reverse at the proxy anything that wasn't yours.

**Tell the right people.** Report it to the university's IT security lead and data protection officer: what leaked, when, what it could reach, and what the audit log shows. Whether it is a personal data breach is the DPO's call. ShadowGuard holds pseudonymous IDs, department names and traffic metadata, never content; Malaysia's PDPA, as amended in 2024, requires notifying the Personal Data Protection Commissioner of a personal data breach, and the people affected where it may cause them significant harm, on the timelines its guidelines set.

## Reporting a vulnerability

Please report privately to the repository owner rather than opening a public issue.

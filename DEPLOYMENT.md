# Deploying ShadowGuard AI to Vercel

ShadowGuard deploys as **one Vercel project with two [services](https://vercel.com/docs/services)**, configured in the root `vercel.json` (Vercel Services is in beta):

| Service | Root | Framework | Public paths | What it serves |
|---|---|---|---|---|
| `frontend` | `frontend` | Next.js | Everything except the path below | Dashboard, sign-in, server-side proxy routes |
| `backend` | `backend` | FastAPI | `/api/v1/telemetry` only | Python risk engine (one serverless function) |

The browser only ever talks to `frontend`, which calls `backend` over a private service binding. Vercel generates the backend's internal URL and injects it into `frontend` as `SHADOWGUARD_API_URL`, and each preview deployment reaches its own backend. A binding grants network access but does not authenticate the call, so the backend still requires an API key on every request. Telemetry shippers post directly to the one public backend path with an ingest key.

Allow about 20 minutes end to end.

---

## 1. Create the database (Neon, free tier)

1. Sign in at neon.tech → **New project**. Pick region **Asia Pacific (Singapore)** to keep data close to Malaysia.
2. Open **Connection details**, tick **Pooled connection**, and copy the string. It looks like
   `postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Keep `sslmode=require`: the backend refuses remote connections without TLS.
3. Load the schema and seed from your machine:
   ```bash
   pip install -r backend/requirements.txt
   export DATABASE_URL="<the pooled string>"
   python backend/scripts/init_db.py          # type "yes" when asked
   ```
   (Or use `psql "$DATABASE_URL" -f database/schema.sql -f database/seed_data.sql`.)

**Using Supabase instead:** Project Settings → Database → **Connection pooling** (transaction mode, port 6543). Append `?sslmode=require`. Everything else is identical.

### Upgrading a database that's already running

Run this **before** deploying code that needs the new columns, or the dashboard will fail until you do. It keeps your data and is safe to run twice. Use the owner's connection string, not the app role's.

```bash
export DATABASE_URL="<the owner's pooled string>"
python backend/scripts/migrate_db.py
```

The same command adds the real AI tools (`002_real_ai_tools.sql`), so traffic from the laptop collector is recognised, and the shared sign-in counters (`003_shared_rate_limits.sql`). Older events have no inbound bytes or destination IP, because those were never recorded. They fill in as your collector sends `bytes_in` and `dest_ip`.

The backend also creates the counters table on first use if no migration has, as long as its role may create tables. With the least-privilege role below it can't, so run the migration as the owner; until then sign-in falls back to the per-instance limit.

### Recommended: a least-privilege role for the app (OWASP A01/A05)

Run this once as the owner in the Neon or Supabase SQL editor, then use this role's credentials in `DATABASE_URL` on Vercel. The app can then never drop tables or rewrite the audit trail, even if compromised.

```sql
CREATE ROLE shadowguard_app LOGIN PASSWORD 'use-a-long-random-password';
GRANT CONNECT ON DATABASE neondb TO shadowguard_app;      -- your database name
GRANT USAGE ON SCHEMA public TO shadowguard_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO shadowguard_app;
GRANT DELETE ON app_exposure, rate_limit_hits TO shadowguard_app;  -- the only deletes the app performs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shadowguard_app;
REVOKE UPDATE ON audit_log FROM shadowguard_app;          -- audit log is append-only
REVOKE UPDATE ON policy_versions FROM shadowguard_app;    -- stored policy versions are write-once
```

Keep using the owner role only for `init_db.py`.

---

## 2. Generate secrets (on your machine, never in chat or in the repo)

```bash
# Backend API keys: prints a raw key AND a "role:digest" line for each
python backend/scripts/create_api_key.py viewer
python backend/scripts/create_api_key.py ingest
python backend/scripts/create_api_key.py admin

# Dashboard passwords and the session secret
cd frontend && npm install
npm run hash-password                   # choose the admin password, get its hash (12+ characters)
npm run hash-password                   # choose the viewer password, get its hash
npm run gen-secret                      # SESSION_SECRET
```

Who gets what:

| Secret | Goes to |
|---|---|
| The three `role:digest` lines | `SHADOWGUARD_API_KEYS` (comma-separated) |
| Raw viewer key, raw admin key | `SHADOWGUARD_VIEWER_API_KEY`, `SHADOWGUARD_ADMIN_API_KEY` |
| Raw ingest key | Whatever pushes telemetry (`simulate_live.py`, a log shipper), not the Vercel project |
| Password **hashes** + `SESSION_SECRET` | `DASHBOARD_ADMIN_CODE_HASH`, `DASHBOARD_VIEWER_CODE_HASH`, `SESSION_SECRET` |
| The passwords themselves | The people who sign in, shared privately |

The usernames are `admin` and `viewer` unless you set `DASHBOARD_ADMIN_USERNAME` or `DASHBOARD_VIEWER_USERNAME`.

---

## 3. Deploy the project

1. Push the repo to GitHub.
2. Vercel → **Add New… → Project** → import the repo.
3. **Root Directory:** the repository root, not `frontend` or `backend`. **Framework Preset:** Services. Leave build and output settings empty; `vercel.json` defines them for each service.
4. **Environment Variables** (Production). None of these have a `NEXT_PUBLIC_` prefix, so none reach the browser:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | pooled Neon/Supabase string with `sslmode=require` |
   | `SHADOWGUARD_API_KEYS` | `viewer:…,ingest:…,admin:…` |
   | `SHADOWGUARD_ENV` | `production` |
   | `ENABLE_DOCS` | `false` |
   | `SHADOWGUARD_VIEWER_API_KEY` | raw viewer key |
   | `SHADOWGUARD_ADMIN_API_KEY` | raw admin key |
   | `DASHBOARD_ADMIN_CODE_HASH` | `pbkdf2_sha256:600000:…` |
   | `DASHBOARD_VIEWER_CODE_HASH` | `pbkdf2_sha256:600000:…` |
   | `DASHBOARD_ADMIN_USERNAME`, `DASHBOARD_VIEWER_USERNAME` | optional; default to `admin` and `viewer` |
   | `SESSION_SECRET` | output of `npm run gen-secret` |
   | `TEAMS_WEBHOOK_URL` | optional |
   | `GEMINI_API_KEY`, `GEMINI_MODEL` | optional |
   | `TRUST_PROXY` | `true` on Vercel (see below) |
   | `DEMO_SIGN_IN` | optional: `admin` or `viewer` adds a one-click "Open the demo" button. **Anyone with the link can then sign in**, so set it only while recording a demo, then delete it and redeploy |

   Do **not** set `SHADOWGUARD_API_URL`. The service binding generates it.

   **`TRUST_PROXY`:** the backend rate-limits and locks out by client IP. With `TRUST_PROXY=true` it reads the IP from `X-Forwarded-For`, which is only safe where the platform sets that header itself and discards whatever the client sent. Vercel's request-header documentation says it does; confirm it for your plan. Without it, every request arrives from the platform's own address, so all callers share one rate limit, and 20 bad API keys from anyone lock everyone out for a minute.

   **Policy fetching:** the backend fetches vendor privacy pages and refuses any host that resolves to a private address. Each request then connects to the address it checked, with the hostname in SNI and `Host`, so a DNS-rebinding attacker has no second lookup to swap (`shadowguard/fetcher.py`; tests in `backend/tests/test_fetcher.py`). A forward proxy that applies the same rules (HTTPS on port 443, public addresses only) remains a sensible extra layer if your network policy calls for one.

5. **Deploy**, open the URL, sign in as `admin` with the admin password.
6. Check the routing:
   ```bash
   curl -i https://YOUR-PROJECT.vercel.app/api/health            # 401 "Not signed in": the backend is not public here
   curl -i -X POST https://YOUR-PROJECT.vercel.app/api/v1/telemetry   # 401 "Missing or invalid API key": from the backend
   ```

---

## 4. Install it as an app (PWA)

- **Windows (Edge or Chrome):** open the dashboard → install icon in the address bar → *Install*.
- **iPad / iPhone (Safari):** Share → **Add to Home Screen**. Works in iPad Split View; the layout reflows at every width.
- **Android (Chrome):** menu → **Install app**.

The service worker caches only static assets. Risk data is never stored offline.

---

## 5. Run the live demo against production

The simulator only calls `/api/v1/telemetry`, the one public backend path.

```bash
SHADOWGUARD_API_URL=https://YOUR-PROJECT.vercel.app \
SHADOWGUARD_INGEST_KEY=<raw ingest key> \
python backend/scripts/simulate_live.py --surge paperpilot.ai --interval 8
```

The dashboard polls every 15 seconds; watch the exams office climb to Critical and a block proposal appear.

To reset the demo before going on stage, re-run `python backend/scripts/init_db.py`.

---

## Operations

**Rotate a key:** generate a new one, add its digest to `SHADOWGUARD_API_KEYS` *alongside* the old one, redeploy, swap the raw key variable, redeploy, then remove the old digest. No downtime.

**Sign everyone out:** change `SESSION_SECRET` and redeploy. Every existing session becomes invalid.

**Before each release:** `npm run audit` (npm audit + pip-audit) and `npm test`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Dashboard says "Can't reach the risk engine" | `SHADOWGUARD_API_URL` set by hand and overriding the binding, or the binding in `vercel.json` removed. A non-local `http://` URL is refused by design |
| Backend returns 503 "Service not configured" | `SHADOWGUARD_API_KEYS` empty or malformed, or `DATABASE_URL` missing `sslmode=require` |
| Sign-in says "Sign-in is not configured" | `SESSION_SECRET` missing or shorter than 32 characters |
| Correct username and password rejected | Hash not set for this environment, no redeploy since changing it, or a stray quote in the value; regenerate with `npm run hash-password` |
| 429 on sign-in | The brute-force limiter (5 per minute per IP). Wait a minute |
| Build ignores the services or the Python function fails to import | The project's Root Directory must be the repo root and its Framework Preset must be Services |
| `simulate_live.py` gets a 401 or HTML from a preview URL | Deployment Protection applies to the public path; use the production URL or a protection bypass |

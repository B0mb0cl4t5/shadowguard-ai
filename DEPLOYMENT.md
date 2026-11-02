# Deploying ShadowGuard AI to Vercel

ShadowGuard deploys as **two Vercel projects from the same GitHub repository**:

| Project | Root Directory | Framework preset | What it serves |
|---|---|---|---|
| `shadowguard-api` | `backend` | Other | Python risk engine (one serverless function) |
| `shadowguard-web` | `frontend` | Next.js | Dashboard, sign-in, server-side proxy routes |

Splitting them keeps the API keys on the server side of the dashboard and lets each side scale and roll back on its own. The browser only ever talks to `shadowguard-web`; `shadowguard-web` talks to `shadowguard-api` server-to-server with an API key.

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

### Recommended: a least-privilege role for the app (OWASP A01/A05)

Run this once as the owner in the Neon or Supabase SQL editor, then use this role's credentials in `DATABASE_URL` on Vercel. The app can then never drop tables or rewrite the audit trail, even if compromised.

```sql
CREATE ROLE shadowguard_app LOGIN PASSWORD 'use-a-long-random-password';
GRANT CONNECT ON DATABASE neondb TO shadowguard_app;      -- your database name
GRANT USAGE ON SCHEMA public TO shadowguard_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO shadowguard_app;
GRANT DELETE ON app_exposure TO shadowguard_app;          -- the only delete the app performs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shadowguard_app;
REVOKE UPDATE ON audit_log FROM shadowguard_app;          -- audit log is append-only
```

Keep using the owner role only for `init_db.py`.

---

## 2. Generate secrets (on your machine, never in chat or in the repo)

```bash
# Backend API keys: prints a raw key AND a "role:digest" line for each
python backend/scripts/create_api_key.py viewer
python backend/scripts/create_api_key.py ingest
python backend/scripts/create_api_key.py admin

# Dashboard access codes and the session secret
cd frontend && npm install
npm run hash-password -- --generate     # admin code + hash
npm run hash-password -- --generate     # viewer code + hash
npm run gen-secret                      # SESSION_SECRET
```

Who gets what:

| Secret | Goes to |
|---|---|
| The three `role:digest` lines | `shadowguard-api` → `SHADOWGUARD_API_KEYS` (comma-separated) |
| Raw viewer key, raw admin key | `shadowguard-web` |
| Raw ingest key | Whatever pushes telemetry (`simulate_live.py`, a log shipper) |
| Access-code **hashes** + `SESSION_SECRET` | `shadowguard-web` |
| The access codes themselves | The people who sign in, shared privately |

---

## 3. Deploy the backend (`shadowguard-api`)

1. Push the repo to GitHub.
2. Vercel → **Add New… → Project** → import the repo.
3. **Root Directory:** `backend`. **Framework Preset:** Other. Leave build and output settings empty.
4. **Environment Variables** (Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | pooled Neon/Supabase string with `sslmode=require` |
   | `SHADOWGUARD_API_KEYS` | `viewer:…,ingest:…,admin:…` |
   | `SHADOWGUARD_ENV` | `production` |
   | `ENABLE_DOCS` | `false` |
   | `TEAMS_WEBHOOK_URL` | optional |
   | `GEMINI_API_KEY`, `GEMINI_MODEL` | optional |

5. **Deploy.** Vercel installs `backend/requirements.txt` and serves `api/index.py`; `vercel.json` routes every path to it.
6. Check it:
   ```bash
   curl https://shadowguard-api.vercel.app/api/health          # {"status":"ok",...}
   curl -i https://shadowguard-api.vercel.app/api/v1/dashboard  # 401: auth is enforced
   curl -H "X-API-Key: <raw viewer key>" https://shadowguard-api.vercel.app/api/v1/dashboard
   ```

---

## 4. Deploy the dashboard (`shadowguard-web`)

1. Vercel → **Add New… → Project** → import the **same** repo again.
2. **Root Directory:** `frontend`. **Framework Preset:** Next.js (auto-detected).
3. **Environment Variables** (Production). None of these have a `NEXT_PUBLIC_` prefix, so none reach the browser:

   | Name | Value |
   |---|---|
   | `SHADOWGUARD_API_URL` | `https://shadowguard-api.vercel.app` (no trailing slash) |
   | `SHADOWGUARD_VIEWER_API_KEY` | raw viewer key |
   | `SHADOWGUARD_ADMIN_API_KEY` | raw admin key |
   | `DASHBOARD_ADMIN_CODE_HASH` | `pbkdf2_sha256:600000:…` |
   | `DASHBOARD_VIEWER_CODE_HASH` | `pbkdf2_sha256:600000:…` |
   | `SESSION_SECRET` | output of `npm run gen-secret` |

4. **Deploy**, open the URL, sign in with the admin access code.

---

## 5. Install it as an app (PWA)

- **Windows (Edge or Chrome):** open the dashboard → install icon in the address bar → *Install*.
- **iPad / iPhone (Safari):** Share → **Add to Home Screen**. Works in iPad Split View; the layout reflows at every width.
- **Android (Chrome):** menu → **Install app**.

The service worker caches only static assets. Risk data is never stored offline.

---

## 6. Run the live demo against production

```bash
SHADOWGUARD_API_URL=https://shadowguard-api.vercel.app \
SHADOWGUARD_INGEST_KEY=<raw ingest key> \
python backend/scripts/simulate_live.py --surge paperpilot.ai --interval 8
```

The dashboard polls every 15 seconds; watch the exams office climb to Critical and a block proposal appear.

To reset the demo before going on stage, re-run `python backend/scripts/init_db.py`.

---

## Operations

**Rotate a key:** generate a new one, add its digest to `SHADOWGUARD_API_KEYS` *alongside* the old one, redeploy, swap the raw key in the frontend, redeploy, then remove the old digest. No downtime.

**Sign everyone out:** change `SESSION_SECRET` and redeploy `shadowguard-web`. Every existing session becomes invalid.

**Before each release:** `npm run audit` (npm audit + pip-audit) and `npm test`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Dashboard says "Can't reach the risk engine" | `SHADOWGUARD_API_URL` wrong, or it uses `http://` for a remote host (refused by design) |
| Backend returns 503 "Service not configured" | `SHADOWGUARD_API_KEYS` empty or malformed, or `DATABASE_URL` missing `sslmode=require` |
| Sign-in says "Sign-in is not configured" | `SESSION_SECRET` missing or shorter than 32 characters |
| Correct access code rejected | Hash pasted with a stray space or quote; regenerate with `npm run hash-password` |
| 429 on sign-in | The brute-force limiter (5 per minute per IP). Wait a minute |
| Python function fails to import | Root Directory for the API project must be `backend`, not the repo root |

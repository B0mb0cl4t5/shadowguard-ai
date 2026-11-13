# ShadowGuard AI: pitch and demo guide

Presenter guide for [`ShadowGuard_Overview.pptx`](./ShadowGuard_Overview.pptx), with a PDF copy in [`ShadowGuard_Overview.pdf`](./ShadowGuard_Overview.pdf). Each slide's speaker notes hold the full talk track and its timing; this page is the run sheet, the demo script, and where every figure comes from.

- **Live demo:** https://shadowguard-ai-bice.vercel.app
- **Repository:** https://github.com/B0mb0cl4t5/shadowguard-ai
- **Event:** APU Cloud Innovation Hackathon 2026, Problem statement 02 (Intelligent automation and digital transformation)
- **Format:** 10 minutes, 12 slides, 16:9. The fonts are embedded, so the deck looks the same on the venue PC.

---

## Before you present

1. **Sign in as an admin.** *Simulate burst* and the *Review* button only appear for admins. For a recording, setting `DEMO_SIGN_IN=admin` on Vercel adds a one-click *Open the demo* button. Anyone with the link can then sign in, so delete it and redeploy straight after (see [`DEPLOYMENT.md`](../DEPLOYMENT.md)).
2. **Use a window at least 1280 × 740 at 100% zoom,** so *Fit to screen* holds the whole Overview without scrolling.
3. **Have a block proposal waiting.** *Reviews* in the left rail should show a pending count. If it doesn't, run the surge from the live-demo section of `DEPLOYMENT.md` (`simulate_live.py --surge`) and wait for a department to reach Critical.
4. **Check how policies are read on the live site.** Slides 4 and 6 say "Rules + Gemini". Until `GEMINI_API_KEY` is set on Vercel, the live site reads policies with the rules alone. Either set the key or say "rules, and Gemini when a key is set", as the speaker notes do.
5. **Keep the survey source to hand.** Slide 3 quotes Microsoft and LinkedIn's [2024 Work Trend Index](https://blogs.microsoft.com/blog/2024/05/08/microsoft-and-linkedin-release-the-2024-work-trend-index-on-the-state-of-ai-at-work/).

---

## 1. Run sheet (10 minutes, 12 slides)

| Time | Slide | Title on the slide | The point to land |
|---|---|---|---|
| 0:00–0:30 | 1 · Cover | ShadowGuard AI: Governing shadow AI across the university | Our answer to Problem statement 02. It covers two of the example use cases: IT operations automation (finds tools, files tickets) and intelligent document processing (reads and quotes policies). |
| 0:30–1:00 | 2 · The problem | A free AI grader rewrote its privacy policy, and nobody noticed | GradeSync Pro rewrote its policy to train on student work, keep it 3 years in the US and share it. Exposure went from Low 12 to Critical 93, touching PDPA s. 9 and s. 129. Say plainly that GradeSync Pro is a fictional demo vendor; the diff and the scores are the pipeline's real output. |
| 1:00–1:30 | 3 · The problem | Staff bring their own AI faster than IT can vet it | 75% of knowledge workers use AI at work, and 78% of those users bring their own tools. Manual review doesn't scale, blanket bans push staff out of sight, and not every upload carries the same risk. |
| 1:30–2:30 | 4 · Our solution | One pipeline that discovers, reads, scores and responds | Collect (log shipper and laptop proxy, plus backend auto-discovery of unknown AI domains), Analyse (FastAPI on Vercel, Neon Postgres with hash-chained audit log), Act (Next.js 15 dashboard). Metadata only: no TLS decryption, no prompts, no files, and usernames hashed at the source. |
| 2:30–4:30 | 5 · Live demo | Two minutes, end to end, on the live site | Switch to the browser and follow section 2. |
| 4:30–5:00 | 6 · How it works | Find the tools, then read their policies with proof | Discover from Squid or FortiGate logs (and auto-discover unknown `*.ai` / AI-keyword hosts at ingest). Read five scored answers plus four supplemental compliance advisories from each policy; an answer that can't quote a whole sentence is dropped, and a disagreement or hidden instruction marks the vendor Unverified. |
| 5:00–5:30 | 7 · How it works | Score the exposure, then let a person decide | Exposure = posture × sensitivity × usage. Bands: Low under 30, Moderate 30+, High 50+, Critical 70+. High or Critical files a ticket and a Teams nudge; Critical queues a block proposal. Nothing is blocked automatically; admins record approved blocks as `approved` → `executed` (*Rule applied*) → `verified` (*Block checked*). |
| 5:30–6:30 | 8 · Security and compliance | Built as a security product first | Small supply chain, OWASP Top 10 mapped in `SECURITY.md`, trigger-immutable SHA-256 hash-chained `audit_log` + `/api/audit/verify`, optional four-eyes approval (`REQUIRE_DUAL_APPROVAL`), PDPA (Act 709) sections 8, 9, 10 and 129 per vendor, and full keyboard and screen-reader paths. |
| 6:30–7:30 | 9 · Performance | Fast enough to watch the network live | Live feed every 4 s, full summary every 8 s while traffic arrives, 0.2–0.5 s reads, 240 reads a minute per client, 90 days of raw telemetry, Teams nudges only after the commit. |
| 7:30–8:30 | 10 · Deployment and operations | Deployed on Vercel, tested on every push | One Vercel project with two services, Neon in Singapore, and CI on every push: 86 frontend tests and 202 backend tests (23 on a real Postgres), plus npm audit and pip-audit. |
| 8:30–9:30 | 11 · Roadmap | From one campus to every university | Now: what is live (including hash-chained audit verification, block execution lifecycle, unknown-AI discovery, 4 IDP advisories, and printable executive brief). Next: MCP server for Gemini Enterprise, direct firewall push, Entra ID / Google SSO for per-person four-eyes enforcement, per-university weights. Later: in-browser coaching, SIEM sync, multi-campus workspaces. |
| 9:30–10:00 | 12 · Close | Try ShadowGuard live | Live URL, repository and QR code. Take questions. |

---

## 2. Demo script (2 minutes)

Start signed in as an admin on the Overview, with *Fit to screen* on.

| Time | Do this | Say this |
|---|---|---|
| 0:00–0:05 | Open https://shadowguard-ai-bice.vercel.app with the address bar visible. | "This is the live site on Vercel." |
| 0:05–0:15 | Show the Overview in *Fit to screen*. | "Every block fits one screen: the traffic map, live traffic, block proposals, the 14-day trend, severity, departments and the most exposed tools." |
| 0:15–0:30 | Hover, then click a region on the traffic map. | "Each region shows the real bytes out and in, and which tools sent them." |
| 0:30–0:55 | Click a tool name to open the vendor drawer. Optionally press *Fetch the latest policy*. | "Every answer about this vendor quotes its own policy. Here are the PDPA checks, and the diff from when GradeSync rewrote its policy." |
| 0:55–1:10 | Open *Tools* in the left rail and sort by severity. | "The full list, sortable, with the departments affected." |
| 1:10–1:30 | Go back to *Overview* and click *Simulate burst* in the top bar. | "New telemetry arrives. Each event travels an arc on the map and lands in Live traffic within seconds." |
| 1:30–1:50 | Open *Reviews* in the left rail, press *Review* on a proposal to show the dialog, then close it with *Cancel*. Show the recorded stages (*Mark rule applied* / *Mark block checked*), export *FortiGate CLI* or *Squid ACL*, and click *Verify audit chain*. | "Nothing is blocked until an admin approves it here; admins record when the rule is applied and checked, the rules export straight to the firewall, and every audit entry is SHA-256 hash-chained." |
| 1:50–2:00 | Click the *Print* icon (for the printable ShadowGuard AI executive brief preview) or return to *Overview* in the left rail. | "Discover, read, score, respond, and audit — in one place." |

Leave the proposal undecided in the demo. Approving or dismissing it is recorded in the audit log and can't be undone, and it takes the proposal out of the queue for the next run.

---

## 3. Where the figures come from

| Figure | Value | Source |
|---|---|---|
| Severity bands | Low under 30, Moderate 30+, High 50+, Critical 70+ | `SEVERITY_THRESHOLDS` in `backend/shadowguard/scoring.py` |
| Vendor posture | Up to 35 for training on inputs, 20 retention, 20 sharing, 15 no opt-out, 10 location | `vendor_posture` in `backend/shadowguard/scoring.py` |
| Unverified floor | Never below 50 | `UNVERIFIED_FLOOR` in `backend/shadowguard/scoring.py` |
| Sensitivity | 0.30 to 1.0 per department | `database/schema.sql` (departments check constraint) and `exposure` in `scoring.py` |
| Usage | 0.6 to 1.0, log scale, full at 50 distinct users | `usage_factor` and `USAGE_SATURATION_USERS` in `scoring.py` |
| Nudge and block limits | One nudge per department and tool per 24 h; a rejected block stays quiet for 7 days | `NUDGE_COOLDOWN` and `REJECTION_QUIET_PERIOD` in `backend/shadowguard/pipeline.py` |
| Live feed | Every 4 s while the tab is visible | `LIVE_MS` in `frontend/components/dashboard-shell.tsx` |
| Full summary | Every 8 s while new traffic arrives, otherwise every 60 s | `REFETCH_GAP_MS` and `FULL_REFRESH_MS` in `dashboard-shell.tsx` |
| Request deadlines | 10 s polls, 15 s requests, 30 s policy reads | `TIMEOUT_MS` in `frontend/lib/request-timeout.ts` |
| Read and write budget | 240 reads and 20 writes a minute per client | `BUDGET` in `frontend/lib/request-guard.ts` |
| Statement timeout | 15 s per database transaction | `set_statement_timeout` in `backend/shadowguard/repository.py` |
| Raw telemetry kept | 90 days | `telemetry_retention_days` in `backend/shadowguard/config.py`; pruned by `backend/scripts/prune_telemetry.py` |
| Dashboard reads | About 0.2 to 0.5 s | Measured on 5 November 2026, after moving the functions from iad1 to sin1 next to the Neon database |
| Gemini model | `gemini-2.5-flash` | `DEFAULT_MODEL` in `backend/shadowguard/gemini.py` |
| Tests | 86 frontend; 202 backend, 23 of them on a real Postgres | `npm run test:frontend` from the repo root, and the backend `pytest` suite. Verified locally on 13 November 2026: 86 of 86 frontend tests pass, and all 202 backend tests pass against a throwaway Postgres (`TEST_DATABASE_URL`); without one, 179 pass and the 23 database tests skip |
| Survey figures | 75% of knowledge workers use AI at work; 78% of AI users bring their own tools | Microsoft and LinkedIn, [2024 Work Trend Index](https://blogs.microsoft.com/blog/2024/05/08/microsoft-and-linkedin-release-the-2024-work-trend-index-on-the-state-of-ai-at-work/), 31,000 people in 31 countries |

---

## 4. Questions to expect

**Does it sit on the network?** No. ShadowGuard works at the application layer and out of band. It reads connection metadata that the campus proxy or firewall already logs, so it never sits in the traffic path and can't slow or break anything. Blocking happens on the firewall, from the rules ShadowGuard exports after an admin approves them.

**Do you read prompts or files?** No. It sees the hostname, byte counts, the time, a salted hash of the username, and the department. There is no TLS decryption.

**What if Gemini makes something up?** Every scored answer (and each of the 4 supplemental advisories) must quote a whole sentence from the policy word for word, or it is dropped. The rules and Gemini read the policy separately. If they disagree, or the page hides instructions aimed at an AI reader, the vendor is marked Unverified and scored at least 50 (High).

**Why not block automatically?** A wrong block cuts staff off in the middle of their work, so the decision stays with a person. The review dialog opens with focus on *Cancel*, a block counts only after the server confirms it, optional `REQUIRE_DUAL_APPROVAL=true` prevents self-approval across distinct admin keys, and admins record each block through *Rule applied* (`executed`) and *Block checked* (`verified`).

**How does it know the department — and new AI tools?** The log shipper looks up each username in the staff directory, then hashes the username with a secret salt before anything leaves campus (`collector/campus_log_shipper.py`). Any unknown `*.ai` or AI-keyword hostname sent to `/api/v1/telemetry` is also auto-discovered into an `unverified` posture for review.

**Is GradeSync Pro real?** No. It's a fictional demo vendor. The policy diff and the scores on slide 2 are what the real pipeline produced from its two policy texts.

---

## 5. Changes from the earlier deck

If you rehearsed the first version of this deck, these figures changed to match the code:

- The bands are High from 50 and Critical from 70 (not 60 and 80), and the formula is posture × sensitivity × usage.
- "30% of staff use 12+ unapproved AI tools" is gone, because nothing supported it. Slide 3 now uses the Work Trend Index figures above.
- "Under 200 ms" is now the measured 0.2 to 0.5 s.
- The backend has 202 tests (179 unit/security + 23 PostgreSQL integration) and the frontend has 86 tests (`npm run test:frontend`).
- GradeSync Pro is presented as a fictional demo vendor, and the CampusNote AI example is gone.
- The roadmap has no quarter dates.

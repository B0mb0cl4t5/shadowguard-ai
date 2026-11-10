# ShadowGuard AI — 10-Minute Presentation Deck & 2-Minute Demo Script

Companion presenter guide for [`docs/ShadowGuard_Overview.pptx`](./ShadowGuard_Overview.pptx).

- **Live Demo URL:** `https://shadowguard-ai-bice.vercel.app`
- **Repository:** `https://github.com/ongzixuan456/shadowguard-ai`

---

## 1 · Presentation Structure (10 Minutes · 12 Slides)

| Time | Slide | Section | Core Message | What Is Shown on Screen (`ShadowGuard_Overview.pptx`) |
|---|---|---|---|---|
| **0:00–0:30** | **Slide 1** | **Title** | *“ShadowGuard AI – University-wide AI-tool governance”* | Shield identity card, tagline, presenter callout, 4 governance pillars, and GDG Problem Statement 02 card |
| **0:30–1:00** | **Slide 2** | **Problem (1 / 2) — The Hidden Policy Trap** | Staff use unapproved free AI tools; vendor policies are hidden or silently rewritten → severe data-leak & Malaysian PDPA breach risk | 3-step visual scenario (`Lecturer uploads class essays → GradeSync Pro silently flips model training & SG→US transfer → Critical 93 exposure`) + word-level policy diff screenshot |
| **1:00–1:30** | **Slide 3** | **Problem (2 / 2) — Unmanaged Scale** | Manual vetting is impossible at campus scale; blanket firewall bans backfire | Hero stat callout (**“30% of staff use 12+ unapproved AI tools”** across 10 university departments) + Department Exposure Heatmap screenshot |
| **1:30–2:30** | **Slide 4** | **Solution Overview** | One-stop dashboard that **discovers, reads, scores & nudges** | High-level 3-tier architecture diagram (`Collectors [Squid / FortiGate / Laptop Proxy] → Backend [FastAPI Risk & Quote-Verified IDP Engine + Neon Postgres] → Frontend [Next.js 15 Real-Time UI]`) |
| **2:30–4:30** | **Slide 5** | **Live Demo (≈ 2 min)** | Show the UI in action — the moment that makes the product “real” | Full 12-step time-coded **Demo Video Script (`0.0s–120s`)** table with voice-over cues alongside the live dashboard screenshot |
| **4:30–5:00** | **Slide 6** | **How It Works (1 / 2) — Discover & Read** | • **Discover** – DNS/proxy metadata log parsing (`shadowguard_collector.py`, `campus_log_shipper.py`)<br>• **Read** – Policy extraction (deterministic rules + Gemini 2.5 Flash cross-check, verbatim quote verification & prompt-injection trap) | 5-node pipeline flowchart from `README.md` + technical deep dive + Live Policy Test screenshot |
| **5:00–5:30** | **Slide 7** | **How It Works (2 / 2) — Score & Respond** | • **Score** – Transparent `0–100` rubric (`Posture × Sensitivity × Usage`)<br>• **Respond** – Rate-limited Teams nudge, deduplicated IT ticket, human-approved block proposal & firewall/CSV exports | Full scoring formula card + human-in-the-loop response card + Command Palette (`⌘K`) screenshot |
| **5:30–6:30** | **Slide 8** | **Security & Compliance** | Zero-UI-dependency supply chain (`only Next.js, React & server-only`), WCAG 2.1 AA accessibility, OWASP Top 10 & Malaysian PDPA (Act 709) statutory mapping | Verbatim quote from [`SECURITY.md`](../SECURITY.md) + 4 compliance badges + Malaysian PDPA Sections 8, 9, 10 & 129 statutory matrix + Vendor Drawer screenshot |
| **6:30–7:30** | **Slide 9** | **Performance & Scalability** | Real-time updates every `4 s` (`live.beat`), `< 200 ms` latency, server-side rendering, `240 / 600 rpm` rate budgets, `90-day` retention & `db.after_commit` webhooks | 6 metric cards with exact operational numbers from [`DEPLOYMENT.md`](../DEPLOYMENT.md) and [`SECURITY.md`](../SECURITY.md) |
| **7:30–8:30** | **Slide 10** | **Deployment & Ops** | One-click Vercel Services multi-service deploy (`vercel.json`), Neon Postgres (`sslmode=require`, least-privilege SQL role), and GitHub Actions CI/CD | Vercel Services + CI/CD gate summary (`73/73` frontend & design-contract tests, `168/168` backend & PostgreSQL tests, `0` audit vulnerabilities) + Tools Exposure screenshot |
| **8:30–9:30** | **Slide 11** | **Roadmap / Future** | • **Phase 1 (Now):** Complete campus governance core<br>• **Phase 2 (Next):** Multi-tenant university SaaS & custom policy templates<br>• **Phase 3 (Future):** AI-generated remediation playbooks & direct firewall/SIEM socket push | 3-horizon visual timeline graphic |
| **9:30–10:00** | **Slide 12** | **Q&A / Call-to-Action** | *“Try the live demo at `shadowguard-ai-bice.vercel.app`”* | Live URL, GitHub repository link, interactive checklist, sign-in & light-theme screenshots |

---

## 2 · Demo Video Script (≈ 2 Minutes · `0.0s – 120s`)

| Step | Action (on screen) | Duration | Voice-over cue |
|---|---|---|---|
| **0.0–0.5s** | Open browser to the **Live demo URL** (`https://shadowguard-ai-bice.vercel.app`) – show address bar | `0.5s` | *“Here’s the live preview we host on Vercel.”* |
| **0.5–5s** | **Dashboard Overview** – the one-screen view (map, severity bars, top-tools panel). Highlight the sticky tab bar | `4.5s` | *“The dashboard fits on a single screen – notice the sticky tab bar stays while you scroll.”* |
| **5–10s** | Hover a **region pill** (e.g., `US 99.6 MB`) – a ring highlights the region on the map and the badge border highlights | `5s` | *“Hovering a region instantly highlights its traffic on the map.”* |
| **10–20s** | Click a **region pill** → **dot details card** appears with tooltip information | `10s` | *“Click to open a tooltip that shows the exact volume, risk score, and top tools.”* |
| **20–30s** | Click a **tool name** inside the tooltip → the **Vendor drawer** slides in | `10s` | *“From the card we can drill into a tool’s policy details.”* |
| **30–45s** | In the drawer, click **“Fetch the latest policy”** (or run a live policy check). Show the progress state and verified policy clauses + Malaysian PDPA statutory checks | `15s` | *“Policies are fetched on-demand; the UI shows a progress indicator and every verified quote.”* |
| **45–55s** | Switch to the **“Tool exposure”** tab (top sticky tab) – the Tools table appears. Sort by severity (click column header) | `10s` | *“The Tools tab lets you sort and filter all apps; the table is fully keyboard-accessible.”* |
| **55–65s** | Click **“View all”** from Overview (or inspect the **Risk Map** inside Tool exposure) → select a tool to highlight its position | `10s` | *“From the overview you can jump to a full view of all tools and their risk maps.”* |
| **65–80s** | Click **“Simulate burst”** button (top-right header). Observe the **traffic-map animation** (three new packet arcs and landing ripples) | `15s` | *“The ‘Simulate burst’ button instantly produces traffic; you see the animated arcs and ripple effect we built for live visual feedback.”* |
| **80–95s** | Look at / scroll down to the **Live traffic** table – new rows appear automatically (real-time updates every `4 s`) | `15s` | *“Live traffic is refreshed every 4 seconds – the table updates without a page reload.”* |
| **95–110s** | Switch to **Remediation and reviews** (or press `⌘K` / `Ctrl+K`) and click **“Export PDPA CSV”** → a CSV download (`shadowguard-pdpa-audit.csv`) starts | `15s` | *“Exporting the audit CSV is one click away for compliance reporting.”* |
| **110–120s** | End on the **Dashboard** with the sticky tab bar still visible | `10s` | *“That’s the full end-to-end flow – discovery, policy read, scoring, and response, all in a single UI.”* |

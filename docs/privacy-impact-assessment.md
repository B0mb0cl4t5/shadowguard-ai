# Privacy impact assessment: ShadowGuard AI

A template for the university's data protection officer (DPO). The facts about the system are filled in from the code. The decisions are yours, marked **Decide**. It covers a real deployment, not the demo, whose data is synthetic.

## 1. Purpose

ShadowGuard finds unapproved AI tools that staff already use, so that student records, staff records and unpublished research aren't uploaded to services that train on them or store them abroad. It reads each tool's published privacy policy, scores the risk per department, nudges staff towards an approved alternative, and proposes blocks that only a person can approve.

**Decide:** why this is necessary, and why less intrusive measures (policy, training, providing an approved tool) aren't enough on their own.

## 2. Which law applies

**Decide:** whether Malaysia's Personal Data Protection Act 2010 (as amended in 2024) applies to the university, and whether any other law does, for example the GDPR if staff or students based in the EU are in scope.

## 3. What is collected, and what isn't

Collected, per connection to a catalogued or heuristic-matched AI tool (`telemetry_events`):

| Field | Example | Why | Identifies a person? |
|---|---|---|---|
| Time | `2026-11-05 14:23` | When the tool was used | No |
| Department | `Examinations & Assessment` | Data sensitivity differs by department | Only with very small departments |
| User ID | 64-character hash | Counting distinct users | Pseudonymous: a SHA-256 of the account name mixed with a secret salt held at the source, never by ShadowGuard |
| Tool's domain | `chatgpt.com` | Which tool | No; campus collectors watch known AI domains, and the API auto-discovers unknown `*.ai` / AI-keyword hostnames while ignoring general web traffic |
| Bytes out and in | `635 B`, `534 KB` | How much was sent | No |
| Tool's public IP | `104.18.32.47` | Where the traffic went | No; staff addresses are refused |
| Source | `proxy` | Where the record came from | No |

Not collected: page addresses or paths, message or file content, file names, decrypted traffic, staff IP addresses, device names, names or email addresses.

Derived and kept: per tool and department exposure scores, incidents, actions (department-level nudges, risk tickets, block proposals and decisions), daily totals for the trend chart, and an audit log of API changes (role and key fingerprint, no person). Vendor privacy policies are public documents. When `GEMINI_API_KEY` is set, Google receives policy text only, never staff data.

## 4. Whose data

Anyone whose traffic passes through the proxy, firewall feed or laptop collector that reports to ShadowGuard.

**Decide:** who is in scope: staff only, or also students, contractors and visitors.

## 5. The PDPA principles

| Principle | What ShadowGuard does | Decide |
|---|---|---|
| General | Metadata only, AI-tool domains only (catalogued or `*.ai` / AI-keyword hostnames), hashed at the source | The lawful purpose, in writing |
| Notice and choice | Nothing by itself | The staff notice (draft below) and whether consent is needed |
| Disclosure | No data leaves ShadowGuard except department-level Teams nudges | Who may receive reports |
| Security | Mapped to the OWASP Top 10 in [SECURITY.md](../SECURITY.md): TLS everywhere, hashed API keys, signed sessions, rate limits, a trigger-immutable SHA-256 hash-chained audit log (`GET /api/audit/verify`), a least-privilege database role | Who holds the admin login |
| Retention | Raw traffic deleted after `TELEMETRY_RETENTION_DAYS` (default 90); records without a person are kept | The retention period, and how long incidents and decisions are kept |
| Data integrity | Every policy answer (and every supplemental compliance advisory) quotes the policy sentence it relies on; scores are explainable | How errors are corrected |
| Access | No screen, export or search shows a person or a hash; only counts | How access requests are handled (ShadowGuard can't look a person up; the salt holder could) |

## 6. Risks and how they're reduced

| Risk | Reduced by | What's left |
|---|---|---|
| Someone works out who a hash belongs to | Secret salt at the source; hashes never shown; deleted after the retention period | **Decide:** whether to hide counts below a minimum (for example under 3), since a count of 1 in a small department can point to a person. ShadowGuard doesn't do this yet. |
| Used to watch individuals | No per-person view, export or live feed; the live feed excludes hashes | **Decide:** a written purpose limitation that rules out performance monitoring |
| Blocking gets in the way of legitimate work | Blocks are only proposed; a person approves, marks the firewall rule applied (`executed`), and marks the block as checked (`verified`); nudges suggest an approved tool | Exported firewall rules still need applying at the proxy unless an API integration is connected |
| A secret leaks | Procedure in [SECURITY.md](../SECURITY.md#if-a-secret-leaks) | Breach notification per the DPO's procedure |
| Demo sign-in left on | Off by default; a "Demo mode" badge shows while it's on; each use is logged | Must be off on any deployment holding real data |

## 7. Staff notice (draft)

> To protect student and research data, the university monitors which AI tools are used on its network. For each visit to a known AI service, it records the service, the time, your department, how much data was sent, and an identifier that is scrambled before it reaches the monitoring system, so the system cannot see who you are. It never records what you type, upload or read. The records are deleted after **[90]** days. If a tool's terms put university data at risk, you may receive a message suggesting an approved alternative; access is only ever blocked after a person reviews it. Questions: **[DPO contact]**.

## 8. Sign-off

| | |
|---|---|
| Assessed by | |
| Date | |
| Decision | Proceed / proceed with changes / don't proceed |
| Changes required | |
| Review date | |

# ShadowGuard AI — UI / UX & Accessibility Guidelines

ShadowGuard's interface is designed for university security analysts and data protection officers working in long triage sessions. Every rule below is enforced automatically in CI by [`frontend/lib/design-contract.test.mjs`](../frontend/lib/design-contract.test.mjs) (`npm run test:frontend`).

---

## 1. Design System & Colour Tokens

All colours are defined as CSS custom properties in [`frontend/app/globals.css`](../frontend/app/globals.css) for both **Dark Mode** (`:root`) and **Light Mode** (`html.light`), and exposed through [`frontend/tailwind.config.ts`](../frontend/tailwind.config.ts). Raw hex codes and default Tailwind colour palettes (`slate-*`, `zinc-*`, etc.) are forbidden in components.

| Token | Role | Dark Mode | Light Mode |
|---|---|---|---|
| `--ground` | Canvas background | `#101114` | `#f3f4f6` |
| `--surface` | Primary panel surface | `#17191d` | `#ffffff` |
| `--raised` | Interactive control / nested card | `#202329` | `#eceef1` |
| `--text` / `--text-2` | Primary & secondary ink | `#f3f4f6` / `#c9cdd4` | `#121316` / `#3a3e46` |
| `--accent` | Mark, focus ring, open section, primary button (the ink colour) | `#f3f4f6` | `#121316` |
| `--data` | Non-severity chart series (toned-down violet) | `#8981cb` | `#5b54a8` |
| `--sev-critical` | Critical severity ($\ge 70$) | `#f43f5e` | `#e11d48` |
| `--sev-high` | High severity ($\ge 50$) | `#f59e0b` | `#d97706` |
| `--sev-moderate` | Moderate severity ($\ge 30$) | `#38bdf8` | `#0284c7` |
| `--sev-low` | Low severity ($< 30$) | `#10b981` | `#059669` |

The ground, cards and controls are neutral graphite with no hue of their own, so the only colour on screen is data: severity and the `--data` series. Depth comes from the step between ground and card and a 1px edge, never from shadows. Panels have no header band; a panel waiting on a human decision carries a small amber mark beside its title.

**Typography:** Instrument Sans for text and IBM Plex Mono (tabular figures) for every number, ID, domain and timestamp. Both are self-hosted through `next/font`, so the CSP stays `font-src 'self'`.

---

## 2. In-House UI Primitives (Zero UI Dependencies)

To keep the software supply chain minimal (OWASP A06 in [`SECURITY.md`](../SECURITY.md)), all UI primitives and charts are built in-house with zero third-party UI libraries (`npm audit` = 0 vulnerabilities). Raw HTML `<button>`, `<input>`, `<select>`, `<textarea>`, and `<table>` elements are forbidden outside [`frontend/components/ui/`](../frontend/components/ui/):

- **[`components/ui/button.tsx`](../frontend/components/ui/button.tsx):** `<Button>` (`primary`, `secondary`, `ghost`, `outline`, `danger`, `bare`) and `<Segmented>` control, with $44\times 44\text{ px}$ coarse-pointer touch targets (`[@media(pointer:coarse)]:min-h-11`).
- **[`components/ui/card.tsx`](../frontend/components/ui/card.tsx):** `<Panel>` (wrapped in an error boundary `<PanelBoundary>` so one failed chart cannot blank the dashboard) and `<SubCard>`.
- **[`components/ui/badge.tsx`](../frontend/components/ui/badge.tsx):** `<Badge>` and `<SeverityBadge>` (always pairs colour with text and/or numeric score).
- **[`components/ui/input.tsx`](../frontend/components/ui/input.tsx):** `<Input>`, `<Select>`, and `<Textarea>` with consistent `focus-visible:ring-2 focus-visible:ring-accent`.
- **[`components/ui/table.tsx`](../frontend/components/ui/table.tsx):** Accessible table primitives (`<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>`).
- **[`components/ui/tabs.tsx`](../frontend/components/ui/tabs.tsx):** The section rail (a left rail from `lg`, a bottom bar on phones): an ARIA tablist with arrow-key navigation and URL hash syncing (`#overview`, `#tools`, `#reviews`, `#departments`).
- **[`components/icons.tsx`](../frontend/components/icons.tsx):** Single-style 1.75px stroke SVG icons accepting `size` and `className`.

---

## 3. Responsive Layout & One-Screen Triage Mode

- **Section Rail:** Four sections (**Overview**, **Tools**, **Reviews**, **Departments**) in one rail: a left rail from `lg` (each icon above its label, becoming a wider rail with icon and label side by side at `2xl`) and a bottom bar on phones. Refresh, Motion, theme, print and sign out sit in the rail's foot on desktop and in the top bar on a phone. The top bar carries the open section's title, the **Live** status and, for admins, **Simulate burst**.
- **Metric Strip:** The four headline figures are an open band divided by rules rather than four cards: four across from `lg`, two across below.
- **12-Column CSS Grid:** Every dashboard section is laid out on `grid-cols-12 gap-6`.
- **One-Screen Fit (`dense:` variant):** On viewports at least `1280 × 740`, the **Overview** fits on a single screen at 100% zoom with zero vertical or horizontal scrolling (`Fit to screen`), or expands to full-height charts when switched to `Full page`.
- **Print Executive Brief (`@media print`):** Clicking the Print button triggers a print-only `Executive Governance Brief` header summarizing live exposure, active critical/high risks, and pending decisions while hiding the chrome rail.
- **Reviews & Audit Verification:** The **Reviews** section surfaces the full remediation lifecycle (**Pending approval** → **Approved** → **Mark rule applied** / `executed` → **Verify block** / `verified`) alongside an admin-only **Verify audit chain** check (`GET /api/audit/verify`).
- **Supplemental Signals:** Inside [`VendorDrawer`](../frontend/components/vendor-drawer.tsx), quote-verified **Supplemental policy signals** (human review, breach notification, encryption, unilateral term changes) sit below the 5-factor rubric for compliance context without altering the numeric score.
- **Tablet & Mobile Adaptation:** Below `1280 × 740`, panels stack cleanly into 1- or 2-column scrolling layouts, and the tools table switches to touch-friendly cards on mobile viewports (`md:hidden`).

---

## 4. Accessibility (WCAG 2.1 AA) & Motion Contract

- **Keyboard Navigation & Shortcuts:**
  - `⌘K` / `Ctrl K` or `/` opens the [`CommandPalette`](../frontend/components/command-palette.tsx) (ARIA `combobox` + `listbox`).
  - `1`–`4` switch sections, `R` refreshes data, and `?` displays keyboard shortcuts. In the rail, arrow keys on either axis move between sections (ARIA tabs pattern).
  - All dialogs ([`VendorDrawer`](../frontend/components/vendor-drawer.tsx), [`ReviewDialog`](../frontend/components/review-dialog.tsx), [`CompareDialog`](../frontend/components/compare-dialog.tsx), [`CommandPalette`](../frontend/components/command-palette.tsx)) trap `Tab` focus via [`use-focus-trap.ts`](../frontend/lib/use-focus-trap.ts) and restore focus to the trigger on `Escape`/close.
- **Interactive Charts & Traffic Map:**
  - [`TrafficMap`](../frontend/components/traffic-map.tsx) dots and pills expose full `aria-label` descriptions, keyboard focus rings, and an `aria-live="polite"` `role="tooltip"` details card (`DotDetails`).
  - [`DetectionColumns`](../frontend/components/insight-charts.tsx) implements `role="slider"` so daily detections can be inspected with Left/Right arrow keys without a mouse.
- **Meaningful Motion & Reduced Motion:**
  - Motion is driven by real server responses (`live.beat` and incoming telemetry events).
  - The **Motion** toggle (and `prefers-reduced-motion: reduce`) disables all CSS transitions, stagger delays, and rolling number animations across the entire app.

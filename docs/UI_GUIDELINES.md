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
| `--text` / `--text-2` | Primary & secondary ink | `#f1f5f9` / `#cbd5e1` | `#0f172a` / `#334155` |
| `--accent` | Mark, focus ring, open section, primary button (the ink colour) | `#f3f4f6` | `#121316` |
| `--data` | Non-severity chart series | `#818cf8` | `#4f46e5` |
| `--sev-critical` | Critical severity ($\ge 70$) | `#fb7185` | `#e11d48` |
| `--sev-high` | High severity ($\ge 50$) | `#fbbf24` | `#d97706` |
| `--sev-moderate` | Moderate severity ($\ge 30$) | `#38bdf8` | `#0284c7` |
| `--sev-low` | Low severity ($< 30$) | `#34d399` | `#059669` |

---

## 2. In-House UI Primitives (Zero UI Dependencies)

To keep the software supply chain minimal (OWASP A06 in [`SECURITY.md`](../SECURITY.md)), all UI primitives and charts are built in-house with zero third-party UI libraries (`npm audit` = 0 vulnerabilities). Raw HTML `<button>`, `<input>`, `<select>`, `<textarea>`, and `<table>` elements are forbidden outside [`frontend/components/ui/`](../frontend/components/ui/):

- **[`components/ui/button.tsx`](../frontend/components/ui/button.tsx):** `<Button>` (`primary`, `secondary`, `ghost`, `outline`, `danger`, `bare`) and `<Segmented>` control, with $44\times 44\text{ px}$ coarse-pointer touch targets (`[@media(pointer:coarse)]:min-h-11`).
- **[`components/ui/card.tsx`](../frontend/components/ui/card.tsx):** `<Panel>` (wrapped in an error boundary `<PanelBoundary>` so one failed chart cannot blank the dashboard) and `<SubCard>`.
- **[`components/ui/badge.tsx`](../frontend/components/ui/badge.tsx):** `<Badge>` and `<SeverityBadge>` (always pairs colour with text and/or numeric score).
- **[`components/ui/input.tsx`](../frontend/components/ui/input.tsx):** `<Input>` and `<Textarea>` with consistent `focus-visible:ring-2 focus-visible:ring-accent`.
- **[`components/ui/table.tsx`](../frontend/components/ui/table.tsx):** Accessible table primitives (`<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>`).
- **[`components/ui/tabs.tsx`](../frontend/components/ui/tabs.tsx):** The section rail (a left rail from `lg`, a bottom bar on phones): an ARIA tablist with arrow-key navigation and URL hash syncing (`#overview`, `#tools`, `#reviews`, `#departments`).
- **[`components/icons.tsx`](../frontend/components/icons.tsx):** Single-style 1.75px stroke SVG icons accepting `size` and `className`.

---

## 3. Responsive Layout & One-Screen Triage Mode

- **12-Column CSS Grid:** Every dashboard tab is laid out on `grid-cols-12 gap-6`.
- **One-Screen Fit (`dense:` variant):** On viewports at least `1280 × 740`, the **Overview** tab fits on a single screen at 100% zoom with zero vertical or horizontal scrolling (`Fit to screen`), or expands to full-height charts when switched to `Full page`.
- **Tablet & Mobile Adaptation:** Below `1280 × 740`, panels stack cleanly into 1- or 2-column scrolling layouts, and the tools table switches to touch-friendly cards on mobile viewports (`md:hidden`).

---

## 4. Accessibility (WCAG 2.1 AA) & Motion Contract

- **Keyboard Navigation & Shortcuts:**
  - `⌘K` / `Ctrl K` or `/` opens the [`CommandPalette`](../frontend/components/command-palette.tsx) (ARIA `combobox` + `listbox`).
  - `1`–`4` switch tabs, `R` refreshes data, and `?` displays keyboard shortcuts.
  - All dialogs ([`VendorDrawer`](../frontend/components/vendor-drawer.tsx), [`ReviewDialog`](../frontend/components/review-dialog.tsx), [`CompareDialog`](../frontend/components/compare-dialog.tsx), [`CommandPalette`](../frontend/components/command-palette.tsx)) trap `Tab` focus via [`use-focus-trap.ts`](../frontend/lib/use-focus-trap.ts) and restore focus to the trigger on `Escape`/close.
- **Interactive Charts & Traffic Map:**
  - [`TrafficMap`](../frontend/components/traffic-map.tsx) dots and pills expose full `aria-label` descriptions, keyboard focus rings, and an `aria-live="polite"` `role="tooltip"` details card (`DotDetails`).
  - [`DetectionColumns`](../frontend/components/insight-charts.tsx) implements `role="slider"` so daily detections can be inspected with Left/Right arrow keys without a mouse.
- **Meaningful Motion & Reduced Motion:**
  - Motion is driven by real server responses (`live.beat` and incoming telemetry events).
  - The **Motion** toggle (and `prefers-reduced-motion: reduce`) disables all CSS transitions, stagger delays, and rolling number animations across the entire app.

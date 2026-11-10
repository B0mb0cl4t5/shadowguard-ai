// Enforces the checkable rules in .clauderules against the UI source.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("..", import.meta.url));

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|css)$/.test(name) ? [path] : [];
  });
}

const files = ["app", "components"]
  .flatMap((d) => sources(join(frontend, d)))
  .map((path) => ({ name: relative(frontend, path).split(sep).join("/"), text: readFileSync(path, "utf8") }));

function offenders(pattern, list = files) {
  return list.filter((f) => pattern.test(f.text)).map((f) => f.name);
}

test("raw controls only appear inside components/ui", () => {
  const screens = files.filter((f) => !f.name.startsWith("components/ui/"));
  assert.deepEqual(offenders(/<(button|table|input|textarea|select)[\s>]/, screens), []);
});

test("no colours outside the tokens", () => {
  const banned = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|placeholder|decoration)-(?:zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;
  assert.deepEqual(offenders(banned), []);
});

test("no raw hex colours outside token definitions", () => {
  // globals.css defines the CSS custom properties (tokens) with hex values — that's the source.
  // layout.tsx sets the browser theme-color meta tag (#0b1120 = --ground), which cannot
  // read a CSS variable. Everywhere else must use var(--token).
  const screens = files.filter((f) => f.name !== "app/globals.css" && f.name !== "app/layout.tsx");
  assert.deepEqual(offenders(/#[0-9a-fA-F]{6}\b/, screens), []);
});

test("no decorative glass, glow, blur, pulsing or icon tiles", () => {
  assert.deepEqual(offenders(/\b(?:glass|aurora|shadow-[\w-]+|backdrop-blur[\w-]*|animate-pulse[\w-]*|TONE_STYLE\[meta)\b/), []);
});

test("only charts draw in; otherwise nothing performs an entrance except a dialog, toast, error or new traffic row", () => {
  // scale-in is only for a sign-in error. rise-in and slide-in are for surfaces someone just opened.
  const allowed = new Set(["components/login-form.tsx"]);
  assert.deepEqual(offenders(/animate-scale-in/, files.filter((f) => !allowed.has(f.name))), []);
  // Drawing in shows data arriving, so it belongs to the charts and nowhere else.
  const charts = new Set(["components/charts.tsx", "components/insight-charts.tsx", "components/traffic-map.tsx"]);
  assert.deepEqual(offenders(/animate-(?:wipe|grow-up|grow-x|pop|sweep|needle|draw)\b/, files.filter((f) => !charts.has(f.name))), []);
  assert.deepEqual(offenders(/animate-arrive\b/, files.filter((f) => f.name !== "components/live-traffic.tsx")), []);
});

test("no animation repeats on a timer of its own", () => {
  const config = readFileSync(join(frontend, "tailwind.config.ts"), "utf8");
  assert.doesNotMatch(config.slice(config.indexOf("animation: {")), /infinite/);
});

test("the connection's liveness is driven by the server's answers", () => {
  // The Live dot beats, and the next-check line restarts, once per answer: a new key replays the animation.
  const shell = files.find((f) => f.name === "components/dashboard-shell.tsx");
  assert.match(shell.text, /key=\{live\.beat\}[^>]*animate-beat/);
  assert.match(shell.text, /beat: current\.beat \+ 1/);
  assert.match(shell.text, /beat=\{stale \? null : live\.beat\}/);
  const traffic = files.find((f) => f.name === "components/live-traffic.tsx");
  assert.match(traffic.text, /key=\{beat\}[^>]*animate-countdown/);
});

test("switching motion off also stops stagger delays and rolling figures", () => {
  const css = files.find((f) => f.name === "app/globals.css");
  assert.match(css.text, /\.reduce-motion \*::after \{[^}]*animation-delay: 0ms !important/);
  assert.match(css.text, /prefers-reduced-motion: reduce\) \{[^}]*animation-delay: 0ms !important/);
  const roll = files.find((f) => f.name === "components/animated-number.tsx");
  assert.match(roll.text, /reduce-motion/);
  assert.match(roll.text, /prefers-reduced-motion: reduce/);
});

test("badges and data marks don't grow on hover", () => {
  const marks = files.filter((f) => ["components/ui/badge.tsx", "components/charts.tsx", "components/kpi-row.tsx"].includes(f.name));
  assert.deepEqual(offenders(/hover:scale|active:scale/, marks), []);
  const bars = files.find((f) => f.name === "components/insight-charts.tsx");
  assert.doesNotMatch(bars.text, /opacity-\d+ scale-|hover:scale-1(?:05|10)/);
});

test("risk-map dots ring on hover instead of growing, because their size is data", () => {
  const charts = files.find((f) => f.name === "components/insight-charts.tsx");
  assert.doesNotMatch(charts.text, /hover:scale|active:scale/);
});

test("motion matches how often a surface opens and where it comes from", () => {
  const palette = files.find((f) => f.name === "components/command-palette.tsx");
  assert.match(palette.text, /animate-fade-in/);
  const drawer = files.find((f) => f.name === "components/vendor-drawer.tsx");
  assert.match(drawer.text, /animate-drawer-in/);
});

test("a block decision's confirmation stays until dismissed", () => {
  const dialog = files.find((f) => f.name === "components/review-dialog.tsx");
  assert.match(dialog.text, /duration: 0/);
});

test("daily detections can be read without a mouse", () => {
  const charts = files.find((f) => f.name === "components/insight-charts.tsx");
  const columns = charts.text.slice(charts.text.indexOf("export function DetectionColumns"), charts.text.indexOf("const ZONES"));
  assert.match(columns, /role="slider"/);
  assert.match(columns, /onKeyDown/);
});

test("theme colours take no opacity modifier, which generates no CSS on a CSS variable", () => {
  const tokens = "ground|surface|raised|raised-hover|row-hover|line|rule|control|ink|ink2|muted|accent|data|positive|negative|warning";
  assert.deepEqual(offenders(new RegExp(`\\b(?:bg|text|border)-(?:${tokens})/\\d`)), []);
});

test("the animations button has CSS behind it", () => {
  const css = files.find((f) => f.name === "app/globals.css");
  assert.match(css.text, /\.reduce-motion \*/);
});

test("every browser request has a deadline, so a hung one can't freeze the screen", () => {
  const callers = [
    ...files.filter((f) => f.name.startsWith("components/")),
    { name: "lib/actions.ts", text: readFileSync(join(frontend, "lib", "actions.ts"), "utf8") },
  ];
  for (const f of callers) {
    const calls = (f.text.match(/(?<![\w.])fetch\(/g) ?? []).length;
    const deadlines = (f.text.match(/signal: AbortSignal\.timeout\(/g) ?? []).length;
    assert.equal(deadlines, calls, `${f.name}: ${calls} requests, ${deadlines} with a timeout`);
  }
});

test("every signed-in data route caps each client before calling the risk engine", () => {
  // All users share the dashboard's backend key, so one runaway client must not use up its allowance.
  const routes = readdirRoutes(join(frontend, "app", "api"), true).filter((r) => r.text.includes("requireSession("));
  assert.ok(routes.length >= 5);
  for (const r of routes) {
    assert.match(r.text, /overBudget\(request, "(?:read|write)"\)/, `${r.path} has no per-client limit`);
    const backendCall = r.text.search(/backendFetch(?:<[^>]*>)?\(/);
    assert.ok(backendCall > 0 && r.text.indexOf("overBudget(") < backendCall, `${r.path} limits after calling the backend`);
  }
});

test("the dashboard's severity bands match the risk engine's", () => {
  // The backend sends each tool's severity, but the dashboard also bands figures it computes
  // itself (the index, departments), so the two copies must never drift apart.
  const scoring = readFileSync(join(frontend, "..", "backend", "shadowguard", "scoring.py"), "utf8");
  const thresholds = scoring.match(/SEVERITY_THRESHOLDS[^=]*=\s*\(([^\n]+)\)/)?.[1] ?? "";
  const backend = [...thresholds.matchAll(/\((\d+),\s*"(\w+)"\)/g)].map((m) => [Number(m[1]), m[2]]);
  const format = readFileSync(join(frontend, "lib", "format.ts"), "utf8");
  const start = format.indexOf("export function severityFor");
  const severityFor = format.slice(start, format.indexOf("\n}", start));
  const dashboard = [...severityFor.matchAll(/score >= (\d+)\) return "(\w+)"/g)].map((m) => [Number(m[1]), m[2]]);
  assert.equal(backend.length, 3);
  assert.deepEqual(dashboard, backend);
});

test("one broken panel can't blank the dashboard, and a broken screen offers a way back", () => {
  const card = files.find((f) => f.name === "components/ui/card.tsx");
  assert.match(card.text, /<PanelBoundary label=\{title\}>\{children\}<\/PanelBoundary>/);
  const screen = files.find((f) => f.name === "app/error.tsx");
  assert.ok(screen, "app/error.tsx is missing");
  assert.match(screen.text, /onClick=\{reset\}/);
});

test("map dots show their details on hover, tap and keyboard focus, including the vendors' addresses", () => {
  const map = files.find((f) => f.name === "components/traffic-map.tsx");
  for (const handler of ["onPointerEnter", "onFocus", "onBlur", "onClick"]) assert.match(map.text, new RegExp(`${handler}=`));
  assert.match(map.text, /role="tooltip"/);
  assert.match(map.text, /aria-live="polite"/);
  assert.match(map.text, /aria-label="Traffic map legend"/);
  assert.match(map.text, /campus-beat-/);
  assert.match(map.text, /\.ips\.slice\(0, TIP_IPS\)/);
  assert.doesNotMatch(map.text, /<title>/, "a native title tooltip shows on hover only, after a delay");
});

test("a block is never reported until the server has answered", () => {
  const dialog = files.find((f) => f.name === "components/review-dialog.tsx");
  const saved = dialog.text.indexOf("await decideRemediation");
  assert.ok(saved > 0);
  assert.ok(saved < dialog.text.indexOf("onDecided();"));
  assert.ok(saved < dialog.text.indexOf("onToast({"));
  assert.ok(saved < dialog.text.indexOf("onClose();\n    } catch"));
});

test("a list row's compare button sits beside its open button, not inside it", () => {
  const panel = files.find((f) => f.name === "components/apps-panel.tsx");
  const row = panel.text.slice(panel.text.indexOf('<ul className="-mx-1 md:hidden">'), panel.text.indexOf("{/* Table:"));
  assert.ok(row.indexOf("</Button>") < row.indexOf("<CompareToggle"));
  // Every table row keeps the same number of cells as the header.
  const head = panel.text.slice(panel.text.indexOf("<TableHeader>"), panel.text.indexOf("</TableHeader>"));
  const body = panel.text.slice(panel.text.indexOf("<TableBody>"), panel.text.indexOf("</TableBody>"));
  const columns = (head.match(/header\("/g) ?? []).length + (head.match(/<TableHead\b/g) ?? []).length;
  assert.equal(columns, (body.match(/<TableCell\b/g) ?? []).length);
});

test("heatmap colour fills the whole cell", () => {
  const heatmap = files.find((f) => f.name === "components/department-heatmap.tsx");
  assert.match(heatmap.text, /flex h-11 w-full[^`]*\$\{\s*closed \? [^:]+: SEVERITY_STYLE\[severity\]\.cell/);
});

test("no text smaller than text-xs", () => {
  assert.deepEqual(offenders(/text-\[(?:0\.\d+rem|1[01]px|\d px)\]/), []);
});

test("no uppercase tracked labels", () => {
  assert.deepEqual(offenders(/\buppercase\b|tracking-wider|tracking-\[0\.1/), []);
});

test("no arbitrary Tailwind values off the documented scale", () => {
  // Typography must use the documented type scale (12, 13, 14, 16, 20, 26).
  // Flag arbitrary ``text-[...]`` sizes; layout widths (min-w-[...], max-w-[...])
  // are intentional and exempt.
  const arbitraryText = /text-\[(?:0?\.\d+(?:rem|px)|\d+px)\]/;
  assert.deepEqual(
    files.filter((f) => arbitraryText.test(f.text)).map((f) => f.name),
    [],
  );
});

test("pointer targets are at least 44px for touch", () => {
  // Buttons must be >= 44px on touch: either h-11/min-h-11/w-11/min-w-11 directly,
  // or a coarse-pointer (touch) fallback to h-11/min-h-11.
  const buttons = files.filter((f) => f.name === "components/ui/button.tsx");
  const touchFallback = /\[@media\(pointer:coarse\)\]:(?:h|min-h|w|min-w)-11/;
  const direct44 = /(?:^|\s)(?:h|min-h|w|min-w)-11(?:$|\s)/;
  assert.deepEqual(
    buttons.filter((f) => !direct44.test(f.text) && !touchFallback.test(f.text)).map((f) => f.name),
    [],
  );
});

test("focus-visible styling on interactive elements", () => {
  // Buttons, tabs, inputs must show focus-visible rings (no outline-none without focus-visible:ring).
  const interactive = files.filter((f) => /components\/(ui\/)?(button|tabs|input|link)\.tsx$/.test(f.name));
  const offenders = interactive.filter((f) => /outline-none/.test(f.text) && !/focus-visible:ring/.test(f.text));
  assert.deepEqual(offenders.map((f) => f.name), []);
});

test("nothing uses the Edge runtime, which Vercel Services reject", () => {
  const middleware = readFileSync(join(frontend, "middleware.ts"), "utf8");
  assert.match(middleware, /runtime:\s*"nodejs"/);
  const routes = sources(join(frontend, "app")).map((path) => readFileSync(path, "utf8"));
  const allRoutes = [...routes, ...readdirRoutes(join(frontend, "app"))];
  assert.equal(allRoutes.filter((text) => /runtime\s*=\s*["'](?:edge|experimental-edge)["']/.test(text)).length, 0);
});

function readdirRoutes(dir, withPaths = false) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return readdirRoutes(path, withPaths);
    if (name !== "route.ts") return [];
    const text = readFileSync(path, "utf8");
    return [withPaths ? { path: relative(frontend, path).split(sep).join("/"), text } : text];
  });
}

test("the screen is laid out on the 12-column grid", () => {
  const shell = files.find((f) => f.name === "components/dashboard-shell.tsx");
  assert.match(shell.text, /grid grid-cols-12 gap-6/);
});

test("empty heatmap cells stay blank", () => {
  const heatmap = files.find((f) => f.name === "components/department-heatmap.tsx");
  assert.doesNotMatch(heatmap.text, />\s*[–—-]\s*</);
});

test("Review buttons use the secondary style, never the white primary", () => {
  const queue = files.find((f) => f.name === "components/decision-queue.tsx");
  assert.match(queue.text, /variant="secondary"/);
  assert.doesNotMatch(queue.text, /variant=\{?"?primary/);
});

test("the trend chart has a fixed height", () => {
  const charts = files.find((f) => f.name === "components/charts.tsx");
  assert.match(charts.text, /relative flex h-(?:32|40|48|64|72|80)/);
});

test("only the Overview fits one screen, and only on a window big enough to hold it", () => {
  // `dense:` applies inside `.one-screen` on a wide and tall window; anything smaller keeps the scrolling layout.
  const config = readFileSync(join(frontend, "tailwind.config.ts"), "utf8");
  const variant = config.slice(config.indexOf('addVariant("dense"'));
  assert.match(variant, /min-width:\s*1280px/);
  assert.match(variant, /min-height:\s*740px/);
  assert.match(variant, /\.one-screen &/);
  const shell = files.find((f) => f.name === "components/dashboard-shell.tsx");
  assert.match(shell.text, /tab === "overview" && layout === "fit" \? "one-screen/);
  // The class is set in one place, so the other tabs keep their scrolling layout.
  assert.equal(offenders(/["'`]one-screen[\s"'`]/).join(), "components/dashboard-shell.tsx");
  assert.equal((shell.text.match(/["'`]one-screen[\s"'`]/g) ?? []).length, 1);
});

test("one-screen lists show whole rows and never scroll the page sideways", () => {
  // A list that wraps its extra rows into a hidden column must also be the containing block, or an
  // absolutely positioned child (sr-only text) escapes the clip and widens the page.
  const lists = files.flatMap((f) => (f.text.match(/className="[^"]*dense:flex-wrap[^"]*dense:overflow-hidden[^"]*"/g) ?? []).map((c) => ({ name: f.name, c })));
  assert.ok(lists.length >= 5, "the one-screen lists clip whole rows");
  assert.deepEqual(lists.filter(({ c }) => !c.includes("dense:relative")).map(({ name }) => name), []);
});

test("simulate route payload matches the backend TelemetryEvent schema", () => {
  const simulateRoute = readFileSync(join(frontend, "app", "api", "simulate", "route.ts"), "utf8");
  assert.match(simulateRoute, /\bbytes_out:/);
  assert.match(simulateRoute, /\bbytes_in:/);
  assert.doesNotMatch(simulateRoute, /\bbytes_up\b|\bbytes_down\b/);
});

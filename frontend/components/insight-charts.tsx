"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_STYLE, severityFor, shortDate } from "@/lib/format";
import type { DepartmentExposure, Severity, ShadowApp, TrendPoint } from "@/lib/types";

import { Button } from "./ui/button";

/* Small SVG and HTML charts drawn from the dashboard's own data, with no chart library. */

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const align = x > 70 ? "-translate-x-full" : x < 30 ? "" : "-translate-x-1/2";
  return (
    <div
      className={`pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-md border border-control bg-raised px-2.5 py-1.5 text-xs text-ink ${align}`}
      style={{ left: `${x}%`, top: `calc(${y}% - 10px)` }}
    >
      {children}
    </div>
  );
}

/** Semicircular gauge for the 0–100 index, with its severity bands and a marker at the value. */
export function ExposureGauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 52;
  const point = (pct: number) => {
    const a = Math.PI * (1 - pct / 100);
    return [64 + r * Math.cos(a), 64 - r * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const bands: [number, number, Severity][] = [
    [0, 29, "low"],
    [31, 49, "moderate"],
    [51, 69, "high"],
    [71, 100, "critical"],
  ];
  const [zx, zy] = point(0);
  return (
    <svg viewBox="0 0 128 72" className="w-full overflow-visible" role="img" aria-label={`Exposure index ${v.toFixed(1)} of 100`}>
      {bands.map(([a, b, s]) => (
        <path key={s} d={arc(a, b)} style={{ stroke: SEVERITY_STYLE[s].stroke }} strokeWidth="9" fill="none" />
      ))}
      {/* The marker sits at zero and turns to the value: it sweeps up on load and glides when a poll moves the index. */}
      <g className="animate-needle transition-[rotate] duration-700 ease-out" style={{ rotate: `${v * 1.8}deg`, transformOrigin: "64px 64px" }}>
        <circle cx={zx} cy={zy} r="6.5" style={{ fill: "var(--surface)", stroke: "var(--text)" }} strokeWidth="3" />
      </g>
    </svg>
  );
}

const MAX_DOTS = 12;

/** One dot per item, so a small count reads as a count at a glance. A large count stops at a dozen and says how many more. */
export function UnitDots({ marks, label }: { marks: string[]; label: string }) {
  const extra = marks.length - MAX_DOTS;
  return (
    <span className="flex flex-wrap items-center gap-1" role="img" aria-label={label} title={label}>
      {/* Each dot pops in, one after another, so the count is seen being made; a new item pops in on its own. */}
      {marks.slice(0, MAX_DOTS).map((mark, i) => (
        <span key={i} className={`h-2.5 w-2.5 animate-pop rounded-full ${mark}`} style={{ animationDelay: `${200 + i * 45}ms` }} />
      ))}
      {extra > 0 && <span className="font-mono text-xs text-muted">+{extra}</span>}
    </span>
  );
}

/** Share of tool and department pairs at each severity, with the counts as its legend. */
export function SeverityRing({ counts }: { counts: Record<Severity, number> }) {
  const [active, setActive] = useState<Severity | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const total = SEVERITY_ORDER.reduce((sum, s) => sum + counts[s], 0);
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const gap = total > 1 ? 3 : 0;
  let offset = 0;

  if (total === 0) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 dense:min-h-0 dense:flex-1 dense:flex-nowrap dense:justify-start dense:gap-x-4">
        <div className="relative h-40 w-40 shrink-0 dense:aspect-square dense:h-full dense:max-h-40 dense:w-auto">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="64" cy="64" r={r} fill="none" style={{ stroke: "var(--raised)" }} strokeWidth="13" />
          </svg>
          <div className="absolute inset-0 grid place-content-center text-center">
            <span className="font-mono text-title font-semibold leading-none text-ink dense:text-lg">0</span>
            <span className="mt-1 text-xs text-muted dense:sr-only">exposures</span>
          </div>
        </div>
        <p className="text-sm text-muted">No tools have been scored yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 dense:min-h-0 dense:flex-1 dense:flex-nowrap dense:justify-start dense:gap-x-4">
      <div className="relative h-40 w-40 shrink-0 dense:aspect-square dense:h-full dense:max-h-40 dense:w-auto">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="64" cy="64" r={r} fill="none" style={{ stroke: "var(--raised)" }} strokeWidth="13" />
          {SEVERITY_ORDER.map((s) => {
            const length = total ? (counts[s] / total) * circumference : 0;
            const dash = Math.max(0, length - gap);
            const segment = (
              <circle
                key={s}
                cx="64"
                cy="64"
                r={r}
                fill="none"
                style={{ stroke: SEVERITY_STYLE[s].stroke, opacity: active && active !== s ? 0.3 : 1 }}
                strokeWidth={active === s ? 16 : 13}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                className="animate-sweep transition-[opacity,stroke-width]"
              />
            );
            offset += length;
            return segment;
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span className="font-mono text-title font-semibold leading-none text-ink dense:text-lg">{active ? counts[active] : total}</span>
          <span className="mt-1 text-xs text-muted dense:sr-only">{active ? SEVERITY_LABEL[active] : "exposures"}</span>
        </div>
      </div>
      {/* One Tab stop for the whole legend; the arrow keys move between severities and light up that slice. */}
      <ul className="min-w-36 flex-1 space-y-1 dense:space-y-0" aria-label="Exposures by severity">
        {SEVERITY_ORDER.map((s, i) => {
          const move = (step: number) => items.current[(i + step + SEVERITY_ORDER.length) % SEVERITY_ORDER.length]?.focus();
          return (
            <li
              key={s}
              ref={(el) => {
                items.current[i] = el;
              }}
              tabIndex={i === focusIndex ? 0 : -1}
              onFocus={() => {
                setFocusIndex(i);
                setActive(s);
              }}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(s)}
              onMouseLeave={() => setActive(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                  e.preventDefault();
                  move(1);
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  move(-1);
                }
              }}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-raised focus-visible:bg-raised dense:py-0 dense:leading-[18px]"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY_STYLE[s].mark}`} />
              <span className="flex-1 text-ink2">{SEVERITY_LABEL[s]}</span>
              <span className="font-mono text-ink">{counts[s]}</span>
              <span className="w-10 text-right font-mono text-xs text-muted">{total ? Math.round((counts[s] / total) * 100) : 0}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Departments ranked by their worst exposure. */
export function DepartmentBars({ departments }: { departments: DepartmentExposure[] }) {
  const rows = [...departments].sort((a, b) => b.max_score - a.max_score || a.name.localeCompare(b.name));

  if (rows.length === 0) {
    return <p className="py-10 text-sm text-muted">No department data yet.</p>;
  }

  return (
    // On one screen (dense) only whole rows show; the rest wrap into a hidden second column.
    <ul className="space-y-2.5 dense:relative dense:flex dense:min-h-0 dense:flex-1 dense:flex-col dense:flex-wrap dense:gap-y-1 dense:space-y-0 dense:overflow-hidden">
      {rows.map((d, i) => {
        const severity = severityFor(d.max_score);
        return (
          // On one screen (dense) each department is one line: name, bar, score.
          <li
            key={d.name}
            className="dense:flex dense:w-full dense:items-center dense:gap-3 dense:text-sm dense:leading-[18px]"
            title={`${d.name}: ${d.max_score}, ${SEVERITY_LABEL[severity]}, ${d.shadow_tools} shadow tools`}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm dense:contents">
              <span className="min-w-0 truncate text-ink2 dense:w-2/5 dense:shrink-0">{d.name}</span>
              <span className="shrink-0 font-mono text-ink dense:order-last dense:w-7 dense:text-right">
                {d.max_score}
                <span className="sr-only"> {SEVERITY_LABEL[severity]}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-raised overflow-hidden dense:flex-1" aria-hidden>
              <div
                className={`h-full origin-left animate-grow-x rounded-full ${SEVERITY_STYLE[severity].mark} transition-[width] duration-500 ease-out`}
                style={{ width: `${d.max_score}%`, animationDelay: `${i * 50}ms` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Detections per day, split into critical and the rest. The readout above the columns
 * follows a mouse, a finger or the arrow keys, so every day's count can be read without hovering.
 */
export function DetectionColumns({ points }: { points: TrendPoint[] }) {
  const [pick, setPick] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const top = Math.max(10, ...points.map((p) => p.detections));
  const max = Math.ceil(top / 10) * 10;

  if (points.length === 0) return <p className="py-10 text-sm text-muted">No detections yet.</p>;

  const index = pick ?? points.length - 1;
  const active = points[index]!;
  const choose = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.min(0.999, Math.max(0, (clientX - rect.left) / rect.width));
    setPick(Math.floor(ratio * points.length));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    setPick(Math.min(points.length - 1, Math.max(0, index + step)));
  };

  return (
    // On one screen (dense) the columns take whatever height the panel has; elsewhere a fixed h-48.
    <div className="dense:flex dense:min-h-0 dense:flex-1 dense:flex-col">
      <p className="mb-3 flex min-h-5 flex-wrap items-baseline gap-x-2 text-xs text-muted dense:mb-1 dense:flex-nowrap dense:truncate">
        <span className="font-mono text-sm font-medium text-ink">{active.detections}</span>
        <span>
          detections, <span className="font-mono text-negative">{active.critical}</span> critical, on{" "}
          <span className="font-mono">{shortDate(active.day)}</span>
        </span>
      </p>
      <div className="relative flex h-48 dense:h-auto dense:min-h-0 dense:flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between font-mono text-xs leading-none text-muted">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div
          ref={plot}
          className="relative ml-7 flex flex-1 touch-pan-y items-end gap-0.5 rounded-sm"
          role="slider"
          tabIndex={0}
          aria-label={`Detections per day, ${shortDate(points[0]!.day)} to ${shortDate(points[points.length - 1]!.day)}: ${points.reduce((sum, p) => sum + p.detections, 0)} in total, ${points.reduce((sum, p) => sum + p.critical, 0)} critical. Use the left and right arrow keys to read each day.`}
          aria-valuemin={0}
          aria-valuemax={points.length - 1}
          aria-valuenow={index}
          aria-valuetext={`${shortDate(active.day)}: ${active.detections} detections, ${active.critical} critical`}
          onKeyDown={onKey}
          onBlur={() => setPick(null)}
          onPointerDown={(e) => choose(e.clientX)}
          onPointerMove={(e) => choose(e.clientX)}
          // A finger lifting also "leaves", so only a mouse resets the readout to today.
          onPointerLeave={(e) => e.pointerType === "mouse" && setPick(null)}
        >
          {[0, 50, 100].map((t) => (
            <span key={t} className="pointer-events-none absolute inset-x-0 border-t border-rule" style={{ top: `${t}%` }} />
          ))}
          {points.map((p, i) => {
            const rest = Math.max(0, p.detections - p.critical);
            return (
              <div
                key={p.day}
                className={`pointer-events-none relative flex h-full flex-1 origin-bottom animate-grow-up flex-col justify-end gap-px rounded-sm transition-opacity ${pick !== null && pick !== i ? "opacity-50" : ""}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="rounded-t-sm bg-sev-critical transition-[height] duration-300 ease-out" style={{ height: `${(p.critical / max) * 100}%` }} />
                <div className={`bg-data ${p.critical === 0 ? "rounded-t-sm" : ""} transition-[height] duration-300 ease-out`} style={{ height: `${(rest / max) * 100}%` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="ml-7 mt-2 flex justify-between font-mono text-xs text-muted dense:mt-1">
        <span>{shortDate(points[0]!.day)}</span>
        <span>{shortDate(points[points.length - 1]!.day)}</span>
      </div>
    </div>
  );
}

const ZONES: { severity: Severity; from: number; to: number; tint: string }[] = [
  { severity: "critical", from: 70, to: 100, tint: "bg-tone-danger" },
  { severity: "high", from: 50, to: 70, tint: "bg-tone-warning" },
  { severity: "moderate", from: 30, to: 50, tint: "bg-tone-info" },
  { severity: "low", from: 0, to: 30, tint: "bg-tone-success" },
];

/**
 * The risk map: how exposed each tool is against how many people use it, so the
 * top right is what to deal with first. A larger dot reaches more departments.
 */
export function RiskMap({
  apps,
  exposureWindowDays = 7,
  onOpen,
}: {
  apps: ShadowApp[];
  exposureWindowDays?: number;
  onOpen: (app: ShadowApp) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const xMax = Math.ceil(Math.max(10, ...apps.map((a) => a.total_users)) / 10) * 10;
  // Round ticks, at most five steps across whatever the user count is.
  const xStep = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => xMax / s <= 5) ?? xMax;
  const xTicks = Array.from({ length: Math.floor(xMax / xStep) + 1 }, (_, i) => i * xStep);

  const dots = useMemo(() => {
    // A label's share of the plot on a phone, which is the narrowest it gets.
    const LABEL = 34;
    const placed: { left: number; y: number }[] = [];
    return [...apps]
      .sort((a, b) => b.max_score - a.max_score)
      .map((app) => {
        const x = Math.min(96, Math.max(3, (app.total_users / xMax) * 100));
        const y = Math.min(96, Math.max(4, 100 - app.max_score));
        const flip = x > 66;
        const left = flip ? x - LABEL : x;
        // Labels that would land on one another step down by a line.
        let shift = 0;
        while (placed.some((p) => left < p.left + LABEL && left + LABEL > p.left && Math.abs(p.y - (y + shift * 5)) < 5)) shift += 1;
        placed.push({ left, y: y + shift * 5 });
        return { app, x, y, shift, flip };
      });
  }, [apps, xMax]);

  const active = dots.find((d) => d.app.id === hover);

  return (
    <div>
      <div className="relative flex h-80">
        <div className="pointer-events-none relative w-8 shrink-0 font-mono text-xs leading-none text-muted" aria-hidden>
          {[100, 70, 50, 30, 0].map((t) => (
            <span key={t} className="absolute -translate-y-1/2" style={{ top: `${100 - t}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex-1 overflow-visible rounded-md">
          {ZONES.map((z) => (
            <div
              key={z.severity}
              className={`absolute inset-x-0 flex items-start justify-end px-2 pt-1 text-xs ${z.tint} ${SEVERITY_STYLE[z.severity].text}`}
              style={{ top: `${100 - z.to}%`, height: `${z.to - z.from}%` }}
            >
              {SEVERITY_LABEL[z.severity]}
            </div>
          ))}
          {dots.map(({ app, x, y, shift, flip }, rank) => {
            const size = 10 + app.departments.length * 4;
            return (
              <Button
                key={app.id}
                variant="bare"
                onClick={() => onOpen(app)}
                onPointerEnter={() => setHover(app.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(app.id)}
                onBlur={() => setHover(null)}
                className="group absolute grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={`${app.name}: exposure ${app.max_score}, ${app.total_users} users, ${app.departments.length} departments`}
              >
                <span
                  // The dot's size is data (how many departments), so hover rings it instead of growing it.
                  className={`block animate-pop rounded-full ${SEVERITY_STYLE[app.severity].mark} ring-2 ring-surface transition-shadow group-hover:ring-ink group-focus-visible:ring-ink`}
                  style={{ width: size, height: size, animationDelay: `${rank * 60}ms` }}
                />
                <span
                  className={`pointer-events-none absolute whitespace-nowrap text-xs font-medium text-ink ${flip ? "right-full mr-1" : "left-full ml-1"}`}
                  style={{ top: `calc(50% - 8px + ${shift * 16}px)` }}
                >
                  {app.name}
                </span>
              </Button>
            );
          })}
          {active && (
            <Tip x={active.x} y={active.y - 3}>
              <span className="font-medium">{active.app.name}</span>: exposure <span className="font-mono">{active.app.max_score}</span>,{" "}
              <span className="font-mono">{active.app.total_users}</span> users, <span className="font-mono">{active.app.departments.length}</span>{" "}
              {active.app.departments.length === 1 ? "department" : "departments"}
            </Tip>
          )}
        </div>
      </div>
      <div className="relative ml-8 mt-2 h-4 font-mono text-xs text-muted" aria-hidden>
        {xTicks.map((t) => (
          <span key={t} className={`absolute ${t === xMax ? "-translate-x-full" : t === 0 ? "" : "-translate-x-1/2"}`} style={{ left: `${(t / xMax) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <p className="ml-8 mt-1 text-xs text-muted">
        Users in the last <span className="font-mono">{exposureWindowDays}</span> days across the university. A larger dot reaches more departments.
      </p>
    </div>
  );
}

const TRAINING: { value: ShadowApp["trains_on_inputs"]; label: string; mark: string }[] = [
  { value: "yes", label: "Says it trains on your data", mark: "bg-sev-critical" },
  { value: "unknown", label: "Doesn't say", mark: "bg-sev-high" },
  { value: "no", label: "Says it doesn't train", mark: "bg-sev-low" },
];

/** What each vendor's privacy policy says about training on what staff paste in. */
export function TrainingBreakdown({ apps, onOpen }: { apps: ShadowApp[]; onOpen: (app: ShadowApp) => void }) {
  const groups = TRAINING.map((t) => ({ ...t, apps: apps.filter((a) => a.trains_on_inputs === t.value) }));
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={groups.map((g) => `${g.label}: ${g.apps.length}`).join(", ")}>
        {groups.map((g) =>
          g.apps.length ? <div key={g.value} className={g.mark} style={{ width: `${(g.apps.length / Math.max(1, apps.length)) * 100}%` }} /> : null,
        )}
      </div>
      <ul className="mt-4 space-y-4">
        {groups.map((g) => (
          <li key={g.value}>
            <p className="flex items-center gap-2 text-sm">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${g.mark}`} />
              <span className="flex-1 text-ink2">{g.label}</span>
              <span className="font-mono text-ink">{g.apps.length}</span>
            </p>
            {g.apps.length > 0 && (
              <p className="ml-4 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {g.apps.map((app) => (
                  <Button key={app.id} variant="bare" onClick={() => onOpen(app)} className="text-muted transition-colors hover:text-ink hover:underline">
                    {app.name}
                    {/* The policy reader's quote couldn't be checked, so this reading isn't a fact yet. */}
                    {app.verification_status === "unverified" && <span className="text-warning"> (unverified)</span>}
                  </Button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

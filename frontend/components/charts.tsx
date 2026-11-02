"use client";

import { useId, useMemo, useRef, useState } from "react";

import { SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_STYLE, severityFor, shortDate } from "@/lib/format";
import type { Severity, TrendPoint } from "@/lib/types";

const SEVERITY_HEX: Record<Severity, string> = {
  critical: "#f43f5e",
  high: "#fb923c",
  moderate: "#fde047",
  low: "#34d399",
};

/** Semicircular gauge for the 0–100 Risk Exposure Index, banded at the severity thresholds. */
export function ExposureGauge({ value }: { value: number }) {
  const id = useId().replace(/:/g, "");
  const v = Math.max(0, Math.min(100, value));
  const r = 52;
  const cx = 64;
  const cy = 64;
  const point = (pct: number) => {
    const a = Math.PI * (1 - pct / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const [nx, ny] = point(v);
  const sev = severityFor(v);
  const bands: [number, number, Severity][] = [
    [0, 29.5, "low"],
    [30.5, 49.5, "moderate"],
    [50.5, 69.5, "high"],
    [70.5, 100, "critical"],
  ];
  return (
    <svg viewBox="0 0 128 76" className="w-full max-w-[9.5rem]" role="img" aria-label={`Exposure index ${v} of 100`}>
      <defs>
        <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path d={arc(0, 100)} stroke="rgba(148,163,184,0.12)" strokeWidth="9" fill="none" strokeLinecap="round" />
      {bands.map(([a, b, s]) => (
        <path key={s} d={arc(a, b)} stroke={SEVERITY_HEX[s]} strokeOpacity={0.28} strokeWidth="9" fill="none" />
      ))}
      <path d={arc(0, Math.max(0.5, v))} stroke={SEVERITY_HEX[sev]} strokeWidth="9" fill="none" strokeLinecap="round" />
      <circle cx={nx} cy={ny} r="7" fill={SEVERITY_HEX[sev]} opacity="0.55" filter={`url(#glow-${id})`} />
      <circle cx={nx} cy={ny} r="4.2" fill="#05070d" stroke={SEVERITY_HEX[sev]} strokeWidth="2.2" />
    </svg>
  );
}

/** 14-day trend of the exposure index, with a hover/touch readout. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 200;
  const PAD_T = 12;
  const PAD_B = 8;

  const geo = useMemo(() => {
    const n = points.length;
    const values = points.map((p) => p.exposure_index);
    const max = Math.min(100, Math.ceil((Math.max(...values, 10) + 8) / 10) * 10);
    const min = Math.max(0, Math.floor((Math.min(...values, max) - 8) / 10) * 10);
    const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number) => PAD_T + (1 - (v - min) / Math.max(1, max - min)) * (H - PAD_T - PAD_B);
    const coords = points.map((p, i) => [x(i), y(p.exposure_index)] as const);
    const line = coords.map(([cx, cy], i) => `${i ? "L" : "M"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
    const area = coords.length ? `${line} L${W},${H} L0,${H} Z` : "";
    const ticks = [min, (min + max) / 2, max];
    return { coords, line, area, ticks, y, min, max };
  }, [points]);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">No history yet.</p>;
  }

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || points.length < 2) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (points.length - 1)));
  };

  const active = hover !== null ? points[hover] : points[points.length - 1];
  const activeCoord = hover !== null ? geo.coords[hover] : geo.coords[geo.coords.length - 1];
  const sev = severityFor(active?.exposure_index ?? 0);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-mono text-2xl font-semibold text-white">
          {active?.exposure_index.toFixed(1)}
        </span>
        <span className={`text-xs ${SEVERITY_STYLE[sev].text}`}>{SEVERITY_LABEL[sev]}</span>
        <span className="text-xs text-slate-400">
          {active ? shortDate(active.day) : ""} · {active?.detections ?? 0} detections · {active?.critical ?? 0} critical
        </span>
      </div>
      {/* Plot area grows to fill the card, so the card height is set by its row neighbour. */}
      <div className="relative flex min-h-44 flex-1 sm:min-h-52">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between text-[0.65rem] leading-none text-slate-500">
          {[...geo.ticks].reverse().map((t) => (
            <span key={t} className="tabular font-mono">
              {Math.round(t)}
            </span>
          ))}
        </div>
        <div
          ref={ref}
          className="relative ml-7 flex-1 touch-pan-y"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#5eead4" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
              </linearGradient>
            </defs>
            {geo.ticks.map((t) => (
              <line
                key={t}
                x1="0"
                x2={W}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke="rgba(148,163,184,0.12)"
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {[70, 50].filter((t) => t > geo.min && t < geo.max).map((t) => (
              <line
                key={`th-${t}`}
                x1="0"
                x2={W}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke={t === 70 ? "rgba(244,63,94,0.45)" : "rgba(251,146,60,0.4)"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={geo.area} fill={`url(#fill-${id})`} />
            <path
              d={geo.line}
              fill="none"
              stroke="#5eead4"
              strokeWidth="2.25"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
          {activeCoord && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-white/15"
                style={{ left: `${(activeCoord[0] / W) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-signal bg-ink-950 shadow-glow-signal"
                style={{ left: `${(activeCoord[0] / W) * 100}%`, top: `${(activeCoord[1] / H) * 100}%` }}
              />
            </>
          )}
        </div>
      </div>
      <div className="ml-7 mt-2 flex justify-between text-[0.65rem] text-slate-500">
        <span>{shortDate(points[0]!.day)}</span>
        <span className="hidden sm:inline">{shortDate(points[Math.floor(points.length / 2)]!.day)}</span>
        <span>Today</span>
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-4 bg-rose-400/70" /> Critical threshold (70)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-4 bg-orange-400/70" /> High threshold (50)
        </span>
      </p>
    </div>
  );
}

/** One horizontal bar split by severity, plus counts. */
export function SeverityBar({ counts }: { counts: Record<Severity, number> }) {
  const total = SEVERITY_ORDER.reduce((s, k) => s + counts[k], 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Detections by severity">
        {total > 0 &&
          SEVERITY_ORDER.map((s) =>
            counts[s] ? (
              <div
                key={s}
                className={`${SEVERITY_STYLE[s].bar} h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full`}
                style={{ width: `${(counts[s] / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        {SEVERITY_ORDER.map((s) => (
          <div key={s} className="min-w-0">
            <dt className="flex items-center gap-1.5 truncate text-[0.7rem] text-slate-400">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_STYLE[s].dot}`} />
              {SEVERITY_LABEL[s]}
            </dt>
            <dd className="tabular font-mono text-lg font-semibold text-white">{counts[s]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

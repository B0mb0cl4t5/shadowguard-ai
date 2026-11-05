"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { SEVERITY_LABEL, SEVERITY_STYLE, severityFor, shortDate } from "@/lib/format";
import type { TrendPoint } from "@/lib/types";

/** 14-day trend of the exposure index, with a hover, touch and keyboard readout. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 200;
  const PAD_T = 8;
  const PAD_B = 4;

  const geo = useMemo(() => {
    const n = points.length;
    const values = points.map((p) => p.exposure_index);
    // The scale hugs the data so the trend uses the full height; the ticks state the range.
    const STEP = 5;
    const top = Math.max(...values, 0);
    const bottom = Math.min(...values, top);
    const max = Math.min(100, Math.ceil((top + 1) / STEP) * STEP);
    const min = Math.max(0, Math.min(max - 2 * STEP, Math.floor((bottom - 1) / STEP) * STEP));
    const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number) => PAD_T + (1 - (v - min) / Math.max(1, max - min)) * (H - PAD_T - PAD_B);
    const coords = points.map((p, i) => [x(i), y(p.exposure_index)] as const);
    const line = coords.map(([cx, cy], i) => `${i ? "L" : "M"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
    const area = coords.length ? `${line} L${W},${H} L0,${H} Z` : "";
    const ticks = [min, (min + max) / 2, max];
    return { coords, line, area, ticks, y, min, max };
  }, [points]);

  if (points.length === 0) {
    return <p className="py-10 text-sm text-muted">No history yet. The trend starts after the first day of telemetry.</p>;
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
  const activeIndex = hover ?? points.length - 1;
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    setHover(Math.min(points.length - 1, Math.max(0, activeIndex + step)));
  };

  return (
    <div>
      {/* The readout follows the pointer or arrow keys. The headline figure is in the strip above. */}
      <p className="mb-3 flex min-h-5 flex-wrap items-baseline gap-x-2 text-xs text-muted">
        <span className="font-mono text-sm font-medium text-ink">{active?.exposure_index.toFixed(1)}</span>
        <span className={SEVERITY_STYLE[sev].text}>{SEVERITY_LABEL[sev]}</span>
        <span>
          on <span className="font-mono">{active ? shortDate(active.day) : ""}</span>,{" "}
          <span className="font-mono">{active?.detections ?? 0}</span> detections
        </span>
      </p>
      <div className="relative flex h-48">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between font-mono text-xs leading-none text-muted">
          {[...geo.ticks].reverse().map((t) => (
            <span key={t}>{Math.round(t)}</span>
          ))}
        </div>
        <div
          ref={ref}
          className="relative ml-7 flex-1 touch-pan-y rounded-sm"
          role="slider"
          tabIndex={0}
          aria-label={`Risk exposure index by day. It went from ${first.exposure_index.toFixed(1)} on ${shortDate(first.day)} to ${last.exposure_index.toFixed(1)} on ${shortDate(last.day)}. Use the left and right arrow keys to read each day.`}
          aria-valuemin={0}
          aria-valuemax={points.length - 1}
          aria-valuenow={activeIndex}
          aria-valuetext={active ? `${shortDate(active.day)}: ${active.exposure_index.toFixed(1)}, ${SEVERITY_LABEL[sev]}` : undefined}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--data)" }} stopOpacity="0.45" />
                <stop offset="100%" style={{ stopColor: "var(--data)" }} stopOpacity="0" />
              </linearGradient>
            </defs>
            {geo.ticks.map((t) => (
              <line key={t} x1="0" x2={W} y1={geo.y(t)} y2={geo.y(t)} style={{ stroke: "var(--raised)" }} vectorEffect="non-scaling-stroke" />
            ))}
            {[70, 50].filter((t) => t > geo.min && t < geo.max).map((t) => (
              <line
                key={`th-${t}`}
                x1="0"
                x2={W}
                y1={geo.y(t)}
                y2={geo.y(t)}
                style={{ stroke: t === 70 ? "var(--negative)" : "var(--warning)" }}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={geo.area} fill={`url(#fill-${id})`} />
            <path d={geo.line} fill="none" style={{ stroke: "var(--data)" }} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {[70, 50].filter((t) => t > geo.min && t < geo.max).map((t) => (
            <span
              key={`label-${t}`}
              className={`pointer-events-none absolute left-1 -translate-y-full text-xs ${t === 70 ? "text-negative" : "text-warning"}`}
              style={{ top: `${(geo.y(t) / H) * 100}%` }}
            >
              {t === 70 ? "Critical" : "High"} <span className="font-mono">{t}</span>
            </span>
          ))}
          {activeCoord && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-control" style={{ left: `${(activeCoord[0] / W) * 100}%` }} />
              <div
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-data"
                style={{ left: `${(activeCoord[0] / W) * 100}%`, top: `${(activeCoord[1] / H) * 100}%` }}
              />
            </>
          )}
        </div>
      </div>
      <div className="ml-7 mt-2 flex justify-between font-mono text-xs text-muted">
        <span>{shortDate(points[0]!.day)}</span>
        <span>{shortDate(points[Math.floor(points.length / 2)]!.day)}</span>
        <span>{shortDate(last.day)}</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { SEVERITY_LABEL, SEVERITY_STYLE, formatBytes } from "@/lib/format";
import type { DataLocation, DestinationIp, LiveEvent, LiveFeed, Severity, ShadowApp } from "@/lib/types";
import { MAP_H as H, MAP_W as W, dotPath, isMalaysia, project, type Point } from "@/lib/world-map";

import { AnimatedNumber } from "./animated-number";
import { Button } from "./ui/button";

/** Which land dots belong to a region, so a region with traffic lights up rather than only getting a marker. */
const REGION_LAND: Partial<Record<DataLocation, (lon: number, lat: number) => boolean>> = {
  US: (lon, lat) => (lon >= -125 && lon <= -66 && lat >= 25 && lat <= 49) || (lon >= -168 && lon <= -141 && lat >= 54 && lat <= 72),
  EU: (lon, lat) => lon >= -11 && lon <= 31 && lat >= 36 && lat <= 71 && !(lon >= 26 && lat < 42),
  SG: (lon, lat) => lon >= 102 && lon <= 106 && lat >= 0 && lat <= 2,
  MY: isMalaysia,
};

const LAND_PATH = dotPath();
const REGION_PATHS = Object.fromEntries(
  Object.entries(REGION_LAND).map(([id, keep]) => [id, dotPath(keep)]),
) as Partial<Record<DataLocation, string>>;

/** The university is in Malaysia, which is why the scoring treats Malaysia as home. */
const HOME = project(101.7, 3.1);

/** Whole regions, not data centres. Singapore and Malaysia sit beside the campus, so they're nudged clear of its marker. */
const REGIONS: Record<DataLocation, { label: string; at?: Point }> = {
  US: { label: "United States", at: project(-98, 39) },
  EU: { label: "Europe", at: project(10, 50) },
  SG: { label: "Singapore", at: project(108, -7) },
  MY: { label: "Malaysia", at: project(93, 12) },
  OTHER: { label: "Elsewhere, outside these regions" },
  unknown: { label: "Policy doesn't say" },
};

type Flow = {
  id: DataLocation;
  label: string;
  at?: Point;
  apps: ShadowApp[];
  bytes: number;
  bytesIn: number;
  ips: DestinationIp[];
  worst: Severity;
  score: number;
};

const MAX_IPS = 4;
/** Addresses listed in a dot's details card; the list under the map has the rest. */
const TIP_IPS = 5;
const PULSE_MS = 1400;
/** The ring where a dot lands starts just before the dot fades out. */
const LAND_AT = PULSE_MS * 0.9;
const LAND_MS = 700;
const MAX_PULSES_PER_BATCH = 6;
/** In the draw-in, when an outbound arc (900ms) has nearly reached its region and the marker lands. */
const ARRIVE_MS = 750;
const STAGGER_MS = 120;

/** The busiest addresses across a region's tools, largest first. */
function busiestIps(apps: ShadowApp[]): DestinationIp[] {
  const merged = new Map<string, DestinationIp>();
  for (const { ip, bytes_out, bytes_in } of apps.flatMap((a) => a.dest_ips)) {
    const seen = merged.get(ip);
    merged.set(ip, { ip, bytes_out: bytes_out + (seen?.bytes_out ?? 0), bytes_in: bytes_in + (seen?.bytes_in ?? 0) });
  }
  return [...merged.values()].sort((a, b) => b.bytes_out + b.bytes_in - a.bytes_out - a.bytes_in);
}

const arcPath = ([x1, y1]: Point, [x2, y2]: Point, bend: number) => {
  const lift = Math.min(150, Math.hypot(x2 - x1, y2 - y1) * bend);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${((x1 + x2) / 2).toFixed(1)} ${(Math.min(y1, y2) - lift).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};
const outPath = (at: Point) => arcPath(HOME, at, 0.28);
const inPath = (at: Point) => arcPath(at, HOME, 0.12);

type Pulse = { key: string; region: DataLocation; direction: "out" | "in"; delay: number };

/**
 * One dot per real event as it arrives, travelling the arc once. Nothing moves unless
 * traffic does, so a still map means a quiet network. The first batch is history, so it
 * only sets the starting point.
 */
function usePulses(events: LiveEvent[]): Pulse[] {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const seen = useRef<Set<number> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (events.length === 0) return;
    if (seen.current === null) {
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    const known = seen.current;
    const fresh = events.filter((e) => !known.has(e.id));
    fresh.forEach((e) => known.add(e.id));
    const batch = fresh
      .filter((e) => REGIONS[e.data_location].at)
      .slice(0, MAX_PULSES_PER_BATCH)
      .flatMap((e, i): Pulse[] => [
        ...(e.bytes_out > 0 ? [{ key: `${e.id}-out`, region: e.data_location, direction: "out" as const, delay: i * 500 }] : []),
        ...(e.bytes_in > 0 ? [{ key: `${e.id}-in`, region: e.data_location, direction: "in" as const, delay: i * 500 + 250 }] : []),
      ]);
    if (batch.length === 0) return;
    setPulses((current) => [...current, ...batch]);
    const longest = Math.max(...batch.map((p) => p.delay)) + LAND_AT + LAND_MS + 100;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const done = new Set(batch.map((p) => p.key));
      setPulses((current) => current.filter((p) => !done.has(p.key)));
    }, longest);
    timers.current.add(timer);
  }, [events]);

  useEffect(() => {
    const running = timers.current;
    return () => running.forEach(clearTimeout);
  }, []);

  return pulses;
}

/**
 * A dot's details card, kept on the map: below dots near the top, above the rest. On a phone it
 * spans the map's width; from tablet width up it sits beside the dot, flipped to the dot's left
 * near the right edge.
 */
function DotDetails({ at, children }: { at: Point; children: ReactNode }) {
  const x = (at[0] / W) * 100;
  const y = (at[1] / H) * 100;
  const below = y < 45;
  const align = x > 62 ? "sm:-translate-x-full" : x < 30 ? "" : "sm:-translate-x-1/2";
  return (
    <div
      id="map-dot-details"
      role="tooltip"
      className={`pointer-events-none absolute inset-x-0 z-10 rounded-md border border-control bg-raised p-3 text-xs sm:right-auto sm:left-[var(--dot-x)] sm:w-72 ${align} ${below ? "" : "-translate-y-full"}`}
      style={{ "--dot-x": `${x}%`, top: `calc(${y}% ${below ? "+" : "-"} 22px)` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * Traffic between the campus and the region each vendor's policy says it stores data
 * in, with dots sized by outbound volume. A vendor with no stated region is listed but
 * not placed. IPs are listed rather than plotted: most are shared CDN addresses, so
 * where one is hosted says little about where the data ends up.
 */
export function TrafficMap({
  apps,
  events,
  lastMinute,
  onOpen,
}: {
  apps: ShadowApp[];
  events: LiveEvent[];
  lastMinute: LiveFeed["last_minute"] | null;
  onOpen: (app: ShadowApp) => void;
}) {
  const [active, setActive] = useState<DataLocation | null>(null);
  // The dot whose details card is open: on hover, tap or keyboard focus, never hover alone.
  const [tip, setTip] = useState<DataLocation | "campus" | null>(null);
  const pulses = usePulses(events);
  const showTip = (id: DataLocation | "campus") => {
    setTip(id);
    setActive(id === "campus" ? null : id);
  };
  const hideTip = () => {
    setTip(null);
    setActive(null);
  };

  const flows = useMemo<Flow[]>(() => {
    const ids = Object.keys(REGIONS) as DataLocation[];
    return ids
      .map((id) => {
        const inRegion = apps.filter((a) => a.data_location === id);
        const top = [...inRegion].sort((a, b) => b.max_score - a.max_score)[0];
        return {
          id,
          ...REGIONS[id],
          apps: inRegion,
          bytes: inRegion.reduce((sum, a) => sum + a.bytes_out, 0),
          bytesIn: inRegion.reduce((sum, a) => sum + a.bytes_in, 0),
          ips: busiestIps(inRegion),
          worst: top?.severity ?? ("low" as Severity),
          score: top?.max_score ?? 0,
        };
      })
      .filter((f) => f.apps.length > 0)
      .sort((a, b) => b.bytes - a.bytes);
  }, [apps]);

  if (flows.length === 0) return <p className="py-10 text-sm text-muted">No traffic to unapproved tools yet.</p>;

  const maxOut = Math.max(1, ...flows.map((f) => f.bytes));
  // Both bars share one scale, so a longer bar always means more data.
  const maxBytes = Math.max(maxOut, ...flows.map((f) => f.bytesIn));
  const total = flows.reduce((sum, f) => sum + f.bytes, 0);
  const totalIn = flows.reduce((sum, f) => sum + f.bytesIn, 0);
  const placed = flows.filter((f) => f.at);
  const size = (f: Flow) => 7 + 15 * Math.sqrt(f.bytes / maxOut);
  const dim = (f: Flow) => (active && active !== f.id ? 0.2 : 1);

  const stats = (
    <dl className="flex gap-x-6 gap-y-2 sm:flex-col">
      <div>
        <dt className="text-xs text-muted">Sent</dt>
        <dd className="font-mono text-lg font-medium leading-tight text-ink">
          <AnimatedNumber value={total} format={(n) => formatBytes(Math.round(n))} />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Received</dt>
        <dd className="font-mono text-lg font-medium leading-tight text-ink">
          {totalIn > 0 ? <AnimatedNumber value={totalIn} format={(n) => formatBytes(Math.round(n))} /> : "Not reported"}
        </dd>
      </div>
      {lastMinute && (
        <div>
          <dt className="text-xs text-muted">Last minute</dt>
          <dd className="text-sm text-ink2">
            <span className="font-mono text-ink">
              <AnimatedNumber value={lastMinute.events} />
            </span>{" "}
            {lastMinute.events === 1 ? "event" : "events"}
          </dd>
        </div>
      )}
    </dl>
  );

  // On one screen (dense) the totals stand in a column beside the map, the map takes the panel's height,
  // and the legend and region list give way: each dot's details card carries the same figures.
  return (
    <div className="dense:flex dense:h-full dense:min-h-0 dense:gap-5">
      <div className="hidden dense:flex dense:shrink-0 dense:flex-col dense:justify-end">{stats}</div>
      <div className="relative dense:mx-auto dense:aspect-[1000/392] dense:h-full dense:max-w-full dense:flex-none">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`Traffic with campus: ${formatBytes(total)} out, ${formatBytes(totalIn)} in. ${flows.map((f) => `${f.label}: ${formatBytes(f.bytes)} out, ${formatBytes(f.bytesIn)} in`).join(". ")}.`}
        >
          <path d={LAND_PATH} fill="none" style={{ stroke: "var(--raised-hover)" }} strokeWidth="3.4" strokeLinecap="round" />
          {placed.map((f) => (
            <path
              key={f.id}
              d={REGION_PATHS[f.id]}
              fill="none"
              style={{ stroke: SEVERITY_STYLE[f.worst].stroke, opacity: dim(f) * 0.8 }}
              strokeWidth="3.4"
              strokeLinecap="round"
              className="transition-opacity"
            />
          ))}
          {!flows.some((f) => f.id === "MY") && (
            <path d={REGION_PATHS.MY} fill="none" style={{ stroke: "var(--accent)" }} opacity="0.7" strokeWidth="3.4" strokeLinecap="round" />
          )}
          {/* On load each arc draws out from the campus (and back, for traffic in), then its marker lands. */}
          {placed
            .filter((f) => f.bytesIn > 0)
            .map((f, i) => (
              <path
                key={f.id}
                d={inPath(f.at!)}
                fill="none"
                pathLength={1}
                style={{ stroke: "var(--data)", opacity: dim(f), animationDelay: `${ARRIVE_MS + 100 + i * STAGGER_MS}ms` }}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                className="animate-draw transition-opacity"
              />
            ))}
          {placed.map((f, i) => (
            <path
              key={f.id}
              d={outPath(f.at!)}
              fill="none"
              pathLength={1}
              style={{ stroke: SEVERITY_STYLE[f.worst].stroke, opacity: dim(f), animationDelay: `${i * STAGGER_MS}ms` }}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              className="animate-draw transition-opacity"
            />
          ))}
          {pulses.map((p) => {
            const flow = placed.find((f) => f.id === p.region);
            if (!flow) return null;
            const color = p.direction === "out" ? SEVERITY_STYLE[flow.worst].stroke : "var(--data)";
            const [lx, ly] = p.direction === "out" ? flow.at! : HOME;
            return (
              <g key={p.key}>
                <circle
                  r="4.5"
                  className="animate-travel"
                  style={{
                    fill: color,
                    stroke: "var(--surface)",
                    strokeWidth: 1.5,
                    offsetPath: `path("${p.direction === "out" ? outPath(flow.at!) : inPath(flow.at!)}")`,
                    offsetRotate: "0deg",
                    animationDelay: `${p.delay}ms`,
                  }}
                />
                {/* Where it lands, a ring opens once: the event has reached its destination. */}
                <circle
                  cx={lx}
                  cy={ly}
                  r="12"
                  fill="none"
                  className="animate-land opacity-0"
                  style={{ stroke: color, strokeWidth: 1.5, transformBox: "fill-box", transformOrigin: "center", animationDelay: `${p.delay + LAND_AT}ms` }}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {placed.map((f, i) => {
            const [x, y] = f.at!;
            return (
              <g key={f.id} style={{ opacity: dim(f) }} className="transition-opacity">
                <circle
                  cx={x}
                  cy={y}
                  r={size(f)}
                  className="animate-pop"
                  style={{
                    fill: SEVERITY_STYLE[f.worst].stroke,
                    stroke: "var(--surface)",
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animationDelay: `${ARRIVE_MS + i * STAGGER_MS}ms`,
                  }}
                  strokeWidth="3"
                />
              </g>
            );
          })}
          <circle cx={HOME[0]} cy={HOME[1]} r="9" style={{ fill: "var(--surface)", stroke: "var(--accent)" }} strokeWidth="2" />
          <circle cx={HOME[0]} cy={HOME[1]} r="4" style={{ fill: "var(--accent)" }} />
        </svg>

        <span
          className="pointer-events-none absolute -translate-x-full -translate-y-1/2 pr-3"
          style={{ left: `${(HOME[0] / W) * 100}%`, top: `${(HOME[1] / H) * 100}%` }}
        >
          <span className="block whitespace-nowrap rounded border border-control bg-surface px-1.5 py-0.5 text-xs font-medium text-accent">Campus</span>
        </span>
        {placed.map((f) => {
          // Singapore sits under the campus marker, so its label goes below the spot rather than above.
          const below = f.id === "SG";
          return (
            <span
              key={f.id}
              className={`pointer-events-none absolute -translate-x-1/2 ${below ? "pt-1.5" : "-translate-y-full pb-1.5"}`}
              style={{ left: `${(f.at![0] / W) * 100}%`, top: `${((f.at![1] + (below ? size(f) : -size(f))) / H) * 100}%` }}
            >
              {/* Just the name: the figures and addresses are in the dot's details card. */}
              <span className="block whitespace-nowrap rounded border border-control bg-surface px-1.5 py-0.5 text-xs font-medium text-ink">{f.label}</span>
            </span>
          );
        })}
        <div className="absolute bottom-0 left-0 hidden sm:block dense:hidden">{stats}</div>

        {/* Each dot opens a details card: a mouse points at it, a finger taps it, the keyboard tabs to it. */}
        {[{ id: "campus" as const, at: HOME, label: "Campus: where all traffic starts" }, ...placed.map((f) => ({ id: f.id, at: f.at!, label: f.label }))].map(
          (dot) => (
            <Button
              key={dot.id}
              variant="bare"
              className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              style={{ left: `${(dot.at[0] / W) * 100}%`, top: `${(dot.at[1] / H) * 100}%` }}
              aria-label={`${dot.label}. Show details`}
              aria-describedby={tip === dot.id ? "map-dot-details" : undefined}
              onPointerEnter={(e) => e.pointerType === "mouse" && showTip(dot.id)}
              onPointerLeave={(e) => e.pointerType === "mouse" && hideTip()}
              onFocus={() => showTip(dot.id)}
              onBlur={hideTip}
              onClick={() => showTip(dot.id)}
              onKeyDown={(e) => e.key === "Escape" && hideTip()}
            />
          ),
        )}
        {tip === "campus" && (
          <DotDetails at={HOME}>
            <p className="text-sm font-medium text-accent">Campus</p>
            <p className="mt-0.5 text-ink2">Where all traffic to these tools starts.</p>
            <p className="mt-2 text-ink2">
              <span className="font-mono text-ink">{formatBytes(total)}</span> out, <span className="font-mono text-ink">{formatBytes(totalIn)}</span> in
              {lastMinute && (
                <>
                  , <span className="font-mono text-ink">{lastMinute.events}</span> {lastMinute.events === 1 ? "event" : "events"} in the last minute
                </>
              )}
            </p>
            <p className="mt-2 text-muted">Staff addresses aren&apos;t collected.</p>
          </DotDetails>
        )}
        {placed
          .filter((f) => f.id === tip)
          .map((f) => (
            <DotDetails key={f.id} at={f.at!}>
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">{f.label}</span>
                <span className={SEVERITY_STYLE[f.worst].text}>
                  {SEVERITY_LABEL[f.worst]} <span className="font-mono">{f.score}</span>
                </span>
              </p>
              <p className="mt-0.5 text-ink2">
                <span className="font-mono text-ink">{formatBytes(f.bytes)}</span> out,{" "}
                {f.bytesIn > 0 ? (
                  <>
                    <span className="font-mono text-ink">{formatBytes(f.bytesIn)}</span> in
                  </>
                ) : (
                  "in not reported"
                )}
              </p>
              <p className="mt-2 text-muted">{f.apps.length === 1 ? "Tool" : "Tools"}</p>
              <p className="text-ink2">{f.apps.map((a) => a.name).join(", ")}</p>
              <p className="mt-2 text-muted">Destination IPs, the vendor&apos;s own</p>
              {f.ips.length === 0 ? (
                <p className="text-ink2">Not reported</p>
              ) : (
                <ul className="mt-0.5 space-y-px font-mono">
                  {f.ips.slice(0, TIP_IPS).map((d) => (
                    <li key={d.ip} className="grid grid-cols-[1fr_auto_auto] gap-x-2">
                      <span className="text-ink">{d.ip}</span>
                      <span className="text-right text-ink2">{formatBytes(d.bytes_out)} out</span>
                      <span className="text-right text-muted">{formatBytes(d.bytes_in)} in</span>
                    </li>
                  ))}
                </ul>
              )}
              {f.ips.length > TIP_IPS && <p className="mt-0.5 font-mono text-muted">+{f.ips.length - TIP_IPS} more, listed below the map</p>}
            </DotDetails>
          ))}
      </div>

      <div className="mt-3 sm:hidden">{stats}</div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2 dense:hidden">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-sev-critical" /> Out, coloured by the region's worst severity
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-data" /> In
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink2" /> A moving dot is an event arriving now
        </li>
        <li>Point at or tap a dot for its tools and addresses</li>
      </ul>

      <ul className="mt-5 grid gap-x-8 gap-y-4 md:grid-cols-2 dense:hidden" onPointerLeave={() => setActive(null)}>
        {flows.map((f) => (
          <li key={f.id} onPointerEnter={() => setActive(f.id)}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              <span className="font-medium text-ink">{f.label}</span>
              <span className={SEVERITY_STYLE[f.worst].text}>
                {SEVERITY_LABEL[f.worst]} <span className="font-mono">{f.score}</span>
              </span>
              <span className="ml-auto text-muted">
                <span className="font-mono text-ink">{formatBytes(f.bytes)}</span> out,{" "}
                {f.bytesIn > 0 ? (
                  <>
                    <span className="font-mono text-ink">{formatBytes(f.bytesIn)}</span> in
                  </>
                ) : (
                  "in not reported"
                )}
              </span>
            </div>
            <div className="mt-1 space-y-0.5" aria-hidden>
              <div className="h-1.5 rounded-full bg-raised">
                <div
                  className={`h-full rounded-full ${SEVERITY_STYLE[f.worst].mark} transition-[width] duration-500`}
                  style={{ width: `${Math.max(1, (f.bytes / maxBytes) * 100)}%` }}
                />
              </div>
              {f.bytesIn > 0 && (
                <div className="h-1 rounded-full bg-raised">
                  <div className="h-full rounded-full bg-data transition-[width] duration-500" style={{ width: `${Math.max(1, (f.bytesIn / maxBytes) * 100)}%` }} />
                </div>
              )}
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
              {f.apps.map((app) => (
                <Button key={app.id} variant="bare" onClick={() => onOpen(app)} className="text-muted transition-colors hover:text-ink hover:underline">
                  {app.name}
                </Button>
              ))}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
              <span>Destination IPs</span>
              {f.ips.length === 0 && <span>not reported</span>}
              {f.ips.slice(0, MAX_IPS).map((d) => (
                <span
                  key={d.ip}
                  className="font-mono text-ink2"
                  title={`${d.ip}: ${formatBytes(d.bytes_out)} out, ${formatBytes(d.bytes_in)} in`}
                >
                  {d.ip}
                </span>
              ))}
              {f.ips.length > MAX_IPS && <span className="font-mono">+{f.ips.length - MAX_IPS}</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

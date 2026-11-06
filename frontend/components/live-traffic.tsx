"use client";

import { useEffect, useRef, useState } from "react";

import { formatBytes, relativeTime, secondsAgo } from "@/lib/format";
import type { LiveEvent, LiveFeed, ShadowApp } from "@/lib/types";

import { AnimatedNumber } from "./animated-number";
import { SeverityBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState, Panel } from "./ui/card";

const ROWS = 7;

const REGION_LABEL: Record<LiveEvent["data_location"], string> = {
  US: "United States",
  EU: "Europe",
  SG: "Singapore",
  MY: "Malaysia",
  OTHER: "Elsewhere",
  unknown: "Region not stated",
};

/**
 * Fills toward the next check and starts again each time the server answers, so the feed
 * visibly keeps watching while nothing arrives. It stops, empty, when the connection drops.
 */
function NextCheck({ beat, every }: { beat: number | null; every: number }) {
  return (
    <div className="mb-1 h-0.5 overflow-hidden rounded-full bg-raised" aria-hidden title={`Checks for new traffic every ${every / 1000} seconds`}>
      {beat !== null && beat > 0 && (
        <span key={beat} className="block h-full origin-left animate-countdown rounded-full bg-positive" style={{ animationDuration: `${every}ms` }} />
      )}
    </div>
  );
}

/**
 * The newest traffic to unapproved tools, as it arrives. It shows the tool and department
 * only: no person, hashed or otherwise. Old events keep their real age, so a quiet feed
 * reads as quiet rather than pretending to be live.
 */
export function LiveTraffic({
  events,
  lastMinute,
  connected,
  beat,
  checkEveryMs,
  apps,
  onOpen,
  className = "",
}: {
  events: LiveEvent[];
  lastMinute: LiveFeed["last_minute"] | null;
  connected: boolean;
  /** The server's answer count, or null while the connection is down. */
  beat: number | null;
  checkEveryMs: number;
  apps: ShadowApp[];
  onOpen: (app: ShadowApp) => void;
  className?: string;
}) {
  const [now, setNow] = useState(0);
  // Rows newer than this arrived while watching, so they slide in and glow briefly. The first batch is history.
  const firstSeen = useRef<number | null>(null);
  if (firstSeen.current === null && events[0]) firstSeen.current = events[0].id;

  useEffect(() => {
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  return (
    <Panel
      title="Live traffic"
      note={`Newest first, from your network logs, checked every ${checkEveryMs / 1000} seconds. It shows tools and departments, never people.`}
      className={className}
      bodyClassName="py-2"
      action={
        lastMinute && (
          <p className="text-xs text-ink2">
            <span className="font-mono text-ink">
              <AnimatedNumber value={lastMinute.events} />
            </span>{" "}
            in the last minute,{" "}
            <span className="font-mono text-ink">
              <AnimatedNumber value={lastMinute.bytes_out} format={(n) => formatBytes(Math.round(n))} />
            </span>{" "}
            out
          </p>
        )
      }
    >
      <NextCheck beat={beat} every={checkEveryMs} />
      {events.length === 0 ? (
        <div className="py-3">
          <EmptyState>
            {connected ? "No traffic yet. Events appear here as your proxy or firewall reports them." : "Connecting to the live feed…"}
          </EmptyState>
        </div>
      ) : (
        // On one screen (dense) the list shows the rows that fit whole: the rest wrap into a second
        // column, which overflow hides, so a row is never cut in half.
        <ol className="dense:relative dense:flex dense:min-h-0 dense:flex-1 dense:flex-col dense:flex-wrap dense:overflow-hidden">
          {events.slice(0, ROWS).map((e) => {
            const app = apps.find((a) => a.id === e.app_id);
            const fresh = firstSeen.current !== null && e.id > firstSeen.current;
            return (
              <li
                key={e.id}
                // Every column on a wide screen has a fixed width or a share of the row, never "auto", so the
                // columns line up from row to row and the right-aligned figures form one edge.
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-rule py-2 text-sm last:border-b-0 lg:grid-cols-[4.5rem_minmax(0,1.5fr)_minmax(0,1fr)_6.5rem_6rem_7rem_6rem] dense:w-full dense:grid-cols-[3.5rem_minmax(0,1fr)_5.5rem_5rem_6.5rem_6rem] dense:gap-x-3 dense:py-1.5 ${fresh ? "animate-arrive" : ""}`}
              >
                <time
                  className="order-last whitespace-nowrap font-mono text-xs text-muted lg:order-none"
                  dateTime={e.observed_at}
                  title={now ? relativeTime(e.observed_at, now) : undefined}
                >
                  {now ? secondsAgo(e.observed_at, now) : ""}
                </time>
                <span className="min-w-0 truncate">
                  {app ? (
                    <Button variant="bare" onClick={() => onOpen(app)} className="font-medium text-ink hover:underline">
                      {e.app}
                    </Button>
                  ) : (
                    <span className="font-medium text-ink">{e.app}</span>
                  )}{" "}
                  <span className="text-muted">{e.department}</span>
                </span>
                <span className="hidden min-w-0 truncate text-ink2 lg:block dense:hidden">{REGION_LABEL[e.data_location]}</span>
                {/* On a phone both figures share a line; on a wide screen each gets its own right-aligned column. */}
                <span className="col-start-1 text-xs text-muted lg:hidden">
                  <span className="font-mono text-ink">{formatBytes(e.bytes_out)}</span> out, <span className="font-mono text-ink">{formatBytes(e.bytes_in)}</span> in
                </span>
                <span className="hidden text-right text-xs text-muted lg:block">
                  <span className="font-mono text-ink">{formatBytes(e.bytes_out)}</span> out
                </span>
                <span className="hidden text-right text-xs text-muted lg:block">
                  <span className="font-mono text-ink">{formatBytes(e.bytes_in)}</span> in
                </span>
                <span className="hidden truncate font-mono text-xs text-ink2 lg:block">{e.dest_ip ?? ""}</span>
                <span className="col-start-2 row-start-1 justify-self-end lg:col-auto lg:row-auto">
                  {e.severity && e.score !== null && <SeverityBadge severity={e.severity} score={e.score} />}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

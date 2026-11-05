"use client";

import { useEffect, useRef, useState } from "react";

import { formatBytes, secondsAgo } from "@/lib/format";
import type { LiveEvent, LiveFeed, ShadowApp } from "@/lib/types";

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
 * The newest traffic to unapproved tools, as it arrives. It shows the tool and department
 * only: no person, hashed or otherwise. Old events keep their real age, so a quiet feed
 * reads as quiet rather than pretending to be live.
 */
export function LiveTraffic({
  events,
  lastMinute,
  connected,
  apps,
  onOpen,
  className = "",
}: {
  events: LiveEvent[];
  lastMinute: LiveFeed["last_minute"] | null;
  connected: boolean;
  apps: ShadowApp[];
  onOpen: (app: ShadowApp) => void;
  className?: string;
}) {
  const [now, setNow] = useState(0);
  // Rows newer than this arrived while watching, so they get a brief highlight. The first batch is history.
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
      note="Newest first, from your network logs. It shows tools and departments, never people."
      className={className}
      bodyClassName="py-2"
      action={
        lastMinute && (
          <p className="text-xs text-ink2">
            <span className="font-mono text-ink">{lastMinute.events}</span> in the last minute,{" "}
            <span className="font-mono text-ink">{formatBytes(lastMinute.bytes_out)}</span> out
          </p>
        )
      }
    >
      {events.length === 0 ? (
        <div className="py-3">
          <EmptyState>
            {connected ? "No traffic yet. Events appear here as your proxy or firewall reports them." : "Connecting to the live feed…"}
          </EmptyState>
        </div>
      ) : (
        <ol>
          {events.slice(0, ROWS).map((e) => {
            const app = apps.find((a) => a.id === e.app_id);
            const fresh = firstSeen.current !== null && e.id > firstSeen.current;
            return (
              <li
                key={e.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-rule py-2 text-sm last:border-b-0 lg:grid-cols-[4.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_7rem_auto] ${fresh ? "animate-fade-in" : ""}`}
              >
                <time className="order-last font-mono text-xs text-muted lg:order-none" dateTime={e.observed_at}>
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
                <span className="hidden min-w-0 truncate text-ink2 lg:block">{REGION_LABEL[e.data_location]}</span>
                <span className="col-start-1 text-xs text-muted lg:col-auto">
                  <span className="font-mono text-ink">{formatBytes(e.bytes_out)}</span> out, <span className="font-mono text-ink">{formatBytes(e.bytes_in)}</span> in
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

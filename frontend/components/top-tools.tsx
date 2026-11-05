import { relativeTime } from "@/lib/format";
import type { ShadowApp } from "@/lib/types";

import { SeverityBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";

const LIMIT = 5;

/** The tools most worth looking at first. The full table is on the Tool exposure tab. */
export function TopTools({
  apps,
  now,
  onOpen,
  onViewAll,
  className = "",
}: {
  apps: ShadowApp[];
  now: number;
  onOpen: (app: ShadowApp) => void;
  onViewAll: () => void;
  className?: string;
}) {
  const rows = [...apps].sort((a, b) => b.max_score - a.max_score || a.name.localeCompare(b.name)).slice(0, LIMIT);
  return (
    <Panel
      title="Most exposed tools"
      className={className}
      bodyClassName="py-2"
      action={
        <Button variant="ghost" size="sm" onClick={onViewAll}>
          View all <span className="font-mono">{apps.length}</span>
        </Button>
      }
    >
      <ul>
        {rows.map((app) => (
          <li key={app.id} className="border-b border-rule last:border-b-0">
            <Button
              variant="bare"
              onClick={() => onOpen(app)}
              className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-row-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{app.name}</span>
                <span className="block text-xs text-muted">
                  <span className="font-mono">{app.total_users}</span> users, seen{" "}
                  <span className="font-mono">{relativeTime(app.last_seen, now)}</span>
                </span>
              </span>
              <SeverityBadge severity={app.severity} score={app.max_score} />
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

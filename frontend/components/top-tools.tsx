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
      {/* On one screen (dense) only whole rows show; the rest wrap into a hidden second column. */}
      <ul className="dense:relative dense:flex dense:min-h-0 dense:flex-1 dense:flex-col dense:flex-wrap dense:overflow-hidden">
        {rows.map((app) => (
          <li key={app.id} className="border-b border-rule last:border-b-0 dense:w-full">
            <Button
              variant="bare"
              onClick={() => onOpen(app)}
              className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-row-hover dense:mx-0 dense:w-full dense:px-0 dense:py-1"
            >
              {/* On one screen (dense) the name and its users share a line. */}
              <span className="min-w-0 flex-1 dense:flex dense:items-baseline dense:gap-2">
                <span className="block truncate font-medium text-ink dense:max-w-[60%] dense:shrink-0">{app.name}</span>
                <span className="block text-xs text-muted dense:min-w-0 dense:truncate">
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

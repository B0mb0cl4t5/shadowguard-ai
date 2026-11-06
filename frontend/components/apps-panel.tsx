"use client";

import { useMemo } from "react";

import { SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_TONE, relativeTime, shortDepartment, titleCase } from "@/lib/format";
import type { Dashboard, Severity, ShadowApp } from "@/lib/types";

import { ChevronIcon, CompareIcon } from "./icons";
import { Badge, SeverityBadge, VerificationBadge } from "./ui/badge";
import { Button, TabButton } from "./ui/button";
import { EmptyState, Panel } from "./ui/card";
import { Select } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const NEW_WINDOW_MS = 48 * 3600 * 1000;

export type SortKey = "name" | "exposure" | "users" | "last_seen";
export type SortState = { key: SortKey; dir: "asc" | "desc" };
export type SeverityFilter = Severity | "all";

const SORT_LABEL: Record<SortKey, string> = {
  exposure: "Worst exposure",
  users: "Users",
  last_seen: "Last seen",
  name: "Tool name",
};

/** First click on a column sorts the way an analyst usually wants it. */
const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = { name: "asc", exposure: "desc", users: "desc", last_seen: "desc" };

function compare(a: ShadowApp, b: ShadowApp, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "users":
      return a.total_users - b.total_users || a.max_score - b.max_score;
    case "last_seen":
      return new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime();
    case "exposure":
    default:
      return a.max_score - b.max_score || a.total_users - b.total_users;
  }
}

export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: DEFAULT_DIR[key] };
}

function isNew(app: ShadowApp, now: number) {
  return now - new Date(app.first_seen).getTime() < NEW_WINDOW_MS;
}

const matches = (app: ShadowApp, filter: SeverityFilter) =>
  filter === "all" || app.severity === filter;

export function AppsPanel({
  data,
  onOpen,
  onCompare,
  now,
  filter,
  onFilter,
  sort,
  onSort,
  className = "",
  comparedIds = [],
}: {
  data: Dashboard;
  onOpen: (app: ShadowApp) => void;
  onCompare: (app: ShadowApp) => void;
  now: number;
  filter: SeverityFilter;
  onFilter: (f: SeverityFilter) => void;
  sort: SortState;
  onSort: (s: SortState) => void;
  className?: string;
  comparedIds?: number[];
}) {
  const apps = useMemo(() => {
    const filtered = data.apps.filter((a) => matches(a, filter));
    const sign = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => sign * compare(a, b, sort.key) || a.name.localeCompare(b.name));
  }, [data.apps, filter, sort]);

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => {
    const active = sort.key === key;
    return (
      <TableHead
        className={align === "right" ? "text-right" : ""}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <Button
          variant="bare"
          onClick={() => onSort(nextSort(sort, key))}
          className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-ink ${active ? "text-ink" : ""}`}
          title={`Sort by ${SORT_LABEL[key].toLowerCase()}`}
        >
          {label}
          {active && <SortArrow dir={sort.dir} />}
        </Button>
      </TableHead>
    );
  };

  return (
    <Panel
      id="tools"
      title="Unapproved AI tools"
      note="Select a tool to read what its privacy policy says and how it was scored."
      className={className}
      action={
        <div className="flex flex-wrap gap-x-4" role="group" aria-label="Filter by worst severity">
          {(["all", ...SEVERITY_ORDER] as const).map((s) => (
            <TabButton key={s} selected={filter === s} onClick={() => onFilter(s)}>
              {s === "all" ? "All" : SEVERITY_LABEL[s]}{" "}
              <span className="font-mono">{data.apps.filter((a) => matches(a, s)).length}</span>
            </TabButton>
          ))}
        </div>
      }
    >
      {apps.length === 0 ? (
        <EmptyState>No tools have a department at this severity.</EmptyState>
      ) : (
        <>
          {/* Two-line rows: phones and narrow iPad split view */}
          <div className="mb-2 flex items-center justify-end gap-2 md:hidden">
            <label htmlFor="sort-mobile" className="shrink-0 text-xs text-muted">
              Sort by
            </label>
            <Select
              id="sort-mobile"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
                onSort({ key, dir });
              }}
              className="w-auto"
            >
              <option value="exposure:desc">Worst exposure</option>
              <option value="users:desc">Most users</option>
              <option value="last_seen:desc">Recently seen</option>
              <option value="name:asc">Name A–Z</option>
            </Select>
          </div>
          <ul className="-mx-1 md:hidden">
            {apps.map((app) => (
              <li key={app.id} className="flex items-center gap-1 border-t border-rule first:border-t-0">
                {/* Two buttons side by side: one can't sit inside the other. */}
                <Button variant="bare" onClick={() => onOpen(app)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-row-hover">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{app.name}</span>
                      {isNew(app, now) && <Badge>New</Badge>}
                      {policyChanged(app, now) && <PolicyChangedBadge />}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-mono">{app.total_users}</span> users,{" "}
                      <span className="font-mono">{relativeTime(app.last_seen, now)}</span>
                    </p>
                    <div className="mt-1.5">
                      <DepartmentTags app={app} />
                    </div>
                  </div>
                  <SeverityBadge severity={app.severity} score={app.max_score} />
                  <ChevronIcon size={16} className="shrink-0 text-muted" />
                </Button>
                <CompareToggle app={app} selected={comparedIds.includes(app.id)} onCompare={onCompare} />
              </li>
            ))}
          </ul>

          {/* Table: desktop and wide iPad. It runs edge to edge inside the panel. */}
          <div className="-mx-5 -mb-5 hidden overflow-x-auto md:block">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  {header("name", "Tool")}
                  {header("exposure", "Worst exposure")}
                  <TableHead>Affected departments</TableHead>
                  {header("users", "Users", "right")}
                  <TableHead>Policy</TableHead>
                  {header("last_seen", "Last seen", "right")}
                  <TableHead aria-label="Compare" />
                  <TableHead aria-label="Open" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.id} onClick={() => onOpen(app)} className="group cursor-pointer transition-colors last:border-b-0 hover:bg-row-hover">
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-ink">{app.name}</span>
                        {isNew(app, now) && <Badge>New</Badge>}
                        {policyChanged(app, now) && <PolicyChangedBadge />}
                      </div>
                      <span className="block whitespace-nowrap text-xs text-muted">
                        <span className="font-mono">{app.domain}</span>, {titleCase(app.category).toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={app.severity} score={app.max_score} />
                    </TableCell>
                    <TableCell>
                      <DepartmentTags app={app} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-ink">{app.total_users}</TableCell>
                    <TableCell>
                      <VerificationBadge status={app.verification_status} compact />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted">
                      {relativeTime(app.last_seen, now)}
                    </TableCell>
                    <TableCell className="text-right">
                      <CompareToggle app={app} selected={comparedIds.includes(app.id)} onCompare={onCompare} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="bare"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(app);
                        }}
                        className="rounded-md p-1 text-muted transition-colors group-hover:text-ink"
                        aria-label={`Open policy analysis for ${app.name}`}
                      >
                        <ChevronIcon size={16} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Picks a tool for the side-by-side comparison. Choosing a second one opens it. */
function CompareToggle({ app, selected, onCompare }: { app: ShadowApp; selected: boolean; onCompare: (app: ShadowApp) => void }) {
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size="icon"
      onClick={(e) => {
        e.stopPropagation();
        onCompare(app);
      }}
      aria-pressed={selected}
      aria-label={selected ? `Remove ${app.name} from comparison` : `Add ${app.name} to comparison`}
      title={selected ? "Remove from comparison" : "Add to comparison"}
      className={selected ? "text-accent" : "text-muted"}
    >
      <CompareIcon size={16} />
    </Button>
  );
}

/** One tag per department, worst first: the short name and that pair's score. */
function DepartmentTags({ app }: { app: ShadowApp }) {
  const rows = [...app.departments].sort((a, b) => b.score - a.score);
  return (
    <ul className="flex flex-wrap gap-1">
      {rows.map((d) => (
        <li key={d.department}>
          <Badge
            tone={d.status === "open" ? SEVERITY_TONE[d.severity] : "neutral"}
            title={`${d.department}: ${d.score}, ${d.users} users${d.status === "open" ? "" : `, ${d.status}`}`}
          >
            {shortDepartment(d.department)}
            <span className={`font-mono ${d.status === "open" ? "" : "line-through"}`}>{d.score}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function SortArrow({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-ink">
      {dir === "asc" ? <path d="M5 1.5 8 5H2z" fill="currentColor" /> : <path d="M5 8.5 2 5h6z" fill="currentColor" />}
    </svg>
  );
}

function PolicyChangedBadge({ className = "" }: { className?: string }) {
  return (
    <Badge tone="warning" title="The vendor changed its privacy policy recently" className={className}>
      Policy changed
    </Badge>
  );
}

const CHANGED_WINDOW_MS = 14 * 24 * 3600 * 1000;

export function policyChanged(app: ShadowApp, now: number = Date.now()) {
  return app.policy_changed_at !== null && now - new Date(app.policy_changed_at).getTime() < CHANGED_WINDOW_MS;
}

"use client";

import { useMemo } from "react";

import { SEVERITY_LABEL, SEVERITY_ORDER, relativeTime, titleCase } from "@/lib/format";
import type { Dashboard, Severity, ShadowApp } from "@/lib/types";

import { SeverityBar } from "./charts";
import { ChevronIcon } from "./icons";
import { EmptyState, GlassCard, SeverityBadge, VerificationBadge } from "./ui";

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

export function AppsPanel({
  data,
  onOpen,
  now,
  filter,
  onFilter,
  sort,
  onSort,
}: {
  data: Dashboard;
  onOpen: (app: ShadowApp) => void;
  now: number;
  filter: SeverityFilter;
  onFilter: (f: SeverityFilter) => void;
  sort: SortState;
  onSort: (s: SortState) => void;
}) {
  const apps = useMemo(() => {
    const filtered = data.apps.filter((a) => filter === "all" || a.departments.some((d) => d.severity === filter));
    const sign = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => sign * compare(a, b, sort.key) || a.name.localeCompare(b.name));
  }, [data.apps, filter, sort]);

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => {
    const active = sort.key === key;
    return (
      <th
        className={`px-2 pb-1 font-medium ${align === "right" ? "text-right" : ""}`}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => onSort(nextSort(sort, key))}
          className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-slate-200 ${
            active ? "text-slate-200" : ""
          }`}
          title={`Sort by ${SORT_LABEL[key].toLowerCase()}`}
        >
          {label}
          <SortArrow active={active} dir={sort.dir} />
        </button>
      </th>
    );
  };

  return (
    <GlassCard
      id="tools"
      eyebrow="Stage 1–3 · Discover, read, score"
      title="Detected shadow AI tools"
      className="xl:col-span-2"
      action={
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by severity">
          {(["all", ...SEVERITY_ORDER] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onFilter(s)}
              aria-pressed={filter === s}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                filter === s
                  ? "bg-white/15 text-white ring-1 ring-inset ring-white/25"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
              }`}
            >
              {s === "all" ? "All" : SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-5">
        <SeverityBar counts={data.severity_breakdown} />
        <p className="mt-2 text-[0.7rem] text-slate-500">
          Counts are tool × department pairs with open exposure in the last 7 days.
        </p>
      </div>

      {apps.length === 0 ? (
        <EmptyState>No tools match this filter.</EmptyState>
      ) : (
        <>
          {/* Cards: phones and narrow iPad split view */}
          <div className="mb-3 flex items-center justify-end gap-2 md:hidden">
            <label htmlFor="sort-mobile" className="text-xs text-slate-400">
              Sort by
            </label>
            <select
              id="sort-mobile"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
                onSort({ key, dir });
              }}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[16px] text-slate-200 sm:text-xs"
            >
              <option value="exposure:desc">Worst exposure</option>
              <option value="users:desc">Most users</option>
              <option value="last_seen:desc">Recently seen</option>
              <option value="name:asc">Name A–Z</option>
            </select>
          </div>
          <ul className="space-y-2.5 md:hidden">
            {apps.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  onClick={() => onOpen(app)}
                  className="glass-inset flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{app.name}</span>
                      {isNew(app, now) && <NewTag />}
                      {policyChanged(app, now) && <ChangedTag />}
                    </div>
                    <p className="truncate font-mono text-xs text-slate-400">{app.domain}</p>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {app.total_users} users · {app.departments.length} dept · {relativeTime(app.last_seen, now)}
                    </p>
                  </div>
                  <SeverityBadge severity={app.severity} score={app.max_score} size="sm" />
                  <ChevronIcon size={16} className="shrink-0 text-slate-500" />
                </button>
              </li>
            ))}
          </ul>

          {/* Table: desktop and wide iPad */}
          <div className="-mx-2 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-sm">
              <thead>
                <tr className="text-left text-[0.7rem] uppercase tracking-wider text-slate-500">
                  {header("name", "Tool")}
                  {header("exposure", "Worst exposure")}
                  <th className="px-2 pb-1 font-medium">Departments</th>
                  {header("users", "Users", "right")}
                  <th className="px-2 pb-1 font-medium">Policy</th>
                  {header("last_seen", "Last seen")}
                  <th className="px-2 pb-1" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr
                    key={app.id}
                    onClick={() => onOpen(app)}
                    className="group cursor-pointer bg-white/[0.025] transition-colors hover:bg-white/[0.06]"
                  >
                    <td className="rounded-l-xl px-2 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-white">{app.name}</span>
                        {isNew(app, now) && <NewTag />}
                        {policyChanged(app, now) && <ChangedTag />}
                      </div>
                      <span className="font-mono text-xs text-slate-500">
                        {app.domain} · {titleCase(app.category)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <SeverityBadge severity={app.severity} score={app.max_score} size="sm" />
                    </td>
                    <td className="max-w-[16rem] px-2 py-2.5 text-xs text-slate-300">
                      <span className="line-clamp-2">{app.departments.map((d) => d.department).join(", ")}</span>
                    </td>
                    <td className="tabular px-2 py-2.5 text-right font-mono text-slate-200">{app.total_users}</td>
                    <td className="px-2 py-2.5">
                      <VerificationBadge status={app.verification_status} compact />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-slate-400">
                      {relativeTime(app.last_seen, now)}
                    </td>
                    <td className="rounded-r-xl px-2 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(app);
                        }}
                        className="rounded-md p-1 text-slate-500 transition-colors group-hover:text-signal"
                        aria-label={`Open policy analysis for ${app.name}`}
                      >
                        <ChevronIcon size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </GlassCard>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={active ? "text-signal" : "opacity-30"}>
      {(!active || dir === "asc") && <path d="M5 1.5 8 5H2z" fill="currentColor" />}
      {(!active || dir === "desc") && <path d="M5 8.5 2 5h6z" fill="currentColor" />}
    </svg>
  );
}

function ChangedTag() {
  return (
    <span
      className="rounded bg-amber-400/15 px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-wider text-amber-200 ring-1 ring-inset ring-amber-300/35"
      title="The vendor changed its privacy policy recently"
    >
      Policy changed
    </span>
  );
}

const CHANGED_WINDOW_MS = 14 * 24 * 3600 * 1000;

function policyChanged(app: ShadowApp, now: number) {
  return app.policy_changed_at !== null && now - new Date(app.policy_changed_at).getTime() < CHANGED_WINDOW_MS;
}

function NewTag() {
  return (
    <span className="rounded bg-signal/15 px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-wider text-signal ring-1 ring-inset ring-signal/30">
      New
    </span>
  );
}

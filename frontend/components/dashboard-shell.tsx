"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { relativeTime } from "@/lib/format";
import type { Dashboard, Remediation, Role, ShadowApp } from "@/lib/types";

import { AppsPanel, nextSort, type SeverityFilter, type SortKey, type SortState } from "./apps-panel";
import { TrendChart } from "./charts";
import { DepartmentPanel } from "./department-panel";
import { LogoutIcon, RefreshIcon, ShieldMark } from "./icons";
import { KpiRow } from "./kpi-row";
import { RemediationLog } from "./remediation-log";
import { CommandPalette } from "./command-palette";
import { ReviewDialog } from "./review-dialog";
import { GlassCard } from "./ui";
import { VendorDrawer } from "./vendor-drawer";

const POLL_MS = 15_000;

export function DashboardShell({ initial, role }: { initial: Dashboard; role: Role }) {
  const [data, setData] = useState(initial);
  // First render uses the data's own timestamp, so server and browser print
  // identical relative times ("41 minutes ago"); the live clock takes over after mount.
  const [now, setNow] = useState(() => Date.parse(initial.generated_at));
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ShadowApp | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [sort, setSort] = useState<SortState>({ key: "exposure", dir: "desc" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [review, setReview] = useState<Remediation | null>(null);
  const [isMac, setIsMac] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Dashboard);
      setStale(false);
    } catch {
      setStale(true);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setNow(Date.now());
    }
  }, []);

  // Poll while the tab is visible; refresh immediately when it becomes visible again.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void refresh();
    const timer = window.setInterval(tick, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  // Keep the open drawer in sync with fresh data.
  useEffect(() => {
    setSelected((s) => (s ? (data.apps.find((a) => a.id === s.id) ?? s) : s));
  }, [data]);

  // ⌘K / Ctrl+K opens the command menu from anywhere.
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    setNow(Date.now());
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Render the palette (and focus its input) before this handler returns,
        // so characters typed immediately after ⌘K are never lost.
        flushSync(() => setPaletteOpen((o) => !o));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }, []);

  const showTools = useCallback(() => {
    setSelected(null);
    window.setTimeout(() => document.getElementById("tools")?.scrollIntoView({ behavior: "smooth" }), 0);
  }, []);

  const pending = data.remediations.filter((r) => r.status === "pending_approval");

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 pt-5 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal/10 text-signal ring-1 ring-inset ring-signal/30 shadow-glow-signal">
            <ShieldMark size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-white">ShadowGuard AI</h1>
            <p className="truncate text-xs text-slate-400">Shadow AI &amp; data-exposure governance · University network</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ring-1 ring-inset ${
              stale ? "bg-amber-400/10 text-amber-200 ring-amber-300/30" : "bg-white/[0.04] text-slate-300 ring-white/10"
            }`}
            aria-live="polite"
          >
            <span className="relative flex h-2 w-2">
              {!stale && <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-signal" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${stale ? "bg-amber-300" : "bg-signal"}`} />
            </span>
            {stale ? "Reconnecting…" : `Live · updated ${relativeTime(data.generated_at, now)}`}
          </span>
          <button
            type="button"
            className="btn-ghost gap-2 text-slate-300"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command menu"
            aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden rounded border border-white/15 px-1.5 font-mono text-[0.65rem] text-slate-400 md:inline">
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
          <button
            type="button"
            className="btn-ghost h-9 w-9 px-0"
            onClick={() => void refresh()}
            aria-label="Refresh now"
            disabled={refreshing}
          >
            <RefreshIcon size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
          <span className="rounded-full bg-white/[0.04] px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-slate-300 ring-1 ring-inset ring-white/10">
            {role}
          </span>
          <button type="button" className="btn-ghost" onClick={() => void logout()}>
            <LogoutIcon size={15} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <KpiRow data={data} />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <GlassCard
          eyebrow="Organisation-wide"
          title="Risk exposure index · 14 days"
          className="xl:col-span-2"
          bodyClassName="flex flex-col"
        >
          <TrendChart points={data.trend} />
        </GlassCard>
        <DepartmentPanel departments={data.departments} />
        <AppsPanel
          data={data}
          onOpen={setSelected}
          now={now}
          filter={filter}
          onFilter={setFilter}
          sort={sort}
          onSort={setSort}
        />
        <RemediationLog items={data.remediations} role={role} now={now} onDecided={() => void refresh()} />
      </div>

      <footer className="mt-10 text-center text-[0.7rem] leading-relaxed text-slate-500">
        Metadata-only telemetry: domain, department and time. No message content is inspected.
        <br className="sm:hidden" /> Demo data is synthetic and every vendor shown is fictional.
      </footer>

      {selected && (
        <VendorDrawer
          app={selected}
          role={role}
          onClose={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      )}

      {/* Mounted only while open, so every ⌘K starts with an empty search. */}
      {paletteOpen && (
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        role={role}
        apps={data.apps}
        pending={pending}
        onOpenApp={setSelected}
        onReview={setReview}
        onFilter={(f) => {
          setFilter(f);
          showTools();
        }}
        onSort={(key: SortKey) => {
          setSort((s) => (s.key === key ? s : nextSort(s, key)));
          showTools();
        }}
        onRefresh={() => void refresh()}
        onLogout={() => void logout()}
      />
      )}

      {review && <ReviewDialog item={review} onClose={() => setReview(null)} onDecided={() => void refresh()} />}
    </div>
  );
}

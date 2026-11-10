"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { simulateTrafficBurst } from "@/lib/actions";
import { failureMessage, TIMEOUT_MS } from "@/lib/request-timeout";
import { applyReducedMotion, loadReducedMotion } from "@/lib/use-reduced-motion";
import { applyTheme, loadTheme, type Theme } from "@/lib/use-theme";
import { useToast } from "@/lib/use-toast";
import type { Dashboard, LiveEvent, LiveFeed, Remediation, Role, ShadowApp } from "@/lib/types";

import { AppsPanel, nextSort, type SeverityFilter, type SortKey, type SortState } from "./apps-panel";
import { TrendChart } from "./charts";
import { CommandPalette } from "./command-palette";
import { DecisionQueue } from "./decision-queue";
import { DepartmentHeatmap } from "./department-heatmap";
import { buildFortigateConfig, buildPdpaCsv, downloadTextFile, GovernanceExport } from "./governance-export";
import { BoltIcon, CloseIcon, CompareIcon, LogoutIcon, MoonIcon, MotionIcon, PrinterIcon, RefreshIcon, ShieldMark, SunIcon } from "./icons";
import { DepartmentBars, DetectionColumns, RiskMap, SeverityRing, TrainingBreakdown } from "./insight-charts";
import { KpiRow } from "./kpi-row";
import { LiveTraffic } from "./live-traffic";
import { RemediationLog } from "./remediation-log";
import { ReviewDialog } from "./review-dialog";
import { TopTools } from "./top-tools";
import { TrafficMap } from "./traffic-map";
import { Badge } from "./ui/badge";
import { Button, Segmented } from "./ui/button";
import { Panel } from "./ui/card";
import { TabPanel, Tabs } from "./ui/tabs";
import { Toaster } from "./toaster";
import { CompareDialog } from "./compare-dialog";
import { VendorDrawer } from "./vendor-drawer";

// The live feed is a small query, so it runs often. The full dashboard follows it when something changed.
const LIVE_MS = 4_000;
const REFETCH_GAP_MS = 8_000;
const FULL_REFRESH_MS = 60_000;
const MAX_LIVE_EVENTS = 30;

type LiveState = {
  events: LiveEvent[];
  lastMinute: LiveFeed["last_minute"] | null;
  policiesChangedAt: string | null;
  syncedAt: number | null;
  /** Counts the server's answers. The Live dot beats and the next-check line restarts on each one, so a stalled feed stops them. */
  beat: number;
};

type TabId = "overview" | "tools" | "reviews" | "departments";
const TAB_IDS: TabId[] = ["overview", "tools", "reviews", "departments"];
const tabFromHash = (hash: string): TabId => TAB_IDS.find((t) => t === hash.slice(1)) ?? "overview";

type ToolsView = { filter: SeverityFilter; sort: SortState };

const VIEW_KEY = "shadowguard:tools-view";
const SORT_KEYS: SortKey[] = ["name", "exposure", "users", "last_seen"];
const FILTERS: SeverityFilter[] = ["all", "critical", "high", "moderate", "low"];

/** The saved filter and sort, checked first because storage can hold anything. */
function loadToolsView(): Partial<ToolsView> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "{}") as Partial<ToolsView>;
    return {
      ...(saved.filter && FILTERS.includes(saved.filter) ? { filter: saved.filter } : {}),
      ...(saved.sort && SORT_KEYS.includes(saved.sort.key) && ["asc", "desc"].includes(saved.sort.dir) ? { sort: saved.sort } : {}),
    };
  } catch {
    return {};
  }
}

// How the Overview is laid out on a big enough window: everything on one screen, or the full scrolling page.
type OverviewLayout = "fit" | "full";
const LAYOUT_KEY = "shadowguard:overview-layout";

function loadLayout(): OverviewLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "full" ? "full" : "fit";
  } catch {
    return "fit";
  }
}

/** Single-key shortcuts stand aside for typing, browser shortcuts and open dialogs. */
function shortcutsAllowed(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const target = e.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]")) return false;
  return document.querySelector('[aria-modal="true"]') === null;
}

/** How fresh the screen is, counted in seconds. It ticks on its own so the whole dashboard doesn't redraw every second. */
function LastSynced({ at }: { at: number | null }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);
  if (!at || !now) return <span className="font-mono">connecting</span>;
  return <span className="font-mono">updated {Math.max(0, Math.round((now - at) / 1000))}s ago</span>;
}

/** The one fact that most needs attention right now, computed from the data on screen. */
function finding(data: Dashboard, pending: number): string {
  const open = data.apps.flatMap((a) =>
    a.departments.filter((d) => d.status === "open").map((d) => ({ app: a.name, department: d.department, score: d.score })),
  );
  const worst = open.reduce<(typeof open)[number] | null>((w, p) => (!w || p.score > w.score ? p : w), null);
  if (!worst || worst.score < 50) return "No tool is at High or Critical in any department.";
  const proposals = pending === 0 ? "" : ` ${pending} block ${pending === 1 ? "proposal needs" : "proposals need"} a decision.`;
  return `${worst.app} is the worst exposure, at ${worst.score} in ${worst.department}.${proposals}`;
}

export function DashboardShell({ initial, role, demo = false }: { initial: Dashboard; role: Role; demo?: boolean }) {
  const [data, setData] = useState(initial);
  // First render uses the data's own timestamp, so server and browser print
  // identical relative times ("41 minutes ago"); the live clock takes over after mount.
  const [now, setNow] = useState(() => Date.parse(initial.generated_at));
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [selected, setSelected] = useState<ShadowApp | null>(null);
  const [view, setView] = useState<ToolsView>({ filter: "all", sort: { key: "exposure", dir: "desc" } });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [review, setReview] = useState<Remediation | null>(null);
  const [isMac, setIsMac] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [layout, setLayout] = useState<OverviewLayout>("fit");
  const [compareApps, setCompareApps] = useState<ShadowApp[]>([]);
  const inFlight = useRef(false);
  const refreshAgain = useRef(false);
  const [live, setLive] = useState<LiveState>({ events: [], lastMinute: null, policiesChangedAt: null, syncedAt: null, beat: 0 });
  const liveBusy = useRef(false);
  const afterId = useRef(0);
  const revision = useRef<string | null>(null);
  const dirty = useRef(false);
  const lastFull = useRef(0);
  const { toasts, toast, dismiss, pause, resume } = useToast();
  const lastSeen = useRef(initial);

  // Filter and sort survive reloads for this browser tab. They're saved on a change,
  // not on load, so opening the page can never overwrite the saved view.
  const updateView = useCallback((patch: Partial<ToolsView>) => {
    setView((current) => {
      const next = { ...current, ...patch };
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* The view still applies for this visit. */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setView((current) => ({ ...current, ...loadToolsView() }));
    setLayout(loadLayout());
    const saved = loadReducedMotion();
    setReduceMotion(saved);
    document.documentElement.classList.toggle("reduce-motion", saved);
    const savedTheme = loadTheme();
    setTheme(savedTheme);
    applyTheme(savedTheme, false);
  }, []);

  const toggleMotion = useCallback(() => {
    setReduceMotion((current) => {
      applyReducedMotion(!current);
      return !current;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  // Saved on a change, not on load, like the tools view.
  const chooseLayout = useCallback((next: OverviewLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* The choice still applies for this visit. */
    }
  }, []);

  const openTab = useCallback((next: TabId) => {
    setTab(next);
    if (tabFromHash(window.location.hash) !== next) window.history.pushState(null, "", `#${next}`);
  }, []);

  // Say what changed when a poll brings it, so the page doesn't mutate silently under
  // the user. Each change is reported once, against the data from the previous poll.
  useEffect(() => {
    const previous = lastSeen.current;
    if (previous === data) return;
    lastSeen.current = data;

    const wasCritical = new Set(previous.apps.filter((a) => a.severity === "critical").map((a) => a.id));
    for (const a of data.apps.filter((app) => app.severity === "critical" && !wasCritical.has(app.id))) {
      const departments = a.departments.filter((d) => d.severity === "critical").map((d) => d.department);
      toast({
        title: `${a.name} is now Critical`,
        description: `In ${departments.join(", ")}`,
        tone: "danger",
        duration: 6_000,
      });
    }

    const wasPending = new Set(previous.remediations.filter((r) => r.status === "pending_approval").map((r) => r.id));
    const fresh = data.remediations.filter((r) => r.status === "pending_approval" && !wasPending.has(r.id)).length;
    if (fresh > 0) {
      toast({
        title: fresh === 1 ? "New block proposal" : `${fresh} new block proposals`,
        description: fresh === 1 ? "It needs an admin's decision." : "They need an admin's decision.",
        tone: "warning",
        duration: 6_000,
      });
    }
  }, [data, toast]);

  const refresh = useCallback(async () => {
    // A poll already on its way may predate what just changed, such as a block decision, so fetch once more after it.
    if (inFlight.current) {
      refreshAgain.current = true;
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    try {
      // Cap iterations so a stuck refreshAgain flag can't spin forever fetching.
      for (let i = 0; i < 3; i += 1) {
        refreshAgain.current = false;
        const res = await fetch("/api/dashboard", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS.poll) });
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Dashboard;
        setData(next);
        setStale(false);
        dirty.current = false;
        lastFull.current = Date.now();
        if (!refreshAgain.current) break;
      }
    } catch {
      setStale(true);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setNow(Date.now());
    }
  }, []);

  // Follow the live feed. It says when the rest of the dashboard changed, so everything on
  // screen stays current without running the full query every few seconds.
  const pollLive = useCallback(async () => {
    if (liveBusy.current) return;
    liveBusy.current = true;
    try {
      // A request that never answers would leave liveBusy set and stop every later poll, so it gets a deadline.
      const res = await fetch(`/api/live?after_id=${afterId.current}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS.poll) });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const feed = (await res.json()) as LiveFeed;
      afterId.current = feed.latest_event_id < afterId.current ? feed.latest_event_id : Math.max(afterId.current, feed.latest_event_id);
      setLive((current) => {
        const incoming = new Set(feed.events.map((e) => e.id));
        return {
          events: [...feed.events, ...current.events.filter((e) => !incoming.has(e.id))].slice(0, MAX_LIVE_EVENTS),
          lastMinute: feed.last_minute,
          policiesChangedAt: feed.policies_changed_at,
          syncedAt: Date.now(),
          beat: current.beat + 1,
        };
      });
      setStale(false);
      if (revision.current !== null && revision.current !== feed.revision) dirty.current = true;
      revision.current = feed.revision;
      const sinceFull = Date.now() - lastFull.current;
      if ((dirty.current && sinceFull >= REFETCH_GAP_MS) || sinceFull >= FULL_REFRESH_MS) {
        void refresh();
      }
    } catch {
      setStale(true);
    } finally {
      liveBusy.current = false;
    }
  }, [refresh]);

  // Only while the tab is visible, and straight away when it becomes visible again.
  useEffect(() => {
    lastFull.current = Date.now();
    const tick = () => {
      if (document.visibilityState === "visible") void pollLive();
    };
    tick();
    const timer = window.setInterval(tick, LIVE_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pollLive]);

  // Keep open dialogs and drawers in sync with fresh data.
  useEffect(() => {
    setSelected((s) => (s ? (data.apps.find((a) => a.id === s.id) ?? s) : s));
    setCompareApps((prev) => prev.map((c) => data.apps.find((a) => a.id === c.id) ?? c));
    setReview((r) => (r ? (data.remediations.find((x) => x.id === r.id && x.status === "pending_approval") ?? null) : null));
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

  // Keyboard accelerators: 1-4 switch tabs, R refreshes, / opens search, ? lists them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsAllowed(e)) return;
      const next = TAB_IDS[Number(e.key) - 1];
      if (next) {
        e.preventDefault();
        openTab(next);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        void refresh();
      } else if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        toast({
          title: "Keyboard shortcuts",
          description: "1 to 4 switch tabs, R refreshes, / opens search, and Ctrl K opens the command menu.",
          duration: 8_000,
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openTab, refresh, toast]);

  const logout = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS.request) });
      if (!res.ok) throw new Error(String(res.status));
      window.location.assign("/login");
    } catch (err) {
      toast({ title: "Couldn't sign out", description: failureMessage(err, "The server didn't answer. Try again."), tone: "danger" });
    }
  }, [toast]);

  // The open tab lives in the URL, so it can be linked to and Back returns to the previous tab.
  useEffect(() => {
    const sync = () => setTab(tabFromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const showTools = useCallback(() => {
    setSelected(null);
    openTab("tools");
  }, [openTab]);

  const pending = useMemo(() => data.remediations.filter((r) => r.status === "pending_approval"), [data.remediations]);

  const toggleCompare = useCallback((app: ShadowApp) => {
    setCompareApps((prev) => {
      if (prev.find((a) => a.id === app.id)) {
        return prev.filter((a) => a.id !== app.id);
      }
      if (prev.length >= 2) return prev;
      return [...prev, app];
    });
  }, []);

  const clearCompare = useCallback(() => setCompareApps([]), []);

  const runSimulation = useCallback(async () => {
    if (simulating) return;
    setSimulating(true);
    try {
      const res = await simulateTrafficBurst();
      void pollLive();
      toast({
        title: "Simulated live traffic burst",
        description: `${res.accepted} campus metadata events sent to the live stream.`,
        tone: "success",
      });
    } catch (err) {
      toast({
        title: "Simulation failed",
        description: failureMessage(err, "Could not send telemetry burst."),
        tone: "danger",
      });
    } finally {
      setSimulating(false);
    }
  }, [simulating, pollLive, toast]);

  const exportCsv = useCallback(() => {
    downloadTextFile("shadowguard-pdpa-audit.csv", buildPdpaCsv(data), "text/csv;charset=utf-8");
    toast({ title: "Downloaded PDPA audit CSV", description: "shadowguard-pdpa-audit.csv saved.", tone: "success" });
  }, [data, toast]);

  const exportFortigate = useCallback(() => {
    downloadTextFile("shadowguard-fortigate-blocklist.conf", buildFortigateConfig(data), "text/plain;charset=utf-8");
    toast({ title: "Downloaded FortiGate config", description: "shadowguard-fortigate-blocklist.conf saved.", tone: "success" });
  }, [data, toast]);

  return (
    <>
      {/* On a wide enough window the Overview fills exactly one screen (the `dense:` styles), unless the viewer
          picked the full page; the other tabs scroll. */}
      <div className={tab === "overview" && layout === "fit" ? "one-screen dense:flex dense:h-dvh dense:flex-col" : undefined}>
      <header className="sticky top-0 z-30 border-b border-header-line bg-header dense:static">
        <div className="mx-auto flex min-h-14 w-full max-w-[1500px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-8 dense:min-h-12 dense:py-1.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <ShieldMark size={22} className="shrink-0 text-accent" />
            <span className="text-base font-semibold text-ink">ShadowGuard</span>
            <span className="hidden text-sm text-muted sm:inline">University network</span>
          </div>

          {/* On a phone the controls wrap rather than push the page sideways. */}
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {/* Connection status: announces changes to screen readers, not the clock. */}
            <span className="sr-only" role="status">
              {stale ? "Connection lost. Reconnecting." : "Connection live."}
            </span>
            {/* The dot beats once each time the server answers, so a working connection shows even on a quiet network. On a phone the dot alone says it. */}
            <Badge tone={stale ? "warning" : "success"} title={stale ? "The last check failed. Retrying." : `Checking for new traffic every ${LIVE_MS / 1000} seconds`}>
              <span className="relative flex h-2 w-2" aria-hidden>
                {!stale && live.beat > 0 && <span key={live.beat} className="absolute inset-0 rounded-full bg-positive opacity-0 animate-beat" />}
                <span className={`relative h-2 w-2 rounded-full ${stale ? "bg-warning" : "bg-positive"}`} />
              </span>
              <span className="hidden sm:inline">{stale ? "Reconnecting…" : "Live"}</span>
            </Badge>
            <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex">
              <LastSynced at={live.syncedAt} />
            </span>
            {role === "admin" && (
              <Button
                size="sm"
                onClick={() => void runSimulation()}
                disabled={simulating}
                variant="secondary"
                title="Send 5 live campus metadata events through the real ingest API to test real-time detection"
              >
                <BoltIcon size={14} className="text-accent" />
                <span className="hidden lg:inline">{simulating ? "Sending…" : "Simulate burst"}</span>
              </Button>
            )}
            <Button
              size="icon"
              onClick={() => void refresh()}
              aria-label="Refresh now"
              disabled={refreshing}
              variant="ghost"
              title={refreshing ? "Refreshing…" : "Refresh data"}
            >
              <RefreshIcon size={16} className={refreshing ? "animate-spin" : ""} />
            </Button>
            <Button
              size="icon"
              onClick={toggleMotion}
              aria-label={reduceMotion ? "Turn animations on" : "Turn animations off"}
              variant="ghost"
              title={reduceMotion ? "Turn animations on" : "Turn animations off"}
              className={reduceMotion ? "text-muted" : ""}
            >
              <MotionIcon size={16} />
            </Button>
            <Button
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              variant="ghost"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </Button>
            {/* Only where it changes something: the Overview, on a window big enough to fit it on one screen. */}
            {tab === "overview" && (
              <Segmented
                label="Overview layout"
                value={layout}
                onChange={chooseLayout}
                className="hidden [@media(min-width:1280px)_and_(min-height:740px)]:inline-flex"
                options={[
                  { value: "fit", label: "Fit to screen", title: "Every Overview block on one screen" },
                  { value: "full", label: "Full page", title: "Bigger charts and full lists; the page scrolls" },
                ]}
              />
            )}
            {/* One tool picked so far: the dialog opens by itself when a second is chosen. */}
            {compareApps.length === 1 && (
              <Button
                onClick={clearCompare}
                aria-label={`Clear comparison, ${compareApps[0]!.name} selected`}
                variant="ghost"
                title="Pick one more tool to compare, or select this to clear"
              >
                <CompareIcon size={16} className="text-accent" />
                <span className="hidden sm:inline">1 of 2 picked</span>
                <CloseIcon size={14} />
              </Button>
            )}
            <Button
              className="gap-2"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command menu"
              aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <circle cx="11" cy="11" r="6.5" />
                <path d="m20 20-4.2-4.2" />
              </svg>
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden font-mono text-xs font-normal text-muted md:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => window.print()} aria-label="Print this view" title="Print" className="hidden sm:inline-flex">
              <PrinterIcon size={16} />
            </Button>
            {/* A reminder to switch demo sign-in off: while it's on, anyone with the link gets in. */}
            {demo && (
              <Badge tone="warning" title="Demo sign-in is on (DEMO_SIGN_IN), so anyone with the link can sign in. Turn it off after recording.">
                Demo<span className="hidden sm:inline"> mode</span>
              </Badge>
            )}
            <span className="px-1 text-xs text-ink2">{role === "admin" ? "Admin" : "Viewer"}</span>
            <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
              <LogoutIcon size={15} />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-6 sm:px-8 dense:flex dense:min-h-0 dense:flex-1 dense:flex-col dense:pb-3 dense:pt-3">
        <div className="mb-4 dense:mb-2 dense:flex dense:items-baseline dense:gap-4">
          <h1 className="text-title font-semibold tracking-tight text-ink dense:shrink-0 dense:text-lg">Shadow AI exposure</h1>
          <p className="mt-1 text-base text-ink2 dense:mt-0 dense:truncate">{finding(data, pending.length)}</p>
        </div>

        <KpiRow data={data} />

        <div className="mt-6 dense:mt-2 dense:flex dense:min-h-0 dense:flex-1 dense:flex-col">
          <Tabs
            label="Dashboard views"
            selected={tab}
            onSelect={openTab}
            items={[
              { id: "overview", label: "Overview" },
              { id: "tools", label: "Tool exposure" },
              { id: "reviews", label: "Remediation and reviews", count: pending.length },
              { id: "departments", label: "Department heatmap" },
            ]}
          />

          {tab === "overview" && (
            <TabPanel id="overview">
              {/* 12 columns, one 24px gutter: 8 + 4 on xl, so every row lands on the canvas edges. On one screen
                  (dense) it fills the window instead: the map over live traffic down the left half; proposals,
                  the trend and daily detections in the middle; recent activity, severity, departments and
                  tools on the right. Twelve equal rows, so a middle panel spans four and a right one three. */}
              <div className="grid grid-cols-12 gap-6 dense:h-full dense:grid-rows-[repeat(12,minmax(0,1fr))] dense:gap-4">
                <div className="col-span-12 flex flex-col gap-6 xl:col-span-8 dense:col-span-6 dense:row-span-12 dense:row-start-1 dense:min-h-0 dense:gap-4">
                  <Panel
                    title="Where our data goes"
                    note="Traffic to and from unapproved tools, placed by the storage region each vendor's policy states, not by looking up the IP. Staff IP addresses aren't collected."
                    bodyClassName="pt-3"
                    className="dense:flex-[3]"
                  >
                    <TrafficMap
                      apps={data.apps}
                      events={live.events}
                      lastMinute={live.lastMinute}
                      beat={stale ? null : live.beat}
                      onOpen={setSelected}
                    />
                  </Panel>
                  <LiveTraffic
                    events={live.events}
                    lastMinute={live.lastMinute}
                    connected={live.syncedAt !== null}
                    beat={stale ? null : live.beat}
                    checkEveryMs={LIVE_MS}
                    apps={data.apps}
                    onOpen={setSelected}
                    className="flex-1 dense:flex-[2]"
                  />
                </div>
                {/* Proposals need action, so on a phone they come first. */}
                <div className="order-first col-span-12 flex flex-col gap-6 xl:order-none xl:col-span-4 dense:contents">
                  <DecisionQueue pending={pending} data={data} role={role} now={now} onReview={setReview} className="dense:col-span-3 dense:col-start-7 dense:row-span-4 dense:row-start-1" />
                  <Panel title="Exposure by severity" note="Each tool in each department" tone="danger" className="flex-1 dense:col-span-3 dense:col-start-10 dense:row-span-3 dense:row-start-4">
                    <SeverityRing counts={data.severity_breakdown} />
                  </Panel>
                </div>
                <Panel
                  title="Risk exposure index, last 14 days"
                  tone="data"
                  className="col-span-12 md:col-span-6 xl:col-span-4 dense:col-span-3 dense:col-start-7 dense:row-span-4 dense:row-start-5"
                  bodyClassName="pt-3"
                >
                  <TrendChart points={data.trend} />
                </Panel>
                <Panel
                  title="Most exposed departments"
                  tone="warning"
                  className="col-span-12 md:col-span-6 xl:col-span-4 dense:col-span-3 dense:col-start-10 dense:row-span-3 dense:row-start-7"
                  bodyClassName="pt-3"
                >
                  <DepartmentBars departments={data.departments} />
                </Panel>
                <Panel
                  title="Detections per day"
                  tone="data"
                  className="col-span-12 xl:col-span-4 dense:col-span-3 dense:col-start-7 dense:row-span-4 dense:row-start-9"
                  bodyClassName="pt-3"
                  action={
                    <ul className="flex gap-3 text-xs text-ink2">
                      <li className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-sev-critical" /> Critical
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-data" /> Other
                      </li>
                    </ul>
                  }
                >
                  <DetectionColumns points={data.trend} />
                </Panel>
                <RemediationLog
                  title="Recent activity"
                  note=""
                  items={data.remediations}
                  limit={3}
                  onViewAll={() => openTab("reviews")}
                  role={role}
                  now={now}
                  onReview={setReview}
                  className="col-span-12 xl:col-span-8 dense:col-span-3 dense:col-start-10 dense:row-span-3 dense:row-start-1"
                />
                <TopTools
                  apps={data.apps}
                  now={now}
                  onOpen={setSelected}
                  onViewAll={() => openTab("tools")}
                  className="col-span-12 xl:col-span-4 dense:col-span-3 dense:col-start-10 dense:row-span-3 dense:row-start-10"
                />
              </div>
            </TabPanel>
          )}

          {tab === "tools" && (
            <TabPanel id="tools">
              <div className="grid grid-cols-12 gap-6">
                <Panel title="Risk map" note="Top right is what to deal with first." tone="danger" className="col-span-12 xl:col-span-8" bodyClassName="pt-3">
                  <RiskMap apps={data.apps} exposureWindowDays={data.exposure_window_days} onOpen={setSelected} />
                </Panel>
                <Panel title="Who trains on your data" note="From each vendor's privacy policy" tone="warning" className="col-span-12 xl:col-span-4">
                  <TrainingBreakdown apps={data.apps} onOpen={setSelected} />
                </Panel>
                <AppsPanel
                  data={data}
                  onOpen={setSelected}
                  onCompare={toggleCompare}
                  comparedIds={compareApps.map((a) => a.id)}
                  now={now}
                  filter={view.filter}
                  onFilter={(filter) => updateView({ filter })}
                  sort={view.sort}
                  onSort={(sort) => updateView({ sort })}
                  className="col-span-12"
                />
              </div>
            </TabPanel>
          )}

          {tab === "reviews" && (
            <TabPanel id="reviews">
              <div className="grid grid-cols-12 gap-6">
                <DecisionQueue detailed pending={pending} data={data} role={role} now={now} onReview={setReview} className="col-span-12" />
                <GovernanceExport data={data} onToast={toast} className="col-span-12" />
                <RemediationLog items={data.remediations} role={role} now={now} onReview={setReview} className="col-span-12" />
              </div>
            </TabPanel>
          )}

          {tab === "departments" && (
            <TabPanel id="departments">
              <DepartmentHeatmap apps={data.apps} departments={data.departments} exposureWindowDays={data.exposure_window_days} onOpen={setSelected} />
            </TabPanel>
          )}
        </div>

        <footer className="mt-6 text-xs leading-relaxed text-muted dense:mt-2 dense:shrink-0 dense:leading-4">
          Metadata-only telemetry: domain, department, time, traffic volume and the vendor&apos;s IP. No message content is inspected. The demo
          vendors (Summarix, GradeSync and the rest) and their traffic are fictional. Real AI tools, such as ChatGPT and Gemini, appear only
          when a collector reports real traffic, and their scores are automated readings of each vendor&apos;s published policy.
        </footer>
      </div>
      </div>

      {selected && (
        <VendorDrawer
          key={selected.id}
          app={selected}
          role={role}
          now={now}
          policiesChangedAt={live.policiesChangedAt}
          exposureWindowDays={data.exposure_window_days}
          onClose={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      )}

      {compareApps.length === 2 && compareApps[0] && compareApps[1] && (
        <CompareDialog
          appA={compareApps[0]!}
          appB={compareApps[1]!}
          now={now}
          onClose={clearCompare}
          onOpen={(app) => {
            clearCompare();
            setSelected(app);
          }}
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
          theme={theme}
          onToggleTheme={toggleTheme}
          onSimulate={role === "admin" ? () => void runSimulation() : undefined}
          onExportCsv={exportCsv}
          onExportFortigate={exportFortigate}
          onOpenApp={setSelected}
          onReview={setReview}
          onFilter={(filter) => {
            updateView({ filter });
            showTools();
          }}
          onSort={(key: SortKey) => {
            updateView({ sort: view.sort.key === key ? view.sort : nextSort(view.sort, key) });
            showTools();
          }}
          onRefresh={() => void refresh()}
          onLogout={() => void logout()}
        />
      )}

      {review && <ReviewDialog item={review} data={data} onClose={() => setReview(null)} onDecided={() => void refresh()} onToast={toast} />}
      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </>
  );
}

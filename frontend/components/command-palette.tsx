"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { SEVERITY_LABEL, SEVERITY_ORDER } from "@/lib/format";
import type { Theme } from "@/lib/use-theme";
import type { Remediation, Role, ShadowApp } from "@/lib/types";

import type { SeverityFilter, SortKey } from "./apps-panel";
import { BlockIcon, ChevronIcon, LogoutIcon, MoonIcon, RadarIcon, RefreshIcon, SunIcon } from "./icons";
import { Badge, SeverityBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * ⌘K / Ctrl+K command palette, written without dependencies.
 *
 * Accessibility: a modal dialog containing an ARIA combobox (the input) that
 * controls a listbox; arrow keys move the active option, Enter runs it, Escape
 * closes and focus returns to where it was.
 *
 * Safety: nothing here blocks a tool directly. "Review block" opens the same
 * approve / reject confirmation an admin sees in the remediation log.
 */

type Item = {
  id: string;
  group: string;
  label: string;
  keywords: string;
  hint?: ReactNode;
  icon: ReactNode;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  role,
  apps,
  pending,
  theme = "dark",
  onToggleTheme,
  onOpenApp,
  onReview,
  onFilter,
  onSort,
  onRefresh,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  apps: ShadowApp[];
  pending: Remediation[];
  theme?: Theme;
  onToggleTheme?: () => void;
  onOpenApp: (app: ShadowApp) => void;
  onReview: (r: Remediation) => void;
  onFilter: (f: SeverityFilter) => void;
  onSort: (key: SortKey) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (role === "admin") {
      for (const r of pending) {
        out.push({
          id: `review-${r.id}`,
          group: "Awaiting your approval",
          label: `Review block: ${r.app} · ${r.department}`,
          keywords: `block approve reject review ${r.app} ${r.domain} ${r.department}`,
          hint: <Badge tone="warning">Needs a decision</Badge>,
          icon: <BlockIcon size={16} />,
          run: () => onReview(r),
        });
      }
    }
    for (const a of apps) {
      out.push({
        id: `app-${a.id}`,
        group: "Tools",
        label: `Open ${a.name}`,
        keywords: `${a.name} ${a.domain} ${a.vendor} ${a.category} ${a.departments.map((d) => d.department).join(" ")}`,
        hint: <SeverityBadge severity={a.severity} score={a.max_score} />,
        icon: <RadarIcon size={16} />,
        run: () => onOpenApp(a),
      });
    }
    for (const s of SEVERITY_ORDER) {
      out.push({
        id: `filter-${s}`,
        group: "Filter tools",
        label: `Show ${SEVERITY_LABEL[s]} only`,
        keywords: `filter severity ${s}`,
        icon: <ChevronIcon size={16} />,
        run: () => onFilter(s),
      });
    }
    out.push({
      id: "filter-all",
      group: "Filter tools",
      label: "Show all tools",
      keywords: "filter clear reset all",
      icon: <ChevronIcon size={16} />,
      run: () => onFilter("all"),
    });
    const sorts: [SortKey, string][] = [
      ["exposure", "Sort by worst exposure"],
      ["users", "Sort by most users"],
      ["last_seen", "Sort by recently seen"],
      ["name", "Sort by name"],
    ];
    for (const [key, label] of sorts) {
      out.push({ id: `sort-${key}`, group: "Sort tools", label, keywords: "sort order", icon: <ChevronIcon size={16} />, run: () => onSort(key) });
    }
    out.push({
      id: "refresh",
      group: "Actions",
      label: "Refresh data now",
      keywords: "reload update",
      icon: <RefreshIcon size={16} />,
      run: onRefresh,
    });
    if (onToggleTheme) {
      out.push({
        id: "theme",
        group: "Actions",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        keywords: "theme appearance dark light mode colour color",
        icon: theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />,
        run: onToggleTheme,
      });
    }
    out.push({ id: "logout", group: "Actions", label: "Sign out", keywords: "log out exit", icon: <LogoutIcon size={16} />, run: onLogout });
    return out;
  }, [role, pending, apps, theme, onToggleTheme, onReview, onOpenApp, onFilter, onSort, onRefresh, onLogout]);

  // Every typed word must appear somewhere in the item's label or keywords.
  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return items;
    return items.filter((it) => {
      const hay = `${it.label} ${it.keywords} ${it.group}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Remember what had focus before opening, and give it back on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (visible.length ? (i + 1) % visible.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (visible.length ? (i - 1 + visible.length) % visible.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, visible.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(visible[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close the drawer underneath
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // keep focus inside the dialog
    }
  };

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <Button variant="bare" tabIndex={-1} aria-label="Close command menu" className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="relative w-full max-w-xl animate-fade-in overflow-hidden rounded-xl border border-line bg-surface"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="shrink-0 text-muted" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </svg>
          <Input
            bare
            ref={inputRef}
            // Focus synchronously on mount so keystrokes typed right after ⌘K are never lost.
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 100))}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={visible[active] ? `${baseId}-${active}` : undefined}
            placeholder={role === "admin" ? "Search tools, or type “block” to review proposals…" : "Search tools or actions…"}
            className="h-14 w-full bg-transparent text-base text-ink placeholder-muted outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
          />
          <kbd className="hidden shrink-0 rounded border border-control px-1.5 py-0.5 font-mono text-xs text-muted sm:block">
            Esc
          </kbd>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Commands" className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
          {visible.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No matching tools or actions.</li>}
          {visible.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            const selected = index === active;
            return (
              <li key={item.id} role="presentation">
                {showGroup && (
                  <p className="px-3 pb-1.5 pt-3 text-xs text-muted" aria-hidden>
                    {item.group}
                  </p>
                )}
                <div
                  id={`${baseId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                    selected ? "bg-raised text-ink" : "text-ink2"
                  }`}
                >
                  <span className={selected ? "text-ink" : "text-muted"}>{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-xs">{item.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
          <span>
            <kbd className="font-mono">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-mono">Enter</kbd> run
          </span>
          <span className="ml-auto">Blocks are never applied from here: reviewing opens the approval step.</span>
        </div>
      </div>
    </div>
  );
}

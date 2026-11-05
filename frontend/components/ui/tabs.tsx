"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem<T extends string> = { id: T; label: string; count?: number };

/**
 * Border-anchored tabs following the ARIA tabs pattern: left and right arrows
 * move between tabs, and only the selected tab is in the Tab order. A count
 * marks a tab that holds pending work.
 */
export function Tabs<T extends string>({
  items,
  selected,
  onSelect,
  label,
}: {
  items: TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  label: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = items.findIndex((i) => i.id === selected);
    const next = items[(index + step + items.length) % items.length]!;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]">
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <button
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={`panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={onKey}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-base transition-colors [@media(pointer:coarse)]:min-h-11 ${
              active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:border-control hover:text-ink2"
            }`}
          >
            {item.label}
            {item.count ? (
              <span className="rounded border border-tone-warning-line bg-tone-warning px-1.5 font-mono text-xs text-tone-warning-ink">
                <span className="sr-only">, pending: </span>
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel<T extends string>({ id, children }: { id: T; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={-1} className="pt-6">
      {children}
    </div>
  );
}

"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem<T extends string> = { id: T; label: string; title?: string; icon: ReactNode; count?: number };

/**
 * The section rail, following the ARIA tabs pattern: arrow keys move between sections, and only the open
 * one is in the Tab order. It is one element at every width: a bar along the bottom of a phone, a narrow
 * rail of icons over labels from `lg`, and a full rail with labels beside the icons from `2xl`. A count
 * marks a section that holds pending work. `brand` sits above the sections and `footer` below them; both
 * show only once the rail stands on the left.
 */
export function Tabs<T extends string>({
  items,
  selected,
  onSelect,
  label,
  brand,
  footer,
}: {
  items: TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  label: string;
  brand?: ReactNode;
  footer?: ReactNode;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = items.findIndex((i) => i.id === selected);
    const next = items[(index + step + items.length) % items.length]!;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-24 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-t-0 lg:pb-0 2xl:w-52 print:hidden">
      {brand && <div className="hidden shrink-0 lg:flex lg:h-14 lg:items-center lg:justify-center 2xl:justify-start 2xl:px-5">{brand}</div>}
      <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 lg:flex-none lg:flex-col lg:gap-1 lg:px-2 lg:pt-2">
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
              title={item.title}
              aria-selected={active}
              aria-controls={`panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                onSelect(item.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
                document.documentElement.scrollTo?.({ top: 0, behavior: "smooth" });
              }}
              onKeyDown={onKey}
              className={`relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs lg:px-0 transition-colors focus-visible:ring-inset lg:flex-none lg:rounded-md 2xl:min-h-10 2xl:flex-row 2xl:justify-start 2xl:gap-3 2xl:px-3 2xl:text-base ${
                active ? "font-medium text-ink lg:bg-raised" : "text-muted hover:text-ink2 lg:hover:bg-row-hover"
              }`}
            >
              {/* The open section's marker: along the top of the bar on a phone, down the rail's edge beside it. */}
              {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent lg:inset-x-auto lg:inset-y-2.5 lg:-left-2 lg:h-auto lg:w-0.5" aria-hidden />}
              {item.icon}
              <span className="max-w-full truncate">{item.label}</span>
              {item.count ? (
                <span className="absolute left-1/2 top-1.5 ml-2 rounded border border-tone-warning-line bg-tone-warning px-1 font-mono text-xs leading-4 text-tone-warning-ink 2xl:static 2xl:ml-auto 2xl:px-1.5">
                  <span className="sr-only">, pending: </span>
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {footer && <div className="mt-auto hidden shrink-0 flex-col items-center gap-1 px-2 pb-3 pt-4 lg:flex 2xl:items-stretch 2xl:px-3">{footer}</div>}
    </div>
  );
}

export function TabPanel<T extends string>({ id, children }: { id: T; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={-1} className="pt-6 dense:min-h-0 dense:flex-1 dense:pt-3">
      {children}
    </div>
  );
}

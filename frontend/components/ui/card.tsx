import type { HTMLAttributes, ReactNode } from "react";

import { PanelBoundary } from "./panel-boundary";

export type PanelTone = "accent" | "warning" | "danger" | "data" | "positive";

const HEADER_STYLE: Record<PanelTone, { band: string; mark: string }> = {
  accent: { band: "border-line bg-header", mark: "bg-accent" },
  warning: { band: "border-tone-warning-line bg-tone-warning", mark: "bg-sev-high" },
  danger: { band: "border-tone-danger-line bg-tone-danger", mark: "bg-sev-critical" },
  data: { band: "border-line bg-header", mark: "bg-data" },
  positive: { band: "border-line bg-header", mark: "bg-positive" },
};

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-line bg-surface ${className}`} {...props} />;
}

/** A nested panel on a Card: one tone step away, with a subtle rule border. */
export function SubCard({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md border border-rule bg-ground ${className}`} {...props} />;
}

/** A titled grid panel. `note` says what the panel's data is; `tone` highlights its header band. */
export function Panel({
  id,
  title,
  note,
  action,
  tone = "accent",
  children,
  className = "",
  bodyClassName = "",
}: {
  id?: string;
  title: string;
  note?: string;
  action?: ReactNode;
  tone?: PanelTone;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headerTone = HEADER_STYLE[tone];
  return (
    // On the one-screen Overview (`dense:`) a panel takes its share of the window: tighter padding, and
    // the note gives way to the content (it's still read out by screen readers).
    <section id={id} className={`flex min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface dense:min-h-0 ${className}`}>
      <header className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-5 py-3.5 dense:flex-nowrap dense:items-center dense:px-4 dense:py-2 ${headerTone.band}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`h-3.5 w-1 shrink-0 rounded-full ${headerTone.mark}`} aria-hidden />
            <h2 className="text-md font-semibold text-ink dense:truncate dense:text-base">{title}</h2>
          </div>
          {note && <p className="mt-1 pl-3.5 text-sm text-muted dense:sr-only">{note}</p>}
        </div>
        {/* On one screen a small action button doesn't make the header taller than its title. */}
        {action && <div className="dense:-my-1 dense:shrink-0">{action}</div>}
      </header>
      <div className={`min-w-0 flex-1 p-5 ${bodyClassName} dense:flex dense:min-h-0 dense:flex-col dense:px-4 dense:pb-2 dense:pt-1.5`}>
        <PanelBoundary label={title}>{children}</PanelBoundary>
      </div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-control px-4 py-3 text-sm text-muted">{children}</p>;
}

/** An inline error or status message. */
export function Notice({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`rounded-md border border-tone-danger-line bg-tone-danger px-3 py-2 text-sm text-tone-danger-ink ${className}`}>
      {children}
    </p>
  );
}

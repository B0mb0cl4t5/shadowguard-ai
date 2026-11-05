import type { HTMLAttributes, ReactNode } from "react";

import { PanelBoundary } from "./panel-boundary";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg bg-surface ${className}`} {...props} />;
}

/** A nested panel on a Card: one tone step away, no border. */
export function SubCard({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md bg-ground ${className}`} {...props} />;
}

/** A titled grid panel. `note` says what the panel's data is. */
export function Panel({
  id,
  title,
  note,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  id?: string;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-4 flex-col rounded-lg bg-surface ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="text-md font-semibold text-ink">{title}</h2>
          {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
        </div>
        {action}
      </header>
      <div className={`min-w-0 flex-1 p-5 ${bodyClassName}`}>
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

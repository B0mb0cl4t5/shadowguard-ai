import type { ReactNode } from "react";

import { SEVERITY_LABEL, SEVERITY_STYLE } from "@/lib/format";
import type { Severity } from "@/lib/types";

export function GlassCard({
  id,
  title,
  eyebrow,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  id?: string;
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={`glass flex min-w-0 scroll-mt-4 flex-col animate-rise-in ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
            {title && <h2 className="text-[0.95rem] font-semibold tracking-tight text-white">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className={`min-w-0 flex-1 px-5 pb-5 pt-4 sm:px-6 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function SeverityBadge({ severity, score, size = "md" }: { severity: Severity; score?: number; size?: "sm" | "md" }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium ${s.badge} ${
        size === "sm" ? "px-2 py-0.5 text-[0.7rem]" : "px-2.5 py-1 text-xs"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {SEVERITY_LABEL[severity]}
      {score !== undefined && <span className="tabular font-mono opacity-80">{score}</span>}
    </span>
  );
}

export function VerificationBadge({ status, compact = false }: { status: "verified" | "unverified"; compact?: boolean }) {
  return status === "verified" ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-400/10 px-2 py-0.5 text-[0.7rem] font-medium text-sky-200 ring-1 ring-inset ring-sky-300/30">
      Quote-verified
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[0.7rem] font-medium text-fuchsia-100 ring-1 ring-inset ring-fuchsia-400/45"
      title="A claim failed quote-matching, statements conflict, or the page tried to instruct the AI. Score floored at High."
    >
      {compact ? "Unverified" : "Unverified · floored at High"}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="glass-inset px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

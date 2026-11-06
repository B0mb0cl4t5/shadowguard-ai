"use client";

import { useEffect, useRef } from "react";

import { relativeTime, titleCase } from "@/lib/format";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { ShadowApp } from "@/lib/types";

import { policyChanged } from "./apps-panel";
import { ChevronIcon, CloseIcon } from "./icons";
import { Badge, SeverityBadge, VerificationBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";

/**
 * Side-by-side comparison of two tools, so an analyst can weigh
 * risk, policy posture and affected departments at a glance.
 */
export function CompareDialog({
  appA,
  appB,
  now,
  onClose,
  onOpen,
}: {
  appA: ShadowApp;
  appB: ShadowApp;
  now?: number;
  onClose: () => void;
  onOpen: (app: ShadowApp) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const higher = appA.max_score === appB.max_score ? null : appA.max_score > appB.max_score ? appA : appB;
  const unverified = appA.verification_status === "unverified" || appB.verification_status === "unverified";

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto p-4">
      <Button variant="bare" tabIndex={-1} aria-label="Close comparison" className="fixed inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        className="relative w-full max-w-[1100px] animate-rise-in rounded-lg border border-control bg-surface p-5"
      >
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <h2 id="compare-title" className="text-lg font-semibold text-ink">Compare tools</h2>
            <p className="text-xs text-muted">Side-by-side risk and policy posture.</p>
          </div>
          <Button ref={closeRef} size="icon" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </Button>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <ToolComparisonCard app={appA} now={now} onOpen={onOpen} />
          <ToolComparisonCard app={appB} now={now} onOpen={onOpen} />
        </div>

        <div className="mt-6">
          <Panel title="Verdict" bodyClassName="pt-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink2">
              {higher ? (
                <>
                  Higher exposure: <span className="font-medium text-ink">{higher.name}</span>
                  <SeverityBadge severity={higher.severity} score={higher.max_score} />
                </>
              ) : (
                <>
                  Both reach the same worst exposure: <SeverityBadge severity={appA.severity} score={appA.max_score} />
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-muted">
              Score is posture × department data sensitivity × usage spread.
              {unverified && <span className="text-warning"> At least one tool is unverified, so its score is a floor, not a measurement.</span>}
            </p>
          </Panel>
        </div>

        <footer className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close comparison
          </Button>
        </footer>
      </div>
    </div>
  );
}

function ToolComparisonCard({ app, now, onOpen }: { app: ShadowApp; now?: number; onOpen: (app: ShadowApp) => void }) {
  const depts = [...app.departments].sort((a, b) => b.score - a.score);
  const worst = depts[0];
  return (
    <Panel title={app.name} note={`${app.domain}, by ${app.vendor}`} className="flex flex-col" bodyClassName="pt-3 flex-1">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge>{titleCase(app.category)}</Badge>
        {policyChanged(app, now) && (
          <Badge tone="warning" title="Policy changed recently">Policy changed</Badge>
        )}
        <SeverityBadge severity={app.severity} score={app.max_score} />
        <VerificationBadge status={app.verification_status} compact />
      </div>

      <dl className="mb-4 space-y-2 text-xs text-ink2">
        <div className="flex justify-between">
          <dt>Users</dt>
          <dd className="font-mono text-ink">{app.total_users}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Departments</dt>
          <dd className="font-mono text-ink">{depts.length}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Last seen</dt>
          <dd className="font-mono text-ink">{relativeTime(app.last_seen, now)}</dd>
        </div>
        {app.alternative && (
          <div className="flex justify-between">
            <dt>Approved alternative</dt>
            <dd className="text-tone-success-ink">{app.alternative}</dd>
          </div>
        )}
      </dl>

      <h3 className="mb-2 text-xs font-semibold text-ink">Exposure by department</h3>
      {depts.length === 0 ? (
        <p className="mb-4 text-xs text-muted">No department data.</p>
      ) : (
        <ul className="mb-4 space-y-1.5">
          {depts.map((d) => (
            <li key={d.department} className="flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate ${d.status === "open" ? "text-ink" : "text-muted line-through"}`}>{d.department}</span>
              <SeverityBadge severity={d.severity} score={d.score} />
            </li>
          ))}
        </ul>
      )}

      {worst && (
        <>
          <h3 className="mb-2 text-xs font-semibold text-ink">How the worst score is made up</h3>
          <ul className="mb-4 space-y-1">
            {worst.factors.map((f) => (
              <li key={f.label} className="flex justify-between gap-2 text-xs">
                <span className="text-ink2">{f.label}</span>
                <span className="font-mono text-ink">{f.points}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-auto">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => onOpen(app)}>
          <ChevronIcon size={14} /> Read full policy analysis
        </Button>
      </div>
    </Panel>
  );
}

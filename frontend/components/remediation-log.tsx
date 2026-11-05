"use client";

import { useState } from "react";

import { relativeTime, type Tone } from "@/lib/format";
import type { Remediation, RemediationStatus, RemediationType, Role } from "@/lib/types";

import { BlockIcon, MessageIcon, TicketIcon } from "./icons";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState, Panel } from "./ui/card";

const TYPE_META: Record<RemediationType, { label: string; icon: typeof MessageIcon; ink: string }> = {
  nudge: { label: "Staff nudge", icon: MessageIcon, ink: "text-muted" },
  risk_ticket: { label: "Risk ticket", icon: TicketIcon, ink: "text-muted" },
  block_domain: { label: "Block proposal", icon: BlockIcon, ink: "text-negative" },
};

const STATUS_META: Record<RemediationStatus, { label: string; tone: Tone }> = {
  executed: { label: "Sent", tone: "success" },
  simulated: { label: "Simulated", tone: "neutral" },
  pending_approval: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Dismissed", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

export function RemediationLog({
  items,
  role,
  now,
  onReview,
  title = "Response log",
  note = "Nudges and risk tickets run automatically.",
  limit,
  onViewAll,
  className = "",
}: {
  items: Remediation[];
  role: Role;
  now: number;
  onReview: (item: Remediation) => void;
  title?: string;
  note?: string;
  /** Show only the newest entries, with a link to the full log. */
  limit?: number;
  onViewAll?: () => void;
  className?: string;
}) {
  const visible = limit ? items.slice(0, limit) : items;
  return (
    <Panel
      title={title}
      note={note}
      className={className}
      bodyClassName="py-2"
      action={
        onViewAll && (
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            View all <span className="font-mono">{items.length}</span>
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <div className="py-3">
          <EmptyState>No responses yet. They appear here when a tool reaches High or Critical.</EmptyState>
        </div>
      ) : (
        <ol>
          {visible.map((item) => (
            <LogItem key={item.id} item={item} role={role} now={now} onReview={onReview} clamp={Boolean(limit)} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function LogItem({
  item,
  role,
  now,
  onReview,
  clamp,
}: {
  item: Remediation;
  role: Role;
  now: number;
  onReview: (item: Remediation) => void;
  clamp: boolean;
}) {
  const meta = TYPE_META[item.action_type];
  const status = STATUS_META[item.status];
  const Icon = meta.icon;
  const pending = item.status === "pending_approval";
  const [expanded, setExpanded] = useState(false);
  const detail = item.action_type === "risk_ticket" ? item.detail.split(" | ").join(". ") : item.detail;

  return (
    <li aria-label={`${meta.label} for ${item.app}`} className="flex gap-3 border-b border-rule py-3 last:border-b-0">
      <Icon size={16} className={`mt-0.5 shrink-0 ${meta.ink}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <p className="font-medium text-ink">
            {meta.label} <span className="font-normal text-muted">for {item.app}, {item.department}</span>
          </p>
          <time className="font-mono text-xs text-muted" dateTime={item.created_at}>
            {relativeTime(item.created_at, now)}
          </time>
        </div>
        {clamp ? (
          <Button
            variant="bare"
            onClick={() => setExpanded((v) => !v)}
            className={`mt-1 block text-left text-sm text-ink2 ${expanded ? "" : "line-clamp-1"}`}
            aria-expanded={expanded}
          >
            {detail}
          </Button>
        ) : (
          <p className="mt-1 max-w-3xl text-sm text-ink2">{detail}</p>
        )}
        {(item.status !== "simulated" || item.decided_by) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {item.decided_by && <span className="font-mono text-xs text-muted">{item.decided_by}</span>}
            {pending && role === "admin" && (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                onClick={() => onReview(item)}
                aria-label={`Review block of ${item.app} for ${item.department}`}
              >
                Review
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

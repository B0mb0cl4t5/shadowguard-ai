"use client";

import { useState } from "react";

import { decideRemediation } from "@/lib/actions";
import { relativeTime } from "@/lib/format";
import type { Remediation, RemediationStatus, RemediationType, Role } from "@/lib/types";

import { BlockIcon, MessageIcon, TicketIcon } from "./icons";
import { EmptyState, GlassCard } from "./ui";

const TYPE_META: Record<RemediationType, { label: string; icon: typeof MessageIcon; tint: string }> = {
  nudge: { label: "Staff nudge", icon: MessageIcon, tint: "text-sky-300 bg-sky-400/10 ring-sky-300/25" },
  risk_ticket: { label: "Risk ticket", icon: TicketIcon, tint: "text-violet-200 bg-violet-400/10 ring-violet-300/25" },
  block_domain: { label: "Block proposal", icon: BlockIcon, tint: "text-rose-200 bg-rose-500/10 ring-rose-400/30" },
};

const STATUS_META: Record<RemediationStatus, { label: string; cls: string }> = {
  executed: { label: "Sent", cls: "text-emerald-300" },
  simulated: { label: "Simulated", cls: "text-slate-400" },
  pending_approval: { label: "Awaiting approval", cls: "text-amber-200" },
  approved: { label: "Approved", cls: "text-emerald-300" },
  rejected: { label: "Rejected", cls: "text-slate-300" },
  failed: { label: "Failed", cls: "text-rose-300" },
};

export function RemediationLog({
  items,
  role,
  now,
  onDecided,
}: {
  items: Remediation[];
  role: Role;
  now: number;
  onDecided: () => void;
}) {
  return (
    <GlassCard
      eyebrow="Stage 4 · Controlled response"
      title="Automated remediation log"
      bodyClassName="flex flex-col"
    >
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Nudges and risk tickets run automatically. Blocking is only ever proposed; a human admin decides.
      </p>
      {items.length === 0 ? (
        <EmptyState>No remediation activity yet.</EmptyState>
      ) : (
        // On xl the list is absolutely positioned, so it adds no height to the grid row:
        // the card matches the apps table beside it and the list scrolls inside.
        <div className="relative min-h-0 xl:min-h-[24rem] xl:flex-1">
          <ol className="-mr-2 max-h-[36rem] space-y-2.5 overflow-y-auto pr-2 xl:absolute xl:inset-0 xl:max-h-none">
            {items.map((item) => (
              <LogItem key={item.id} item={item} role={role} now={now} onDecided={onDecided} />
            ))}
          </ol>
        </div>
      )}
    </GlassCard>
  );
}

function LogItem({ item, role, now, onDecided }: { item: Remediation; role: Role; now: number; onDecided: () => void }) {
  const meta = TYPE_META[item.action_type];
  const status = STATUS_META[item.status];
  const Icon = meta.icon;
  const pending = item.status === "pending_approval";
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await decideRemediation(
        item.id,
        decision,
        decision === "approve" ? "Approved from dashboard" : "Rejected from dashboard",
      );
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <li
      className={`glass-inset p-3.5 ${pending ? "border-amber-300/25 bg-amber-300/[0.04]" : ""}`}
      aria-label={`${meta.label} for ${item.app}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${meta.tint}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-sm font-medium text-white">
              {meta.label} <span className="font-normal text-slate-400">· {item.app}</span>
            </p>
            <time className="text-[0.7rem] text-slate-500" dateTime={item.created_at}>
              {relativeTime(item.created_at, now)}
            </time>
          </div>
          <p className="text-xs text-slate-400">{item.department}</p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={`mt-1.5 block text-left text-xs leading-relaxed text-slate-300 ${expanded ? "" : "line-clamp-2"}`}
            aria-expanded={expanded}
          >
            {item.action_type === "risk_ticket" ? item.detail.split(" | ").join(" · ") : item.detail}
          </button>
          <p className={`mt-1.5 text-[0.7rem] font-medium ${status.cls}`}>
            {status.label}
            {item.decided_by && <span className="font-normal text-slate-500"> · {item.decided_by}</span>}
          </p>

          {pending && role === "admin" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {confirm === null ? (
                <>
                  <button type="button" className="btn-danger" disabled={busy} onClick={() => setConfirm("approve")}>
                    Approve block
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm("reject")}>
                    Reject
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-slate-300">
                    {confirm === "approve" ? `Block ${item.domain} for ${item.department}?` : "Reject this proposal?"}
                  </span>
                  <button
                    type="button"
                    className={confirm === "approve" ? "btn-danger" : "btn-ghost"}
                    disabled={busy}
                    onClick={() => decide(confirm)}
                  >
                    {busy ? "Saving…" : "Confirm"}
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
          {pending && role !== "admin" && (
            <p className="mt-2 text-[0.7rem] text-slate-500">Only an IT security admin can approve this.</p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

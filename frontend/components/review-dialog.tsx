"use client";

import { useEffect, useRef, useState } from "react";

import { decideRemediation } from "@/lib/actions";
import { relativeTime } from "@/lib/format";
import type { Remediation } from "@/lib/types";

import { BlockIcon } from "./icons";

/**
 * The human-in-the-loop step for a proposed block, opened from the ⌘K palette.
 * Nothing happens until an admin explicitly approves or rejects.
 */
export function ReviewDialog({
  item,
  onClose,
  onDecided,
}: {
  item: Remediation;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Default focus on the safe choice, never on "Approve".
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      await decideRemediation(
        item.id,
        decision,
        decision === "approve" ? "Approved via command menu" : "Rejected via command menu",
      );
      onDecided();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <button type="button" aria-label="Cancel" className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm" onClick={onClose} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-describedby="review-desc"
        className="glass relative w-full max-w-md border-white/15 bg-ink-900/85 p-6 backdrop-blur-xl animate-rise-in"
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 text-rose-200 ring-1 ring-inset ring-rose-400/35">
          <BlockIcon size={18} />
        </span>
        <h2 id="review-title" className="mt-4 text-base font-semibold text-white">
          Block {item.app} for {item.department}?
        </h2>
        <p id="review-desc" className="mt-2 text-sm leading-relaxed text-slate-300">
          {item.detail}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Proposed {relativeTime(item.created_at)} · domain <span className="font-mono">{item.domain}</span>
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn-ghost" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          <button type="button" className="btn-ghost" onClick={() => void decide("reject")} disabled={busy !== null}>
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button type="button" className="btn-danger" onClick={() => void decide("approve")} disabled={busy !== null}>
            {busy === "approve" ? "Approving…" : "Approve block"}
          </button>
        </div>
      </div>
    </div>
  );
}

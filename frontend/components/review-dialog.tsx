"use client";

import { useEffect, useRef, useState } from "react";

import { decideRemediation } from "@/lib/actions";
import { relativeTime } from "@/lib/format";
import { reviewContext } from "@/lib/review-context";
import type { Dashboard, Remediation } from "@/lib/types";
import { useFocusTrap } from "@/lib/use-focus-trap";

import { BlockIcon } from "./icons";
import { SeverityBadge, VerificationBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { Notice, SubCard } from "./ui/card";

/**
 * The human-in-the-loop step for a proposed block, and the only place one is decided.
 * It shows the exposure, who is affected and what they were told, and nothing
 * happens until an admin explicitly approves or dismisses.
 *
 * A decision is reported only once the server has confirmed it. If the request fails,
 * the dialog stays open with the reason, so nobody walks away believing a tool is blocked.
 */
export function ReviewDialog({
  item,
  data,
  onClose,
  onDecided,
  onToast,
}: {
  item: Remediation;
  data: Pick<Dashboard, "apps" | "remediations">;
  onClose: () => void;
  onDecided: () => void;
  onToast: (props: { title?: string; description?: string; tone?: "success" | "warning" | "danger" | "info"; duration?: number }) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const context = reviewContext(item, data);

  // The dashboard re-renders every few seconds, so read these from a ref and keep focus where it is.
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    // Default focus on the safe choice, never on "Approve".
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && latest.current.busy === null) {
        e.stopPropagation();
        latest.current.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      await decideRemediation(item.id, decision, decision === "approve" ? "Approved from dashboard" : "Rejected from dashboard");
      onDecided();
      onToast({
        title: decision === "approve" ? "Block approved" : "Block dismissed",
        description: `${item.app} for ${item.department}`,
        tone: "success",
        // A security decision's confirmation stays until someone dismisses it.
        duration: 0,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision could not be saved. Nothing has changed.");
      setBusy(null);
    }
  }

  const unverified = context.verification === "unverified";
  const exposure = context.exposure;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto p-4">
      <Button
        variant="bare"
        tabIndex={-1}
        aria-label="Cancel"
        className="fixed inset-0 bg-scrim"
        onClick={() => busy === null && onClose()}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-describedby="review-desc"
        className="relative w-full max-w-lg animate-rise-in rounded-lg border border-control bg-surface p-5"
      >
        <h2 id="review-title" className="flex items-start gap-2 text-md font-semibold text-ink">
          <BlockIcon size={18} className="mt-0.5 shrink-0 text-negative" />
          Block {item.app} for {item.department}?
        </h2>
        <p id="review-desc" className="mt-2 text-sm text-ink2">{item.detail}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-muted">Exposure</dt>
            <dd className="mt-0.5">
              {exposure ? <SeverityBadge severity={exposure.severity} score={exposure.score} /> : <span className="text-muted">Not available</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Users affected</dt>
            <dd className="mt-0.5 text-ink">
              {context.users !== null && context.users !== undefined ? <span className="font-mono">{context.users}</span> : <span className="text-muted">Not available</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Domain</dt>
            <dd className="mt-0.5 font-mono text-ink">{item.domain}</dd>
          </div>
          <div>
            <dt className="text-muted">Privacy policy</dt>
            <dd className="mt-0.5">
              {context.verification ? <VerificationBadge status={context.verification} compact /> : <span className="text-muted">Not available</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Proposed</dt>
            <dd className="mt-0.5 font-mono text-ink">{relativeTime(item.created_at)}</dd>
          </div>
          <div>
            <dt className="text-muted">Approved alternative</dt>
            <dd className="mt-0.5 text-ink">{context.alternative ?? "None listed"}</dd>
          </div>
        </dl>

        {unverified && (
          <SubCard className="mt-4 border border-tone-warning-line bg-tone-warning p-3.5">
            <p className="text-xs text-tone-warning-ink">
              <span className="font-semibold">Score floor active:</span> one or more policy claims failed quote verification, so we
              assume the worst case. The real risk may be higher.
            </p>
          </SubCard>
        )}

        {/* Impact preview: what blocking this tool means for staff. */}
        <SubCard className="mt-4 p-3.5">
          <h3 className="mb-2 text-xs font-semibold text-ink">Impact if blocked</h3>
          <p className="text-xs text-ink2">
            Staff in <span className="font-medium">{item.department}</span> will lose access to{" "}
            <span className="font-medium">{item.app}</span> (<span className="font-mono">{item.domain}</span>).{" "}
            {context.alternative ? (
              <>
                They are pointed to the approved alternative: <span className="font-medium text-ink">{context.alternative}</span>.
              </>
            ) : (
              "No approved alternative is listed, so staff should request one before you approve."
            )}
          </p>
          {context.nudge && (
            <p className="mt-1 text-xs text-muted">
              Staff were told: <span className="text-ink2">{context.nudge}</span>
            </p>
          )}
        </SubCard>

        {error && <Notice className="mt-3">{error}</Notice>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button ref={cancelRef} variant="outline" className="mr-auto" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => void decide("reject")} disabled={busy !== null}>
            {busy === "reject" ? "Dismissing…" : "Dismiss"}
          </Button>
          <Button variant="danger" onClick={() => void decide("approve")} disabled={busy !== null}>
            {busy === "approve" ? "Approving…" : "Approve block"}
          </Button>
        </div>
      </div>
    </div>
  );
}

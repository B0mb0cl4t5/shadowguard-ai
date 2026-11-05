"use client";

import { useMemo, useState } from "react";

import { relativeTime } from "@/lib/format";
import type { PolicyVersion } from "@/lib/types";
import { diffWords } from "@/lib/word-diff";

import { AlertIcon, ChevronIcon } from "./icons";
import { SeverityBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { SubCard } from "./ui/card";

/**
 * "The vendor quietly rewrote its policy": shows the posture before and after,
 * and a word-level diff of the two texts so the change is visible evidence.
 */
export function PolicyChange({ current, previous }: { current: PolicyVersion; previous: PolicyVersion }) {
  const [open, setOpen] = useState(true);
  const parts = useMemo(
    () => diffWords(previous.policy_text, current.policy_text),
    [previous.policy_text, current.policy_text],
  );
  const changes = parts.filter((p) => p.kind !== "same").length;
  const worse = current.posture_score > previous.posture_score;

  return (
    <section
      className={`rounded-md border p-4 ${worse ? "border-transparent bg-tone-warning" : "border-line bg-raised"}`}
    >
      <h3 className={`flex items-center gap-2 text-sm font-semibold ${worse ? "text-warning" : "text-ink"}`}>
        <AlertIcon size={16} /> Policy changed <span className="font-mono">{relativeTime(current.captured_at)}</span>
      </h3>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-ink2">
        <span>Vendor posture</span>
        <SeverityBadge severity={previous.severity} score={previous.posture_score} />
        <span aria-hidden className="text-muted">
          →
        </span>
        <span className="sr-only">changed to</span>
        <SeverityBadge severity={current.severity} score={current.posture_score} />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        <span className="font-mono">{changes}</span> {changes === 1 ? "edit" : "edits"}, previous version captured{" "}
        <span className="font-mono">{relativeTime(previous.captured_at)}</span>
      </p>

      <Button
        variant="bare"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink hover:text-ink"
      >
        <ChevronIcon size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? "Hide what changed" : "Show what changed"}
      </Button>

      {open && (
        <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border border-negative bg-tone-danger" /> Removed wording
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border border-warning bg-tone-warning" /> New wording
            </span>
          </div>
          <SubCard className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-ink2">
            {parts.map((part, i) =>
              part.kind === "same" ? (
                <span key={i}>{part.text}</span>
              ) : part.kind === "removed" ? (
                <del
                  key={i}
                  className="rounded-sm bg-tone-danger px-0.5 text-negative decoration-negative"
                  aria-label={`removed: ${part.text}`}
                >
                  {part.text}
                </del>
              ) : (
                <ins
                  key={i}
                  className="rounded-sm bg-tone-warning px-0.5 font-semibold text-warning no-underline"
                  aria-label={`added: ${part.text}`}
                >
                  {part.text}
                </ins>
              ),
            )}
          </SubCard>
          {(current.truncated || previous.truncated) && (
            <p className="mt-2 text-xs text-muted">
              Long policy: only the first <span className="font-mono">50,000</span> characters are compared.
            </p>
          )}
        </>
      )}
    </section>
  );
}

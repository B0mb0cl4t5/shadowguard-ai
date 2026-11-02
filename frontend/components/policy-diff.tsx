"use client";

import { useMemo, useState } from "react";

import { relativeTime } from "@/lib/format";
import type { PolicyVersion } from "@/lib/types";
import { diffWords } from "@/lib/word-diff";

import { AlertIcon, ChevronIcon } from "./icons";
import { SeverityBadge } from "./ui";

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
      className={`rounded-xl border p-4 ${
        worse ? "border-amber-300/35 bg-amber-400/[0.07]" : "border-sky-300/25 bg-sky-400/[0.05]"
      }`}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
        <AlertIcon size={16} /> Policy changed {relativeTime(current.captured_at)}
      </h3>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span>Vendor posture</span>
        <SeverityBadge severity={previous.severity} score={previous.posture_score} size="sm" />
        <span aria-hidden className="text-slate-500">
          →
        </span>
        <span className="sr-only">changed to</span>
        <SeverityBadge severity={current.severity} score={current.posture_score} size="sm" />
      </div>
      <p className="mt-1.5 text-[0.7rem] text-slate-500">
        {changes} edit{changes === 1 ? "" : "s"} · previous version captured {relativeTime(previous.captured_at)}
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-100/90 hover:text-amber-50"
      >
        <ChevronIcon size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? "Hide what changed" : "Show what changed"}
      </button>

      {open && (
        <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-rose-500/25 ring-1 ring-inset ring-rose-400/40" /> Removed wording
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-amber-400/25 ring-1 ring-inset ring-amber-300/45" /> New wording
            </span>
          </div>
          <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/35 p-3 font-mono text-xs leading-relaxed text-slate-300">
            {parts.map((part, i) =>
              part.kind === "same" ? (
                <span key={i}>{part.text}</span>
              ) : part.kind === "removed" ? (
                <del
                  key={i}
                  className="rounded-sm bg-rose-500/20 px-0.5 text-rose-200/90 decoration-rose-300/70"
                  aria-label={`removed: ${part.text}`}
                >
                  {part.text}
                </del>
              ) : (
                <ins
                  key={i}
                  className="rounded-sm bg-amber-400/20 px-0.5 font-semibold text-amber-100 no-underline"
                  aria-label={`added: ${part.text}`}
                >
                  {part.text}
                </ins>
              ),
            )}
          </p>
          {(current.truncated || previous.truncated) && (
            <p className="mt-2 text-[0.68rem] text-slate-500">Long policy: only the first 50,000 characters are compared.</p>
          )}
        </>
      )}
    </section>
  );
}

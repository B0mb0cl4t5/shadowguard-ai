import type { HTMLAttributes } from "react";

import { SEVERITY_LABEL, TONE_STYLE, SEVERITY_TONE, type Tone } from "@/lib/format";
import type { Severity } from "@/lib/types";

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_STYLE[tone]} ${className}`}
      {...props}
    />
  );
}

export function SeverityBadge({ severity, score }: { severity: Severity; score?: number }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]}>
      {SEVERITY_LABEL[severity]}
      {score !== undefined && <span className="font-mono">{score}</span>}
    </Badge>
  );
}

export function VerificationBadge({ status, compact = false }: { status: "verified" | "unverified"; compact?: boolean }) {
  return status === "verified" ? (
    <Badge tone="success">Quote-verified</Badge>
  ) : (
    <Badge
      tone="warning"
      title="A claim failed quote-matching, statements conflict, or the page tried to instruct the AI. Score floored at High."
    >
      {compact ? "Unverified" : "Unverified, floored at High"}
    </Badge>
  );
}

import type { Severity } from "./types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "moderate", "low"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

/** Tailwind classes per severity. Kept as full literals so Tailwind's scanner sees them. */
export const SEVERITY_STYLE: Record<Severity, { badge: string; dot: string; bar: string; text: string }> = {
  critical: {
    badge: "bg-rose-500/15 text-rose-200 ring-1 ring-inset ring-rose-400/50 shadow-glow-critical",
    dot: "bg-rose-400",
    bar: "bg-rose-500",
    text: "text-rose-300",
  },
  high: {
    badge: "bg-orange-500/15 text-orange-200 ring-1 ring-inset ring-orange-400/45 shadow-glow-high",
    dot: "bg-orange-400",
    bar: "bg-orange-400",
    text: "text-orange-300",
  },
  moderate: {
    badge: "bg-yellow-400/10 text-yellow-100 ring-1 ring-inset ring-yellow-300/40 shadow-glow-moderate",
    dot: "bg-yellow-300",
    bar: "bg-yellow-300",
    text: "text-yellow-200",
  },
  low: {
    badge: "bg-emerald-400/10 text-emerald-200 ring-1 ring-inset ring-emerald-300/40 shadow-glow-low",
    dot: "bg-emerald-400",
    bar: "bg-emerald-400",
    text: "text-emerald-300",
  },
};

export function severityFor(score: number): Severity {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 30) return "moderate";
  return "low";
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !d) return isoDay;
  return `${d} ${months.at(m - 1) ?? ""}`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

import type { Severity } from "./types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "moderate", "low"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

export type Tone = "danger" | "warning" | "info" | "success" | "neutral";

/** Tailwind classes per tone. Kept as full literals so Tailwind's scanner sees them. */
export const TONE_STYLE: Record<Tone, string> = {
  danger: "border border-tone-danger-line bg-tone-danger text-tone-danger-ink",
  warning: "border border-tone-warning-line bg-tone-warning text-tone-warning-ink",
  info: "border border-tone-info-line bg-tone-info text-tone-info-ink",
  success: "border border-tone-success-line bg-tone-success text-tone-success-ink",
  neutral: "border border-tone-neutral-line bg-tone-neutral text-tone-neutral-ink",
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "danger",
  high: "warning",
  moderate: "info",
  low: "success",
};

/**
 * `cell` is the heatmap's fill: one hue, stepped by band, with Low left clear so the eye goes to the risk.
 * `mark` fills a bar or dot in the charts, and `stroke` is the same colour for SVG.
 */
export const SEVERITY_STYLE: Record<Severity, { cell: string; text: string; mark: string; stroke: string }> = {
  critical: { cell: "bg-heat-3 text-ink", text: "text-negative", mark: "bg-sev-critical", stroke: "var(--sev-critical)" },
  high: { cell: "bg-heat-2 text-ink", text: "text-warning", mark: "bg-sev-high", stroke: "var(--sev-high)" },
  moderate: { cell: "bg-heat-1 text-ink", text: "text-tone-info-ink", mark: "bg-sev-moderate", stroke: "var(--sev-moderate)" },
  low: { cell: "text-muted", text: "text-positive", mark: "bg-sev-low", stroke: "var(--sev-low)" },
};

/** Department names short enough for a matrix column; the full name stays in its tooltip. */
export function shortDepartment(name: string): string {
  const short = name.replace(/^Faculty of /, "").split(" & ")[0] ?? name;
  return short === "Examinations" ? "Exams" : short;
}

export function severityFor(score: number): Severity {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 30) return "moderate";
  return "low";
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(now)) return "—";
  const diff = (time - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Seconds count up for the first minute, so a live feed visibly moves. */
/** A short age for a traffic row ("4s ago", "51m ago", "2h ago", "3d ago"), so it fits one narrow column. */
export function secondsAgo(iso: string, now: number): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(now)) return "—";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
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

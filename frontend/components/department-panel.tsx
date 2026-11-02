import { SEVERITY_STYLE, severityFor, titleCase } from "@/lib/format";
import type { DepartmentExposure } from "@/lib/types";

import { GlassCard } from "./ui";

export function DepartmentPanel({ departments }: { departments: DepartmentExposure[] }) {
  return (
    <GlassCard eyebrow="Where the risk sits" title="Exposure by department">
      <ul className="space-y-3.5">
        {departments.map((d) => {
          const sev = severityFor(d.max_score);
          return (
            <li key={d.name}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-slate-200">{d.name}</span>
                <span className={`tabular shrink-0 font-mono text-sm ${d.max_score ? SEVERITY_STYLE[sev].text : "text-slate-500"}`}>
                  {d.max_score}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${d.max_score ? SEVERITY_STYLE[sev].bar : ""} transition-[width] duration-700`}
                  style={{ width: `${Math.max(d.max_score, 0)}%` }}
                />
              </div>
              <p className="mt-1 text-[0.68rem] text-slate-500">
                {titleCase(d.data_class)} · ×{d.sensitivity.toFixed(2)} · {d.shadow_tools} shadow tool
                {d.shadow_tools === 1 ? "" : "s"}
              </p>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

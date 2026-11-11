import type { ReactNode } from "react";

import { SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_STYLE } from "@/lib/format";
import type { Dashboard } from "@/lib/types";

import { AnimatedNumber } from "./animated-number";
import { ExposureGauge, UnitDots } from "./insight-charts";

function Metric({ label, value, sub, visual }: { label: string; value: ReactNode; sub: ReactNode; visual: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-rule px-4 py-4 dense:py-2 [&:nth-child(even)]:border-l [&:nth-child(even)]:pr-0 [&:nth-child(n+3)]:border-t [&:nth-child(odd)]:pl-0 sm:px-5 sm:[&:nth-child(even)]:pr-5 sm:[&:nth-child(odd)]:pl-5 lg:[&:not(:first-child)]:border-l lg:[&:nth-child(n+3)]:border-t-0 lg:first:pl-0 lg:last:pr-0">
      {/* On one screen (dense) the label and figure share a line, so the strip is one line shorter. */}
      <div className="min-w-0 dense:flex dense:flex-wrap dense:items-baseline dense:gap-x-2.5">
        <p className="text-sm text-ink2">{label}</p>
        <p className="mt-1 font-mono text-kpi font-medium leading-none tracking-tight text-ink dense:mt-0 dense:text-lg dense:leading-none">{value}</p>
        <p className="mt-1.5 text-sm text-muted dense:mt-1 dense:w-full dense:truncate">{sub}</p>
      </div>
      {/* On a phone the figures sit two across, so the small pictures give way to them. */}
      <div className="hidden w-20 shrink-0 sm:block">{visual}</div>
    </div>
  );
}

/** The persistent strip: always in view, whichever tab is open. Each number has a small picture of itself. */
export function KpiRow({ data }: { data: Dashboard }) {
  const k = data.kpis;
  const delta = k.exposure_delta_7d;
  const sev = k.exposure_severity;
  const critical = data.apps.filter((a) => a.severity === "critical").length;
  const high = data.apps.filter((a) => a.severity === "high").length;
  return (
    <div className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
      <Metric
        label="Risk exposure index"
        value={<AnimatedNumber value={k.exposure_index} format={(n) => n.toFixed(1)} />}
        visual={<ExposureGauge value={k.exposure_index} />}
        sub={
          <>
            <span className={SEVERITY_STYLE[sev].text}>{SEVERITY_LABEL[sev]}</span>
            {delta !== null && (
              <>
                {", "}
                {/* A rising index is the bad direction. */}
                <span className={`font-mono ${delta > 0 ? "text-negative" : delta < 0 ? "text-positive" : ""}`}>
                  {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                  {Math.abs(delta).toFixed(1)}
                </span>{" "}
                in 7 days
              </>
            )}
          </>
        }
      />
      <Metric
        label="Open risks"
        value={
          <span className={k.active_leak_risks > 0 ? "text-negative" : undefined}>
            <AnimatedNumber value={k.active_leak_risks} />
          </span>
        }
        sub="Open incidents"
        visual={<UnitDots label={`${k.active_leak_risks} open risks`} marks={Array.from({ length: k.active_leak_risks }, () => "bg-sev-critical")} />}
      />
      <Metric
        label="Shadow AI tools"
        value={<AnimatedNumber value={k.shadow_ai_apps} />}
        sub={
          // The dots beside this show severity by colour, so the words carry it too.
          <>
            <span className="font-mono text-negative">{critical}</span> Critical, <span className="font-mono text-warning">{high}</span> High, in{" "}
            <span className="font-mono">{k.departments_affected}</span> departments
          </>
        }
        visual={
          <UnitDots
            label={`${data.apps.length} tools: ${SEVERITY_ORDER.map((s) => `${data.apps.filter((a) => a.severity === s).length} ${SEVERITY_LABEL[s]}`).join(", ")}`}
            marks={[...data.apps].sort((a, b) => b.max_score - a.max_score).map((a) => SEVERITY_STYLE[a.severity].mark)}
          />
        }
      />
      <Metric
        label="Pending reviews"
        value={
          <span className={k.pending_approvals > 0 ? "text-warning" : undefined}>
            <AnimatedNumber value={k.pending_approvals} />
          </span>
        }
        sub={k.pending_approvals > 0 ? "Blocks waiting for an admin" : "Nothing waiting for an admin"}
        visual={<UnitDots label={`${k.pending_approvals} pending reviews`} marks={Array.from({ length: k.pending_approvals }, () => "bg-sev-high")} />}
      />
    </div>
  );
}

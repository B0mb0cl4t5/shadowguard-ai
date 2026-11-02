import type { ReactNode } from "react";

import { SEVERITY_LABEL, SEVERITY_STYLE } from "@/lib/format";
import type { Dashboard } from "@/lib/types";

import { ExposureGauge } from "./charts";
import { BoltIcon, GaugeIcon, LeakIcon, RadarIcon } from "./icons";

function Tile({
  label,
  icon,
  value,
  sub,
  accent,
  children,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`glass relative flex min-h-[9.5rem] flex-col justify-between overflow-hidden p-5 animate-rise-in ${accent ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{label}</p>
        <span className="text-slate-500">{icon}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="tabular font-mono text-[2.4rem] font-semibold leading-none tracking-tight text-white">{value}</div>
          <div className="mt-2 text-xs text-slate-400">{sub}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function KpiRow({ data }: { data: Dashboard }) {
  const k = data.kpis;
  const delta = k.exposure_delta_7d;
  const sev = k.exposure_severity;
  return (
    <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Shadow AI apps detected"
        icon={<RadarIcon />}
        value={k.shadow_ai_apps}
        sub={`Unapproved tools across ${k.departments_affected} departments`}
      />
      <Tile
        label="Active data-leakage risks"
        icon={<LeakIcon />}
        value={<span className={k.active_leak_risks > 0 ? "text-rose-200" : undefined}>{k.active_leak_risks}</span>}
        sub="Open incidents at High or Critical"
        accent={k.active_leak_risks > 0 ? "ring-1 ring-inset ring-rose-400/25" : ""}
      >
        {k.active_leak_risks > 0 && (
          <span className="relative mb-1 flex h-3 w-3" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-rose-400" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500 shadow-glow-critical" />
          </span>
        )}
      </Tile>
      <Tile
        label="Risk exposure index"
        icon={<GaugeIcon />}
        value={k.exposure_index.toFixed(1)}
        sub={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className={SEVERITY_STYLE[sev].text}>{SEVERITY_LABEL[sev]}</span>
            {delta !== null && (
              <span className={delta > 0 ? "text-rose-300" : delta < 0 ? "text-emerald-300" : "text-slate-400"}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta).toFixed(1)} vs 7d ago
              </span>
            )}
          </span>
        }
      >
        <div className="w-[42%] max-w-[9.5rem] shrink-0">
          <ExposureGauge value={k.exposure_index} />
        </div>
      </Tile>
      <Tile
        label="Automated remediation · 24h"
        icon={<BoltIcon />}
        value={k.remediations_24h}
        sub={
          k.pending_approvals > 0 ? (
            <span className="text-amber-200">{k.pending_approvals} block proposal(s) awaiting IT approval</span>
          ) : (
            "Nudges and risk tickets; nothing awaiting approval"
          )
        }
        accent={k.pending_approvals > 0 ? "ring-1 ring-inset ring-amber-300/20" : ""}
      />
    </div>
  );
}

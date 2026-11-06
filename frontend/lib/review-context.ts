import type { Dashboard, Remediation } from "./types";

/** What an admin needs to see before deciding a block: the exposure, the people affected and what they were told. */
export function reviewContext(item: Remediation, data: Pick<Dashboard, "apps" | "remediations">) {
  const app = data.apps.find((a) => a.name === item.app);
  const exposure = app?.departments.find((d) => d.department === item.department);
  const nudge = data.remediations.find(
    (r) => r.action_type === "nudge" && r.status !== "failed" && r.app === item.app && r.department === item.department,
  );
  return {
    exposure,
    users: exposure?.users ?? null,
    verification: app?.verification_status ?? null,
    alternative: app?.alternative ?? null,
    nudge: nudge?.detail ?? null,
  };
}

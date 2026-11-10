/** Client-side calls to this app's own route handlers (which hold the API keys server-side). */

import { TIMEOUT_MS } from "./request-timeout";

export async function decideRemediation(id: number, decision: "approve" | "reject", note: string): Promise<void> {
  const res = await fetch(`/api/remediations/${id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note }),
    signal: AbortSignal.timeout(TIMEOUT_MS.request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
}

export async function simulateTrafficBurst(): Promise<{ accepted: number }> {
  const res = await fetch("/api/simulate", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS.request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Simulation failed (${res.status})`);
  }
  return (await res.json()) as { accepted: number };
}

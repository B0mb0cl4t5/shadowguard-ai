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

/** Queues a block proposal for one tool in one department and returns its id. Deciding it stays in the review dialog. */
export async function proposeBlock(appId: number, department: string, reason: string): Promise<number> {
  const res = await fetch(`/api/apps/${appId}/block-proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ department, reason }),
    signal: AbortSignal.timeout(TIMEOUT_MS.request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  const made = (await res.json().catch(() => ({}))) as { id?: unknown };
  if (typeof made.id !== "number") {
    throw new Error("The server did not confirm the proposal. Check the review queue before sending it again.");
  }
  return made.id;
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

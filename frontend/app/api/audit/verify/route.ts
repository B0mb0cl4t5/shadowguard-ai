import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { overBudget, requireSession } from "@/lib/request-guard";
import type { AuditVerifyResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Verifies the tamper-evident SHA-256 hash chain across `audit_log`.
 * Admin session required; rate-limited before calling the backend.
 */
export async function GET(request: Request) {
  const session = await requireSession(["admin"]);
  if (session instanceof NextResponse) return session;
  const limited = overBudget(request, "read");
  if (limited) return limited;

  try {
    const data = await backendFetch<AuditVerifyResult>("/api/v1/audit/verify", { role: "admin" });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    return NextResponse.json(
      { detail: err instanceof BackendError ? err.message : "Risk engine unavailable" },
      { status: status >= 500 ? 502 : status },
    );
  }
}

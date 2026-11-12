import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { isSameOrigin, overBudget, parseId, requireSession } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

// The same shapes the risk engine accepts (backend `BlockProposalRequest`), checked here first.
const DEPARTMENT = /^[A-Za-z0-9 &()'.,-]{2,80}$/;
const REASON_MIN = 10;
const REASON_MAX = 300;

/**
 * An administrator proposes a block by hand (OWASP A01 + A04). It only queues the proposal:
 * the block itself is still decided in the review dialog, through the decision route.
 * Admin session required, same-origin enforced, body strictly validated before
 * it is forwarded with the admin API key.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site request blocked" }, { status: 403 });
  }
  const session = await requireSession(["admin"]);
  if (session instanceof NextResponse) return session;
  const limited = overBudget(request, "write");
  if (limited) return limited;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ detail: "Invalid tool id" }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return NextResponse.json({ detail: "Request body too large" }, { status: 413 });
  }

  let department: string;
  let reason: string;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body");
    const body = parsed as { department?: unknown; reason?: unknown };
    if (typeof body.department !== "string" || !DEPARTMENT.test(body.department)) throw new Error("department");
    if (typeof body.reason !== "string") throw new Error("reason");
    department = body.department;
    reason = body.reason.trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw new Error("reason");
  } catch {
    return NextResponse.json(
      { detail: `Body must be {department: string, reason: string of ${REASON_MIN} to ${REASON_MAX} characters}` },
      { status: 400 },
    );
  }

  try {
    const data = await backendFetch(`/api/v1/apps/${id}/block-proposals`, {
      role: "admin",
      method: "POST",
      body: { department, reason },
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    return NextResponse.json(
      { detail: err instanceof BackendError ? err.message : "Risk engine unavailable" },
      { status: status >= 500 ? 502 : status },
    );
  }
}

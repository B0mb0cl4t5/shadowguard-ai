import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { isSameOrigin, overBudget, parseId, requireSession } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

/**
 * Human-in-the-loop approval of a proposed block (OWASP A01 + A04).
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
  if (id === null) return NextResponse.json({ detail: "Invalid action id" }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return NextResponse.json({ detail: "Request body too large" }, { status: 413 });
  }

  let decision: "approve" | "reject";
  let note = "";
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body");
    const body = parsed as { decision?: unknown; note?: unknown };
    if (body.decision !== "approve" && body.decision !== "reject") throw new Error("decision");
    decision = body.decision;
    if (body.note !== undefined) {
      if (typeof body.note !== "string" || body.note.length > 500) throw new Error("note");
      note = body.note;
    }
  } catch {
    return NextResponse.json({ detail: "Body must be {decision: 'approve'|'reject', note?: string}" }, { status: 400 });
  }

  try {
    const data = await backendFetch(`/api/v1/remediations/${id}/decision`, {
      role: "admin",
      method: "POST",
      body: { decision, note },
    });
    return NextResponse.json(data);
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    return NextResponse.json(
      { detail: err instanceof BackendError ? err.message : "Risk engine unavailable" },
      { status: status >= 500 ? 502 : status },
    );
  }
}

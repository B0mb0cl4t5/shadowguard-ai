import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { isSameOrigin, overBudget, parseId, requireSession } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

const STAGES = new Set(["execute", "verify"]);

/**
 * Advances an approved block action through firewall execution and block verification.
 * Admin session required, same-origin enforced, strictly validated before forwarding.
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
  if (id === null) return NextResponse.json({ detail: "Invalid remediation id" }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return NextResponse.json({ detail: "Request body too large" }, { status: 413 });
  }

  let stage: "execute" | "verify";
  let note: string;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body");
    const body = parsed as { stage?: unknown; note?: unknown };
    if (typeof body.stage !== "string" || !STAGES.has(body.stage)) throw new Error("stage");
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500)) throw new Error("note");
    stage = body.stage as "execute" | "verify";
    note = (body.note ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  } catch {
    return NextResponse.json(
      { detail: "Body must be {stage: 'execute' | 'verify', note?: string up to 500 chars}" },
      { status: 400 },
    );
  }

  try {
    const data = await backendFetch(`/api/v1/remediations/${id}/advance`, {
      role: "admin",
      method: "POST",
      body: { stage, note },
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

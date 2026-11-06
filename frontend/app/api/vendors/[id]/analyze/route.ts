import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { isSameOrigin, overBudget, parseId, requireSession } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

const MIN_POLICY = 50;
const MAX_POLICY = 200_000;

/**
 * Re-run Stage 2 (policy reading) for a vendor. Admin only.
 *
 * Body (all optional):
 *   { fetch: true }                                  re-fetch the vendor's public policy URL
 *   { policy_text: "...", persist: false }           dry run on pasted text (the live test box)
 *   {}                                               re-analyse the stored policy text
 * The body is validated here and rebuilt field by field before it is forwarded,
 * so nothing unexpected reaches the backend.
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
  if (id === null) return NextResponse.json({ detail: "Invalid vendor id" }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_POLICY * 4) {
    return NextResponse.json({ detail: "Policy text is too long" }, { status: 413 });
  }

  const forward: { fetch?: boolean; policy_text?: string; persist?: boolean } = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_POLICY * 4) {
      return NextResponse.json({ detail: "Policy text is too long" }, { status: 413 });
    }
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("body");
    }
    const body = parsed as { fetch?: unknown; policy_text?: unknown; persist?: unknown };
    if (body.fetch !== undefined && typeof body.fetch !== "boolean") throw new Error("fetch");
    if (body.persist !== undefined && typeof body.persist !== "boolean") throw new Error("persist");
    if (body.fetch === true && body.policy_text !== undefined) throw new Error("both");
    if (body.policy_text !== undefined) {
      if (typeof body.policy_text !== "string") throw new Error("policy_text");
      const text = body.policy_text.trim();
      if (text.length < MIN_POLICY || text.length > MAX_POLICY) {
        return NextResponse.json(
          { detail: `Policy text must be ${MIN_POLICY}–${MAX_POLICY.toLocaleString()} characters` },
          { status: 400 },
        );
      }
      forward.policy_text = text;
    } else if (body.fetch === true) {
      forward.fetch = true;
    }
    if (body.persist === false) forward.persist = false;
  } catch {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  try {
    const data = await backendFetch(`/api/v1/vendors/${id}/analyze`, {
      role: "admin",
      method: "POST",
      body: forward,
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

import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { overBudget, parseId, requireSession } from "@/lib/request-guard";
import type { VendorDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(["viewer", "admin"]);
  if (session instanceof NextResponse) return session;
  const limited = overBudget(request, "read");
  if (limited) return limited;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ detail: "Invalid vendor id" }, { status: 400 });
  try {
    const data = await backendFetch<VendorDetail>(`/api/v1/vendors/${id}`, { role: "viewer" });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    return NextResponse.json(
      { detail: err instanceof BackendError ? err.message : "Risk engine unavailable" },
      { status: status >= 500 ? 502 : status },
    );
  }
}

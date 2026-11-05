import { NextResponse, type NextRequest } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { requireSession } from "@/lib/request-guard";
import type { LiveFeed } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireSession(["viewer", "admin"]);
  if (session instanceof NextResponse) return session;
  const after = request.nextUrl.searchParams.get("after_id") ?? "0";
  if (!/^\d{1,18}$/.test(after)) return NextResponse.json({ detail: "Invalid after_id" }, { status: 400 });
  try {
    // Reads always use the viewer key, even for admins (least privilege).
    const data = await backendFetch<LiveFeed>(`/api/v1/live?after_id=${after}`, { role: "viewer" });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    const detail = err instanceof BackendError ? err.message : "Risk engine unavailable";
    return NextResponse.json({ detail }, { status: status >= 500 ? 502 : status });
  }
}

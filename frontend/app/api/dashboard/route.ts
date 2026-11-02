import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { requireSession } from "@/lib/request-guard";
import type { Dashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession(["viewer", "admin"]);
  if (session instanceof NextResponse) return session;
  try {
    // Reads always use the viewer key, even for admins (least privilege).
    const data = await backendFetch<Dashboard>("/api/v1/dashboard", { role: "viewer" });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 502;
    const detail = err instanceof BackendError ? err.message : "Risk engine unavailable";
    return NextResponse.json({ detail }, { status: status >= 500 ? 502 : status });
  }
}

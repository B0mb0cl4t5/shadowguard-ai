import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { BackendError, backendFetch } from "@/lib/backend";
import { isSameOrigin, overBudget, requireSession } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

const BURST_TEMPLATES = [
  {
    domain: "gradesync.app",
    department: "Examinations & Assessment",
    dest_ip: "203.0.113.196",
    minUp: 180_000,
    maxUp: 620_000,
  },
  {
    domain: "paperpilot.ai",
    department: "Research & Postgraduate Office",
    dest_ip: "203.0.113.126",
    minUp: 240_000,
    maxUp: 880_000,
  },
  {
    domain: "summarix.ai",
    department: "Student Affairs",
    dest_ip: "203.0.113.211",
    minUp: 95_000,
    maxUp: 340_000,
  },
  {
    domain: "transcribefly.com",
    department: "Human Resources",
    dest_ip: "203.0.113.44",
    minUp: 410_000,
    maxUp: 1_250_000,
  },
  {
    domain: "promptpal.io",
    department: "Faculty of Engineering",
    dest_ip: "203.0.113.88",
    minUp: 42_000,
    maxUp: 190_000,
  },
] as const;

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Triggers a realistic burst of 5 campus metadata telemetry events through the
 * real /api/v1/telemetry ingest pipeline so admins and judges can test live
 * detection, risk scoring, and real-time map arcs directly from the browser.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site request blocked" }, { status: 403 });
  }
  const session = await requireSession(["admin"]);
  if (session instanceof NextResponse) return session;
  const limited = overBudget(request, "write");
  if (limited) return limited;

  const nowMs = Date.now();
  const events = BURST_TEMPLATES.map((tpl, idx) => {
    const bytesUp = randomInt(tpl.minUp, tpl.maxUp);
    const bytesDown = Math.round(bytesUp * (0.28 + Math.random() * 0.45));
    return {
      domain: tpl.domain,
      user_hash: randomBytes(32).toString("hex"),
      department: tpl.department,
      bytes_up: bytesUp,
      bytes_down: bytesDown,
      dest_ip: tpl.dest_ip,
      observed_at: new Date(nowMs - idx * 800).toISOString(),
    };
  });

  try {
    const data = await backendFetch<{ accepted: number }>("/api/v1/telemetry", {
      role: "admin",
      method: "POST",
      body: { events },
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

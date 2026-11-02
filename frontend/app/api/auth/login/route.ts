import { NextResponse } from "next/server";

import { verifyPassword } from "@/lib/password";
import { allow } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request-guard";
import { createSessionToken, SESSION_TTL_SECONDS, sessionCookieName } from "@/lib/session";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Sign-in with an access code. OWASP A07:
 *   - 5 attempts per minute and 30 per hour per client IP.
 *   - Both role hashes are always checked, so timing does not reveal which
 *     role a near-miss belonged to.
 *   - The same generic error for every failure.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site request blocked" }, { status: 403 });
  }
  const ip = clientIp(request);
  if (!allow(`login:m:${ip}`, 5, 60_000) || !allow(`login:h:${ip}`, 30, 3_600_000)) {
    return NextResponse.json({ detail: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    // Generated codes have no surrounding spaces; a copied one can pick some up.
    if (typeof body.code === "string") code = body.code.trim();
  } catch {
    /* fall through to the generic failure */
  }
  if (code.length < 8 || code.length > 128) {
    console.warn(`[auth] failed sign-in from ${ip}`);
    return NextResponse.json({ detail: "Invalid access code" }, { status: 401 });
  }

  const [isAdmin, isViewer] = await Promise.all([
    verifyPassword(code, process.env.DASHBOARD_ADMIN_CODE_HASH),
    verifyPassword(code, process.env.DASHBOARD_VIEWER_CODE_HASH),
  ]);
  const role: Role | null = isAdmin ? "admin" : isViewer ? "viewer" : null;
  if (!role) {
    console.warn(`[auth] failed sign-in from ${ip}`);
    return NextResponse.json({ detail: "Invalid access code" }, { status: 401 });
  }

  const token = await createSessionToken(role);
  if (!token) {
    console.error("[auth] SESSION_SECRET missing or shorter than 32 characters");
    return NextResponse.json({ detail: "Sign-in is not configured" }, { status: 503 });
  }

  const res = NextResponse.json({ role });
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

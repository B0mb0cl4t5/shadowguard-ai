import { NextResponse } from "next/server";

import { demoRole } from "@/lib/demo-mode";
import { allow } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request-guard";
import { createSessionToken, SESSION_TTL_SECONDS, sessionCookieName } from "@/lib/session";

export const runtime = "nodejs";

/**
 * One-click sign-in for recording a demo, only while DEMO_SIGN_IN is set.
 * Otherwise this route does not exist (404), so it can't be found by probing.
 */
export async function POST(request: Request) {
  const role = demoRole();
  if (!role) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site request blocked" }, { status: 403 });
  }
  const ip = clientIp(request);
  if (!allow(`demo:m:${ip}`, 10, 60_000)) {
    return NextResponse.json({ detail: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const token = await createSessionToken(role);
  if (!token) {
    console.error("[auth] SESSION_SECRET missing or shorter than 32 characters");
    return NextResponse.json({ detail: "Sign-in is not configured" }, { status: 503 });
  }

  console.warn(`[auth] demo sign-in as ${role} from ${ip}`);
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

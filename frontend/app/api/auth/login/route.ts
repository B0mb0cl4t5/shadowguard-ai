import { NextResponse } from "next/server";

import { sharedRateLimit } from "@/lib/backend";
import { roleForCredentials } from "@/lib/password";
import { allowShared } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request-guard";
import { createSessionToken, SESSION_TTL_SECONDS, sessionCookieName } from "@/lib/session";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Sign-in with a username and password. OWASP A07:
 *   - 5 attempts per minute and 30 per hour per client IP, counted once across every
 *     serverless instance (lib/rate-limit.ts `allowShared`).
 *   - Both role hashes are always checked, so timing does not reveal which
 *     role a near-miss belonged to or whether the username exists.
 *   - The same generic error for every failure.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: "Cross-site request blocked" }, { status: 403 });
  }
  const ip = clientIp(request);
  const allowed = await allowShared(
    [
      { key: `login:m:${ip}`, limit: 5, windowMs: 60_000 },
      { key: `login:h:${ip}`, limit: 30, windowMs: 3_600_000 },
    ],
    sharedRateLimit,
  );
  if (!allowed) {
    return NextResponse.json({ detail: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let username = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === "string") username = body.username;
    // hash-password trims what it hashes, and a copied password can pick up spaces.
    if (typeof body.password === "string") password = body.password.trim();
  } catch {
    /* fall through to the generic failure */
  }
  if (!username || username.length > 64 || password.length < 8 || password.length > 128) {
    console.warn(`[auth] failed sign-in from ${ip}`);
    return NextResponse.json({ detail: "Invalid username or password" }, { status: 401 });
  }

  const role: Role | null = await roleForCredentials(username, password);
  if (!role) {
    console.warn(`[auth] failed sign-in from ${ip}`);
    return NextResponse.json({ detail: "Invalid username or password" }, { status: 401 });
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

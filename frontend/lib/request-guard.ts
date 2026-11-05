import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { clientIpFrom } from "./client-ip";
import { allow } from "./rate-limit";
import { sessionCookieName, verifySessionToken, type Session } from "./session";
import type { Role } from "./types";

/**
 * Defence in depth (OWASP A01): middleware already blocks unauthenticated
 * requests, but every route handler re-checks the session and role itself, so
 * a middleware bypass (e.g. CVE-2025-29927 in older Next.js) does not expose data.
 */
export async function requireSession(roles: Role[]): Promise<Session | NextResponse> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const session = await verifySessionToken(token);
  if (!session) return NextResponse.json({ detail: "Not signed in" }, { status: 401 });
  if (!roles.includes(session.role)) {
    return NextResponse.json({ detail: "Your role cannot perform this action" }, { status: 403 });
  }
  return session;
}

/**
 * CSRF protection for state-changing requests: the session cookie is
 * SameSite=Strict, and we additionally require the Origin header to match
 * this site's host.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Trusts X-Forwarded-For only behind a known proxy (see lib/client-ip.ts). */
export function clientIp(request: Request): string {
  return clientIpFrom(request.headers);
}

/** Requests a minute each client may make: one open dashboard tab uses about 20 reads. */
const BUDGET = { read: 240, write: 20 } as const;

/**
 * Every signed-in user reaches the risk engine with the dashboard's one key, so a runaway tab
 * or script could use up its allowance and leave everyone on "Reconnecting". Each client is
 * capped here first. Returns the response to send when over budget, or null to carry on.
 */
export function overBudget(request: Request, kind: keyof typeof BUDGET): NextResponse | null {
  if (allow(`data:${kind}:${clientIp(request)}`, BUDGET[kind], 60_000)) return null;
  return NextResponse.json({ detail: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": "30" } });
}

/** Parse a numeric path id strictly: digits only, positive, 32-bit. */
export function parseId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

export function clientIp(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim().slice(0, 64);
}

/** Parse a numeric path id strictly: digits only, positive, 32-bit. */
export function parseId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

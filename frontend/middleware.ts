import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieName, verifySessionToken } from "./lib/session";

/**
 * 1. Per-request Content-Security-Policy with a fresh nonce (OWASP A03 / A05):
 *    only scripts carrying this request's nonce may run, which blocks injected
 *    <script> tags even if an XSS bug slipped into a component.
 * 2. Authentication gate (OWASP A01): every page and API route except the login
 *    flow requires a valid signed session. Route handlers re-verify too.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React style={} attributes need inline styles; no user input reaches them.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function safeNext(pathname: string, search: string): string {
  const target = pathname + search;
  // Only same-site relative paths, never "//evil.com" (open-redirect guard).
  return target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const { pathname, search } = request.nextUrl;

  const session = await verifySessionToken(request.cookies.get(sessionCookieName())?.value);

  if (!PUBLIC_PATHS.has(pathname) && !session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ detail: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(safeNext(pathname, search))}`;
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && session) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (pathname.startsWith("/api/")) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  // Everything except static assets and the public PWA files is gated.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt).*)"],
};

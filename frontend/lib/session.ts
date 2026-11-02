/**
 * Stateless signed session tokens (HMAC-SHA256 via Web Crypto).
 *
 * Runs in both the Edge runtime (middleware) and Node (route handlers), so it
 * only uses `globalThis.crypto.subtle`.
 *
 * OWASP A02 Cryptographic Failures:
 *   - HMAC-SHA256 with a server-only secret of at least 32 characters.
 *   - Signatures are verified with crypto.subtle.verify (constant-time).
 * OWASP A07 Identification & Authentication Failures:
 *   - Tokens expire after 8 hours; expiry and role are inside the signed payload,
 *     so neither can be extended or escalated client-side.
 *   - The cookie is HttpOnly (no JS access), Secure, SameSite=Strict and uses the
 *     __Host- prefix in production (bound to this exact origin, path=/).
 */

import type { Role } from "./types";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-sg_session" : "sg_session";
}

export interface Session {
  role: Role;
  iat: number;
  exp: number;
  sid: string;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) return null; // fail closed: no secret, no sessions
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(role: Role): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const sid = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload: Session = { role, iat: now, exp: now + SESSION_TTL_SECONDS, sid };
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const key = await hmacKey();
  if (!key) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(parts[1]) as Uint8Array<ArrayBuffer>,
      encoder.encode(parts[0]),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))) as Partial<Session>;
    if (payload.role !== "viewer" && payload.role !== "admin") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload as Session;
  } catch {
    return null;
  }
}

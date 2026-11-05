/**
 * The client's address, for rate limiting only.
 *
 * `X-Forwarded-For` is only trustworthy where a proxy in front of the app sets it and throws
 * away whatever the client sent. Vercel does, and sets `VERCEL=1` on every deployment;
 * `TRUST_PROXY=true` says another such proxy is in front (the backend reads the same setting).
 * Anywhere else the header could be forged to dodge the limits, so every client shares one
 * bucket instead: stricter, never looser.
 */
export const UNTRUSTED = "untrusted-proxy";

export function clientIpFrom(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const trusted = env.VERCEL === "1" || env.TRUST_PROXY?.trim().toLowerCase() === "true";
  if (!trusted) return UNTRUSTED;
  return (headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim().slice(0, 64) || "unknown";
}

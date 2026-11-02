/**
 * Sliding-window rate limiter for the login route (OWASP A07: brute force).
 *
 * Serverless caveat: memory is per warm instance, so this is a per-instance limit.
 * For a hard global limit put Upstash Redis / Vercel KV behind the same interface.
 */

const buckets = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    // Bound memory under a spray of spoofed client keys.
    for (const k of Array.from(buckets.keys()).slice(0, 2500)) buckets.delete(k);
  }
  return true;
}

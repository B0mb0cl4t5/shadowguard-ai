/**
 * Sliding-window rate limits for sign-in (OWASP A07: brute force).
 *
 * `allow` counts in this instance's memory. `allowShared` adds one count for every
 * instance, kept in the risk engine's database, so a client spreading password guesses
 * across serverless instances still meets one limit.
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

export type LimitCheck = { key: string; limit: number; windowMs: number };
export type SharedCheck = { bucket: string; limit: number; windowSeconds: number };

async function digest(key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const tooManyRequests = (err: unknown) => typeof err === "object" && err !== null && (err as { status?: unknown }).status === 429;

/**
 * Every check must pass here first, which keeps floods off the database, then once more
 * in the shared count that `send` asks for. Bucket names are hashed before they leave,
 * so no client IP is stored. If the shared count can't be reached, this instance's limit
 * still applies; if the risk engine answers "too many requests", that only happens under
 * a flood, so the attempt is refused.
 */
export async function allowShared(checks: LimitCheck[], send: (checks: SharedCheck[]) => Promise<boolean>): Promise<boolean> {
  for (const c of checks) if (!allow(c.key, c.limit, c.windowMs)) return false;
  const shared = await Promise.all(
    checks.map(async (c) => ({ bucket: await digest(c.key), limit: c.limit, windowSeconds: Math.ceil(c.windowMs / 1000) })),
  );
  try {
    return await send(shared);
  } catch (err) {
    if (tooManyRequests(err)) return false;
    console.warn("[rate-limit] shared limit unreachable; this instance's limit still applies");
    return true;
  }
}

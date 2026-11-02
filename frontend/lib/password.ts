/**
 * Access-code verification with PBKDF2-SHA256 (Web Crypto).
 *
 * OWASP A02 / A07: codes are never stored in plain text. The environment holds
 * `pbkdf2_sha256:<iterations>:<salt b64>:<hash b64>`, generated with
 * `npm run hash-password`. Colons, not `$`, separate the parts because Next.js
 * expands `$NAME` sequences inside .env files. Comparison is constant-time.
 */

const MIN_ITERATIONS = 100_000;

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyPassword(candidate: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > 5_000_000) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromB64(parts[2] ?? "");
    expected = fromB64(parts[3] ?? "");
  } catch {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(candidate),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    expected.length * 8,
  );
  return constantTimeEqual(new Uint8Array(bits), expected);
}

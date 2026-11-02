import "server-only";

/**
 * Server-only client for the ShadowGuard Python API.
 *
 * OWASP A02/A05: the backend API keys live ONLY in server environment
 * variables (no NEXT_PUBLIC_ prefix) and this module is marked `server-only`,
 * so the build fails if it is ever imported into client code. The browser never
 * sees a key; it talks to this app's own route handlers, which forward with the
 * least-privileged key for the job (viewer key for reads, admin key only for
 * admin actions).
 */

export type KeyRole = "viewer" | "admin";

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function baseUrl(): string {
  // On Vercel this is the service binding from vercel.json; locally it comes from
  // .env.local. Bindings resolve at runtime in functions only, so this must never
  // run at build time or in middleware.
  const raw = (process.env.SHADOWGUARD_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new BackendError(503, "SHADOWGUARD_API_URL is not configured");
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    // Never send an API key over plaintext HTTP to a remote host.
    throw new BackendError(503, "SHADOWGUARD_API_URL must use https");
  }
  return raw;
}

function apiKey(role: KeyRole): string {
  const key = role === "admin" ? process.env.SHADOWGUARD_ADMIN_API_KEY : process.env.SHADOWGUARD_VIEWER_API_KEY;
  if (!key) throw new BackendError(503, `Backend ${role} key is not configured`);
  return key;
}

export async function backendFetch<T>(
  path: `/api/${string}`,
  init: { role: KeyRole; method?: "GET" | "POST"; body?: unknown } = { role: "viewer" },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "X-API-Key": apiKey(init.role),
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err instanceof BackendError) throw err;
    throw new BackendError(502, "The risk engine is unreachable");
  }
  if (!res.ok) {
    let detail = `Risk engine returned HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail.slice(0, 200);
    } catch {
      /* non-JSON error body: keep the generic message */
    }
    throw new BackendError(res.status, detail);
  }
  return (await res.json()) as T;
}

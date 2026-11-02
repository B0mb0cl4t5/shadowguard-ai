const PROBE_ORIGIN = "https://shadowguard.invalid";

/**
 * Open-redirect guard for the sign-in `next` parameter (OWASP A01). The value is
 * resolved with the same URL rules the browser will use, because browsers treat
 * "\" as "/" and strip tabs and newlines: "/\evil.example" leaves the site even
 * though it does not start with "//". Anything that does not stay on this origin
 * falls back to the dashboard.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  try {
    const url = new URL(next, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return "/";
    const path = url.pathname + url.search + url.hash;
    // "/.//evil.example" normalises to a pathname that itself starts with "//".
    return path.startsWith("//") ? "/" : path;
  } catch {
    return "/";
  }
}

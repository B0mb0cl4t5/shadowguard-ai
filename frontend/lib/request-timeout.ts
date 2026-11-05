/**
 * How long the browser waits for this app's own routes before giving up. Without a limit a
 * hung request never settles, and the dashboard's "busy" flags would stop every later poll.
 */
export const TIMEOUT_MS = {
  /** The live feed and dashboard polls: the next one is only seconds away. */
  poll: 10_000,
  /** Reads, sign-in and decisions. */
  request: 15_000,
  /** Reading a policy can mean downloading the vendor's page first; the server gives up at 20 s. */
  analyse: 30_000,
} as const;

/** The message to show for a failed request, saying plainly when it was stopped for taking too long. */
export function failureMessage(err: unknown, fallback: string): string {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "That took too long, so it was stopped. Try again.";
  }
  return err instanceof Error ? err.message : fallback;
}

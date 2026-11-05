import type { Role } from "./types";

/**
 * One-click sign-in for recording a demo. Off unless DEMO_SIGN_IN is set to
 * "admin" or "viewer", because while it is on anyone with the link can sign in
 * with that role. Anything else, including a typo, leaves it off.
 */
export function demoRole(value: string | undefined = process.env.DEMO_SIGN_IN): Role | null {
  const role = value?.trim().toLowerCase();
  return role === "admin" || role === "viewer" ? role : null;
}

"use client";

import { useState } from "react";

import type { Role } from "@/lib/types";

import { Button } from "./ui/button";
import { Notice } from "./ui/card";

/** The demo button: signs straight in with the role DEMO_SIGN_IN allows. */
export function DemoSignIn({ role, next }: { role: Role; next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? "Demo sign-in failed");
      }
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="primary" className="w-full" onClick={() => void enter()} disabled={busy}>
        {busy ? "Opening…" : "Open the demo"}
      </Button>
      <p className="mt-2 text-xs text-muted">No password needed. You'll be signed in as {role === "admin" ? "an admin" : "a viewer"}.</p>
      {error && <Notice className="mt-3">{error}</Notice>}
    </div>
  );
}

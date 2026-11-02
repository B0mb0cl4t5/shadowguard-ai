"use client";

import { useState, type FormEvent } from "react";

export function LoginForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? "Sign-in failed");
      }
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="code" className="eyebrow mb-2 block">
          Access code
        </label>
        <input
          id="code"
          name="code"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={128}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[16px] text-white placeholder-slate-500 transition-colors focus:border-signal/60 sm:text-sm"
          placeholder="••••••••••••"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      <button type="submit" className="btn-signal h-11 w-full" disabled={busy || code.length < 8}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

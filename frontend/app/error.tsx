"use client";

import { useEffect } from "react";

import { ShieldMark } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Shown instead of a blank page when something outside a panel fails to draw. Panels have
 * their own boundary (components/ui/panel-boundary.tsx), so this is the last line.
 */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[screen] could not be drawn", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4">
      <div className="flex items-center gap-2.5">
        <ShieldMark size={22} className="text-accent" />
        <span className="text-base font-semibold text-ink">ShadowGuard</span>
      </div>
      <h1 className="mt-6 text-lg font-semibold text-ink">This screen hit a problem</h1>
      <p className="mt-2 text-base text-ink2">
        Nothing was changed. Try drawing it again; if that doesn&apos;t work, reload the page.
        {error.digest && (
          <>
            {" "}
            Reference <span className="font-mono">{error.digest}</span>.
          </>
        )}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    </main>
  );
}

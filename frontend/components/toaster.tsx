"use client";

import type { Toast as ToastData } from "@/lib/use-toast";

import { Toast } from "./ui/toast";

type ToasterProps = {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
};

/**
 * A toast container anchored at top-right. It stays mounted while empty, because
 * screen readers only announce what is added to a live region they already know about.
 */
export function Toaster({ toasts, onDismiss, onPause, onResume }: ToasterProps) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-5 top-5 z-[100] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2 print:hidden"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto"
          onPointerEnter={() => onPause(t.id)}
          onPointerLeave={() => onResume(t.id)}
          onFocus={() => onPause(t.id)}
          onBlur={() => onResume(t.id)}
        >
          <Toast toast={t} onDismiss={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

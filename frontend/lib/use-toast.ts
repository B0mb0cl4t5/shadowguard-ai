"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Toast = {
  id: string;
  title?: string;
  description?: string;
  tone?: "success" | "warning" | "danger" | "info";
  /** Milliseconds on screen. 0 keeps it until someone dismisses it. */
  duration?: number;
  /** Set while it fades out, just before it is removed. */
  leaving?: boolean;
};

const EXIT_MS = 120;

/** A lightweight, dependency-free toast system that respects the design contract.
 * Toasts are feedback, not decoration: they appear only after a user action or
 * a meaningful data change, and they never animate on page load. A toast's countdown
 * stops while the pointer or keyboard focus is on it, so it can't vanish mid-read. */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1000);
  const timers = useRef(new Map<string, { timer?: ReturnType<typeof setTimeout>; remaining: number; started: number }>());

  const dismiss = useCallback((id: string) => {
    const entry = timers.current.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    timers.current.delete(id);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const start = useCallback(
    (id: string, ms: number) => {
      timers.current.set(id, { remaining: ms, started: Date.now(), timer: setTimeout(() => dismiss(id), ms) });
    },
    [dismiss],
  );

  const toast = useCallback(
    (props: Omit<Toast, "id" | "leaving">) => {
      const id = String((nextId.current += 1));
      setToasts((prev) => [...prev, { ...props, id }]);
      if (props.duration !== 0) start(id, props.duration ?? 5_000);
      return id;
    },
    [start],
  );

  const pause = useCallback((id: string) => {
    const entry = timers.current.get(id);
    if (!entry?.timer) return;
    clearTimeout(entry.timer);
    timers.current.set(id, { remaining: Math.max(1_000, entry.remaining - (Date.now() - entry.started)), started: Date.now() });
  }, []);

  const resume = useCallback(
    (id: string) => {
      const entry = timers.current.get(id);
      if (entry && !entry.timer) start(id, entry.remaining);
    },
    [start],
  );

  useEffect(() => {
    const running = timers.current;
    return () => running.forEach((entry) => entry.timer && clearTimeout(entry.timer));
  }, []);

  return { toasts, toast, dismiss, pause, resume };
}

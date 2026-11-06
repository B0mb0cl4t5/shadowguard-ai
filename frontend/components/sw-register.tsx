"use client";

import { useEffect } from "react";

import { applyTheme, loadTheme } from "@/lib/use-theme";

/** Applies the saved theme and registers the PWA service worker in production builds. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    applyTheme(loadTheme(), false);
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* offline support is a nice-to-have; never break the app over it */
    });
  }, []);
  return null;
}

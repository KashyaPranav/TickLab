"use client";

import { useEffect } from "react";

/**
 * Registers the offline worker once the page has loaded.
 *
 * Deferred so registration never competes with the first render for bandwidth,
 * and skipped in development where a cached shell would hide code changes.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is an enhancement; the app still works without it.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}

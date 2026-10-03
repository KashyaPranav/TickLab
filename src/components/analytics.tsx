"use client";

import { useSyncExternalStore } from "react";
import {
  getServerConsent,
  readConsent,
  subscribeConsent,
  writeConsent,
  type ConsentState,
} from "@/lib/consent";

function useConsent(): ConsentState | null {
  return useSyncExternalStore(subscribeConsent, readConsent, getServerConsent);
}

/**
 * Plausible is loaded only after the visitor opts in.
 *
 * Analytics must never be a condition for the app working, so nothing here can
 * block render or throw: with no consent this returns null and no third-party
 * script is fetched at all.
 */
export function Analytics() {
  const consent = useConsent();

  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (consent !== "granted" || !domain) return null;

  return (
    <script
      defer
      data-domain={domain}
      src={process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ?? "https://plausible.io/js/script.js"}
    />
  );
}

/** Banner shown until a choice is made. Hidden when analytics is not configured. */
export function ConsentBanner() {
  const consent = useConsent();

  if (!process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN) return null;
  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Analytics"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          TickLab works fully offline and needs no analytics. With your
          permission we would record anonymous page views to see which features
          get used.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => writeConsent("denied")}
            className="h-10 rounded-lg border px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={() => writeConsent("granted")}
            className="h-10 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
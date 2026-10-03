"use client";

/**
 * Analytics consent, modelled as a small external store.
 *
 * The value lives in localStorage and has to be read after hydration, so it is
 * exposed through `useSyncExternalStore`: the server snapshot is always `null`
 * (nothing rendered), and React swaps in the real value once the client takes
 * over. That avoids rendering the banner during SSR and keeps the storage layer
 * in one place.
 */

const CONSENT_KEY = "ticklab.analytics-consent";

export type ConsentState = "granted" | "denied";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  // A second tab writing the choice should update this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readConsent(): ConsentState | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    // Private browsing can throw on access; treat that as no answer.
    return null;
  }
}

/** Server and hydration snapshot: no answer yet. */
export function getServerConsent(): null {
  return null;
}

export function writeConsent(state: ConsentState): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, state);
  } catch {
    // Persistence is best-effort; the session still honours the choice.
  }
  notify();
}
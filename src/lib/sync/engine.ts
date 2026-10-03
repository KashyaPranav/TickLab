"use client";

import { getDb } from "@/lib/db/db";
import { outboxSummary, pendingCount, retryFailed, type OutboxSummary } from "./queue";
import { pull } from "./pull";
import { push } from "./push";
import type { SyncStatus } from "@/lib/db/db";

export type { SyncStatus };

export interface SyncOutcome {
  ok: boolean;
  pushed: number;
  pulled: number;
  error: string | null;
  at: number;
}

/** How long to wait after a local change before flushing the outbox. */
export const DEBOUNCE_MS = 1_500;

const listeners = new Set<(status: SyncStatus, summary: OutboxSummary) => void>();
let inFlight: Promise<SyncOutcome> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let last: SyncOutcome | null = null;

function emit(status: SyncStatus): void {
  void outboxSummary().then((summary) => {
    for (const listener of listeners) listener(status, summary);
  });
}

export function subscribeSync(
  listener: (status: SyncStatus, summary: OutboxSummary) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lastSyncOutcome(): SyncOutcome | null {
  return last;
}

/**
 * Push then pull.
 *
 * Concurrent calls share one promise: a burst of taps should produce one sync,
 * not five. Push first so the server sees the newest local writes and can echo
 * back anything this device missed while offline.
 */
export async function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const outcome: SyncOutcome = {
      ok: false,
      pushed: 0,
      pulled: 0,
      error: "offline",
      at: Date.now(),
    };
    last = outcome;
    emit("offline");
    return outcome;
  }

  emit("syncing");

  inFlight = (async (): Promise<SyncOutcome> => {
    try {
      const pushed = await push();
      const pulled = await pull();
      const outcome: SyncOutcome = {
        ok: pushed.failed === 0,
        pushed: pushed.sent,
        pulled: pulled.pulled,
        error: pushed.failed > 0 ? `${pushed.failed} row(s) failed to sync` : null,
        at: Date.now(),
      };
      last = outcome;
      emit(outcome.ok ? "idle" : "error");
      return outcome;
    } catch (error) {
      const outcome: SyncOutcome = {
        ok: false,
        pushed: 0,
        pulled: 0,
        error: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      last = outcome;
      emit("error");
      return outcome;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Coalesces bursts of local writes into a single sync. */
export function scheduleSync(delay = DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow();
  }, delay);
}

let wired = false;

/** One-time wiring: app open, reconnect, and tab focus. */
export function startSyncEngine(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;

  void syncNow();

  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => emit("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });

  // A safety net for edits made while the tab was hidden without the debounce
  // having fired.
  window.setInterval(() => {
    if (!navigator.onLine || !getDb()) return;
    void pendingCount().then((count) => {
      if (count > 0) void syncNow();
    });
  }, 60_000);
}

/** Test seam. */
export function __resetSyncEngine(): void {
  wired = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  inFlight = null;
  last = null;
  listeners.clear();
}

export { retryFailed, pendingCount, outboxSummary };
export type { OutboxSummary };
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Entry, Habit } from "@/lib/db/db";
import { subscribeLocalChanges } from "@/lib/db/change-notifier";
import { listEntries, listHabits } from "@/lib/db/queries";
import { subscribeSync } from "@/lib/sync/engine";
import type { SyncStatus } from "@/lib/sync/engine";

export interface LocalSnapshot {
  habits: Habit[];
  entries: Entry[];
  loading: boolean;
}

/**
 * Reads habits and entries out of IndexedDB and re-reads them whenever anything
 * writes locally or a sync lands remote rows.
 *
 * Two triggers are needed, and neither covers the other alone: a local write has
 * to show up immediately (which matters most offline, where no sync ever
 * succeeds), while remote rows can only arrive through the engine.
 */
export function useLocalSnapshot(from?: string, to?: string): LocalSnapshot {
  const [snapshot, setSnapshot] = useState<LocalSnapshot>({
    habits: [],
    entries: [],
    loading: true,
  });

  const reload = useCallback(async () => {
    const [habits, entries] = await Promise.all([
      listHabits(),
      listEntries(from, to),
    ]);
    setSnapshot({ habits, entries, loading: false });
  }, [from, to]);

  useEffect(() => {
    // This is a genuine external read, not derived state: IndexedDB does not
    // exist during SSR, so the data can only be fetched on the client after
    // mount. There is no render-time value to derive it from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  useEffect(() => {
    const unsubscribeLocal = subscribeLocalChanges(() => {
      void reload();
    });
    const unsubscribeSync = subscribeSync((status: SyncStatus) => {
      if (status === "idle") void reload();
    });
    return () => {
      unsubscribeLocal();
      unsubscribeSync();
    };
  }, [reload]);

  return snapshot;
}

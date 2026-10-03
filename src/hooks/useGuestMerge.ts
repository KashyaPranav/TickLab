"use client";

import { useEffect, useRef } from "react";
import { onAuthChange } from "@/lib/supabase/auth";
import { adoptGuestData, needsGuestMerge } from "@/lib/db/queries";
import { startSyncEngine } from "@/lib/sync/engine";

/**
 * Adopts guest rows the moment a session appears.
 *
 * Runs on every auth change rather than only on the callback return, because a
 * user can also arrive already signed in (a restored cookie, a magic link opened
 * in another tab). The `handled` ref makes it once-per-user-per-mount: without
 * it, every tab-focus auth event would re-run the transaction.
 *
 * `getClaims`/auth changes also fire while offline from a restored cookie, which
 * is exactly when the merge must not depend on the network — it only touches
 * IndexedDB.
 */
export function useGuestMerge(): void {
  const handled = useRef<string | null>(null);

  useEffect(() => {
    async function merge(userId: string | null) {
      if (!userId) return;
      if (!(await needsGuestMerge())) return;
      // Set only after the rows are gone, so a second auth event for the same
      // user cannot start a competing transaction.
      if (handled.current === userId) return;
      handled.current = userId;
      const adopted = await adoptGuestData(userId);
      // Only now is there something worth pushing.
      if (adopted > 0) startSyncEngine();
    }

    return onAuthChange((event, userId) => {
      if (event === "SIGNED_OUT") {
        // Reset so guest rows created while signed out are adopted on the next
        // sign-in rather than being treated as already merged.
        handled.current = null;
        return;
      }
      void merge(userId);
    });
  }, []);
}
import { getDb, type Day, type Entry, type Habit } from "@/lib/db/db";
import { getMeta, setMeta } from "@/lib/db/queries";
import { supabase } from "@/lib/supabase/client";
import { localWins } from "./conflict";
import type { SyncTableName } from "@/lib/supabase/types";

export const LAST_PULLED_KEY = "sync.last_pulled";

/**
 * Lookback used to rewind the cursor, so rows sharing a timestamp with the
 * cursor (or written while a request was in flight) are still seen.
 */
const CURSOR_OVERLAP_MS = 60 * 1000;

/**
 * Rows fetched per table per pull. If a page comes back full we assume there is
 * more and refuse to advance the cursor past it; the next sync re-reads the same
 * window. Silently advancing would skip the rows that did not fit.
 */
const PAGE_LIMIT = 5000;

export interface PullResult {
  pulled: number;
  skipped: number;
}

/**
 * Fetches rows changed since the last pull and merges them with last-write-wins.
 *
 * The cursor is stored as the maximum `updated_at` we have seen rather than the
 * wall-clock time of the request, so a row written by the server mid-request is
 * still picked up next time.
 */
export async function pull(): Promise<PullResult> {
  const db = getDb();
  const result: PullResult = { pulled: 0, skipped: 0 };
  if (!supabase || !db) return result;

  const lastPulled = await getMeta<number>(LAST_PULLED_KEY, 0);
  const since = new Date(
    // A cursor of 0 means the first sync ever: ask for everything the account
    // has, because a brand-new device has no local rows to reconcile against.
    // Otherwise rewind slightly so a timestamp tie cannot drop a row.
    lastPulled === 0 ? 0 : Math.max(lastPulled - CURSOR_OVERLAP_MS, 0),
  ).toISOString();

  const { data: habitRows, error: habitError } = await supabase
    .from("habits")
    .select("*")
    .gt("updated_at", since);

  if (habitError) throw habitError;

  const { data: entryRows, error: entryError } = await supabase
    .from("entries")
    .select("*")
    .gt("updated_at", since)
    .limit(PAGE_LIMIT);

  if (entryError) throw entryError;

  const { data: dayRows, error: dayError } = await supabase
    .from("days")
    .select("*")
    .gt("updated_at", since)
    .limit(PAGE_LIMIT);

  if (dayError) throw dayError;

  // A saturated page means the window holds more rows than we just read.
  const saturated =
    (entryRows?.length ?? 0) >= PAGE_LIMIT || (dayRows?.length ?? 0) >= PAGE_LIMIT;

  let maxSeen = lastPulled;

  await db.transaction("rw", [db.habits, db.entries, db.days], async () => {
    for (const row of habitRows ?? []) {
      const incoming: Habit = {
        ...row,
        archived_at: row.archived_at ? Date.parse(row.archived_at) : null,
        updated_at: Date.parse(row.updated_at),
      };
      maxSeen = Math.max(maxSeen, incoming.updated_at);

      const local = await db.habits.get(incoming.id);
      if (local && localWins(local, incoming)) {
        result.skipped++;
        continue;
      }
      await db.habits.put(incoming);
      result.pulled++;
    }

    for (const row of entryRows ?? []) {
      const incoming: Entry = {
        ...row,
        updated_at: Date.parse(row.updated_at),
      };
      maxSeen = Math.max(maxSeen, incoming.updated_at);

      const local = await db.entries.get([incoming.habit_id, incoming.day]);
      if (local && localWins(local, incoming)) {
        result.skipped++;
        continue;
      }
      await db.entries.put(incoming);
      result.pulled++;
    }

    for (const row of dayRows ?? []) {
      const incoming: Day = {
        ...row,
        updated_at: Date.parse(row.updated_at),
      };
      maxSeen = Math.max(maxSeen, incoming.updated_at);

      const local = await db.days.get([incoming.user_id, incoming.day]);
      if (local && localWins(local, incoming)) {
        result.skipped++;
        continue;
      }
      await db.days.put(incoming);
      result.pulled++;
    }
  });

  // Holding the cursor when a page was saturated keeps the sync at-least-once:
  // the next pull repeats this window and picks up whatever was cut off.
  if (!saturated && maxSeen > 0) await setMeta(LAST_PULLED_KEY, maxSeen);
  return result;
}

/** Full resync: drops the cursor so the next pull re-reads everything. */
export async function invalidatePullCursor(): Promise<void> {
  await setMeta(LAST_PULLED_KEY, 0);
}

export type { SyncTableName };
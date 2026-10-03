import { nanoid } from "nanoid";
import {
  getDb,
  rowKeyFor,
  type Day,
  type Entry,
  type Habit,
  type HabitDraft,
  type OutboxItem,
  type SyncTableName,
} from "./db";
import { DEFAULT_STREAK_THRESHOLD } from "@/lib/streaks/compute";
import { notifyLocalChanged } from "./change-notifier";
import { mergeByUpdatedAt } from "@/lib/auth/guest-merge";

/**
 * Every mutation writes the local row and the outbox entry inside one Dexie
 * transaction, so a queued change can never be lost or orphaned.
 */
export async function enqueue(
  table: OutboxItem["table"],
  rowKey: string,
  payload: Record<string, unknown>,
  updated_at: number,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const id = `${table}:${rowKey}`;
  const existing = await db.outbox.get(id);
  if (existing) {
    // Collapse repeated offline edits into one pending upsert.
    await db.outbox.put({ ...existing, payload, updated_at, attempts: 0, failed_at: null, last_error: null });
    return;
  }
  await db.outbox.add({
    id,
    table,
    rowKey,
    payload,
    updated_at,
    attempts: 0,
    failed_at: null,
    last_error: null,
  });
}

/** Serialises a row for the wire: timestamps become ISO strings. */
export function toWire<T extends { updated_at: number }>(row: T): Record<string, unknown> {
  const { updated_at, ...rest } = row;
  return { ...rest, updated_at: new Date(updated_at).toISOString() };
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export interface HabitFilters {
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export async function listHabits(filters: HabitFilters = {}): Promise<Habit[]> {
  const db = getDb();
  if (!db) return [];
  const all = await db.habits.toArray();
  return all
    .filter((h) => filters.includeDeleted || !h.deleted)
    .filter((h) => filters.includeArchived || !h.archived_at)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export async function getHabit(id: string): Promise<Habit | undefined> {
  return getDb()?.habits.get(id);
}

export async function createHabit(
  draft: HabitDraft,
  userId: string | null = null,
): Promise<Habit> {
  const db = getDb();
  if (!db) throw new Error("Local database unavailable");

  const now = Date.now();
  const existing = await db.habits.toArray();
  const habit: Habit = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: draft.name.trim(),
    icon: draft.icon ?? null,
    grp: draft.grp ?? null,
    kind: draft.kind,
    unit: draft.unit ?? null,
    target: draft.kind === "tick" ? null : (draft.target ?? null),
    schedule: draft.schedule.length > 0 ? draft.schedule : [1, 2, 3, 4, 5, 6, 7],
    sort: existing.length,
    archived_at: null,
    updated_at: now,
    deleted: false,
  };

  await db.transaction("rw", db.habits, db.outbox, async () => {
    await db.habits.put(habit);
    await enqueue("habits", habit.id, toWire(habit), now);
  });
  notifyLocalChanged();

  return habit;
}

export async function updateHabit(id: string, patch: Partial<Habit>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const current = await db.habits.get(id);
  if (!current) return;

  const next: Habit = { ...current, ...patch, id, updated_at: Date.now() };
  await db.transaction("rw", db.habits, db.outbox, async () => {
    await db.habits.put(next);
    await enqueue("habits", id, toWire(next), next.updated_at);
  });
  notifyLocalChanged();
}

/**
 * Archive: the habit stops appearing in Today, but its entries stay. History is
 * the whole point of the app, so archiving is never a destructive operation.
 */
export async function archiveHabit(id: string): Promise<void> {
  await updateHabit(id, { archived_at: Date.now() });
}

export async function restoreHabit(id: string): Promise<void> {
  await updateHabit(id, { archived_at: null });
}

/**
 * Soft delete: the row survives so the removal can replicate, and entries are
 * left in place because History should still show what was logged.
 */
export async function deleteHabit(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const current = await db.habits.get(id);
  if (!current) return;

  const now = Date.now();
  const next: Habit = { ...current, deleted: true, updated_at: now };

  await db.transaction("rw", db.habits, db.outbox, async () => {
    await db.habits.put(next);
    await enqueue("habits", id, toWire(next), now);
  });
  notifyLocalChanged();
}

/** Persists a new display order in one transaction so a drag is atomic. */
export async function reorderHabits(orderedIds: string[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  const now = Date.now();

  await db.transaction("rw", db.habits, db.outbox, async () => {
    for (const [index, id] of orderedIds.entries()) {
      const current = await db.habits.get(id);
      if (!current) continue;
      const next: Habit = { ...current, sort: index, updated_at: now };
      await db.habits.put(next);
      await enqueue("habits", id, toWire(next), now);
    }
  });
  notifyLocalChanged();
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function listEntries(from?: string, to?: string): Promise<Entry[]> {
  const db = getDb();
  if (!db) return [];
  if (from && to) return db.entries.where("day").between(from, to, true, true).toArray();
  return db.entries.toArray();
}

export async function getEntry(habitId: string, day: string): Promise<Entry | undefined> {
  return getDb()?.entries.get([habitId, day]);
}

/** Entries for a set of habits on one day, shaped for the Today screen. */
export async function entriesForDay(
  day: string,
  habitIds: string[],
): Promise<Map<string, number>> {
  const db = getDb();
  const out = new Map<string, number>();
  if (!db || habitIds.length === 0) return out;

  await db.transaction("rw", db.entries, async () => {
    for (const habitId of habitIds) {
      const row = await db.entries.get([habitId, day]);
      if (row) out.set(habitId, row.value);
    }
  });
  return out;
}

export async function setEntryValue(
  habitId: string,
  day: string,
  value: number,
  userId: string | null = null,
  note: string | null = null,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const now = Date.now();

  await db.transaction("rw", db.entries, db.outbox, async () => {
    const existing = await db.entries.get([habitId, day]);
    const next: Entry = {
      habit_id: habitId,
      day,
      user_id: existing?.user_id ?? userId,
      value: Math.max(0, value),
      note: note ?? existing?.note ?? null,
      updated_at: now,
    };
    await db.entries.put(next);
    await enqueue("entries", rowKeyFor("entries", next), toWire(next), now);
  });
  notifyLocalChanged();
}

/** Tick habits flip between 0 and 1. */
export async function toggleTick(
  habitId: string,
  day: string,
  userId: string | null = null,
): Promise<number> {
  const current = (await getEntry(habitId, day))?.value ?? 0;
  const next = current > 0 ? 0 : 1;
  await setEntryValue(habitId, day, next, userId);
  return next;
}

export async function incrementEntry(
  habitId: string,
  day: string,
  step: number,
  userId: string | null = null,
): Promise<number> {
  const current = (await getEntry(habitId, day))?.value ?? 0;
  const next = Math.max(0, current + step);
  await setEntryValue(habitId, day, next, userId);
  return next;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export async function getDay(userId: string, day: string): Promise<Day | undefined> {
  return getDb()?.days.get([userId, day]);
}

/** Day rows in a range, oldest first. Used by History and the data export. */
export async function listDays(from?: string, to?: string): Promise<Day[]> {
  const db = getDb();
  if (!db) return [];
  const rows =
    from && to
      ? await db.days.where("day").between(from, to, true, true).toArray()
      : await db.days.toArray();
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

export async function setDayNote(
  userId: string,
  day: string,
  patch: { mood?: number | null; note?: string | null },
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const now = Date.now();

  await db.transaction("rw", db.days, db.outbox, async () => {
    const existing = await db.days.get([userId, day]);
    const next: Day = {
      user_id: userId,
      day,
      mood: patch.mood ?? existing?.mood ?? null,
      note: patch.note ?? existing?.note ?? null,
      updated_at: now,
    };
    await db.days.put(next);
    await enqueue("days", rowKeyFor("days", next), toWire(next), now);
  });
  notifyLocalChanged();
}

// ---------------------------------------------------------------------------
// Profile and meta
// ---------------------------------------------------------------------------

export async function saveProfile(profile: Omit<import("./db").Profile, "updated_at">): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.profiles.put({ ...profile, updated_at: Date.now() });
}

export async function getCachedProfile(): Promise<import("./db").Profile | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.profiles.toArray();
  return rows[0] ?? null;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.meta.put({ key, value });
}

export const DEFAULT_PROFILE = {
  tz: "Asia/Kolkata",
  theme: "system",
  rollover_hour: 0,
  streak_threshold: DEFAULT_STREAK_THRESHOLD,
  freeze_per_week: 0,
} as const;

/** Wipes local data. Used on sign-out and account deletion. */
export async function clearLocalData(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.transaction(
    "rw",
    [db.habits, db.entries, db.days, db.profiles, db.outbox, db.meta],
    async () => {
      await Promise.all([
        db.habits.clear(),
        db.entries.clear(),
        db.days.clear(),
        db.profiles.clear(),
        db.outbox.clear(),
        db.meta.clear(),
      ]);
    },
  );
}

export { nanoid };
export type { SyncTableName };
/**
 * Re-own guest rows after the first successful sign-in.
 *
 * Guest data is stored with `user_id: null`. This runs in one Dexie transaction
 * so a crash mid-way can never leave rows half-owned, and every row it adopts is
 * queued in the outbox in that same transaction, so nothing can be owned but
 * unsynced.
 *
 * Days are deliberately excluded. A Day is keyed by [user_id, day] and IndexedDB
 * rejects null as a key component, so a day row cannot belong to a guest in the
 * first place; there would be nothing here to adopt.
 *
 * Nothing is deleted here. Rows that lose a conflict are replaced by the server
 * copy in place; the guest rows that lose are only ever removed once `push()`
 * has actually confirmed them, which the caller handles.
 *
 * Returns the number of rows adopted so the caller can decide whether a sync is
 * worth kicking off.
 */
export async function adoptGuestData(userId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  // Re-owning to an empty owner would make rows unsyncable and unrecoverable.
  if (!userId) return 0;

  let adopted = 0;

  await db.transaction(
    "rw",
    // db.meta must be listed too: writing to a table outside the transaction's
    // scope fails at commit and silently aborts the whole adoption.
    [db.habits, db.entries, db.outbox, db.meta],
    async () => {
      const [guestHabits, guestEntries] = await Promise.all([
        db.habits.filter((h) => h.user_id === null).toArray(),
        db.entries.filter((e) => e.user_id === null).toArray(),
      ]);

      // Server copies that share an id, if any already synced down.
      const [serverHabits, serverEntries] = await Promise.all([
        db.habits.filter((h) => h.user_id === userId).toArray(),
        db.entries.filter((e) => e.user_id === userId).toArray(),
      ]);

      const habits = mergeByUpdatedAt(guestHabits, serverHabits, (h) => h.id);
      const entries = mergeByUpdatedAt(guestEntries, serverEntries, (e) =>
        rowKeyFor("entries", e),
      );
      for (const habit of habits.rows) {
        const owned: Habit = { ...habit, user_id: userId };
        await db.habits.put(owned);
        await enqueue("habits", owned.id, toWire(owned), owned.updated_at);
        adopted++;
      }

      for (const entry of entries.rows) {
        const owned: Entry = { ...entry, user_id: userId };
        await db.entries.put(owned);
        await enqueue("entries", rowKeyFor("entries", owned), toWire(owned), owned.updated_at);
        adopted++;
      }

      // Recorded for diagnostics only. This is deliberately not used to skip a
      // future merge: someone can sign out, create guest rows while signed out,
      // then sign back in, and those rows still need adopting.
      await db.meta.put({ key: "guestAdoptedFor", value: { userId, at: Date.now() } });
    },
  );

  notifyLocalChanged();
  return adopted;
}

/**
 * True when there are guest rows to adopt.
 *
 * Based purely on whether guest rows exist, not on a "already merged" flag:
 * once adopted there are no guest rows left, so the count is a natural and
 * correct idempotency check, and it still catches rows created later.
 */
export async function needsGuestMerge(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  return (await db.habits.filter((h) => h.user_id === null).count()) > 0;
}

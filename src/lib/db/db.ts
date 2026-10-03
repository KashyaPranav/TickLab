import Dexie, { type EntityTable, type Table } from "dexie";
import type { HabitKind } from "@/lib/streaks/compute";

export type { HabitKind };

/**
 * Local database. This is the source of truth the UI reads and writes, so every
 * interaction is synchronous-ish and works with no network at all.
 *
 * Timestamps are stored as epoch milliseconds rather than Date objects: they
 * sort correctly in IndexedDB, survive structured cloning unchanged, and avoid
 * the classic "Date came back as a string" bug.
 */

export type SyncStatus = "idle" | "pending" | "syncing" | "error" | "offline";

export interface Habit {
  id: string;
  user_id: string | null;
  name: string;
  icon: string | null;
  grp: string | null;
  kind: HabitKind;
  unit: string | null;
  /** null for "tick" habits, which only need a positive value. */
  target: number | null;
  /** ISO weekdays, Monday = 1 .. Sunday = 7. */
  schedule: number[];
  sort: number;
  archived_at: number | null;
  updated_at: number;
  deleted: boolean;
}

export interface Entry {
  /** Primary key part 1. */
  habit_id: string;
  /** Primary key part 2, "YYYY-MM-DD". */
  day: string;
  user_id: string | null;
  value: number;
  note: string | null;
  updated_at: number;
}

export interface Day {
  user_id: string;
  day: string;
  mood: number | null;
  note: string | null;
  updated_at: number;
}

export interface Profile {
  id: string;
  tz: string;
  theme: string | null;
  rollover_hour: number;
  streak_threshold: number;
  freeze_per_week: number;
  updated_at: number;
}

export type SyncTableName = "habits" | "entries" | "days" | "profiles";

/** Tables replicated through the outbox. Profiles sync via a server function. */
export type OutboxTableName = Exclude<SyncTableName, "profiles">;

/**
 * One row per changed record, not one per write. Toggling a habit eight times
 * while offline collapses into a single queued upsert.
 */
export interface OutboxItem {
  /** `${table}:${rowKey}`, which makes deduplication a primary-key put. */
  id: string;
  table: OutboxTableName;
  /** The row's primary key within its table. */
  rowKey: string;
  payload: Record<string, unknown>;
  updated_at: number;
  attempts: number;
  /** Set after `attempts` exceeds the retry budget, to stop hot-looping. */
  failed_at: number | null;
  last_error: string | null;
}

export interface SyncState {
  key: string;
  value: unknown;
}

export interface HabitDraft {
  name: string;
  kind: HabitKind;
  icon?: string | null;
  grp?: string | null;
  unit?: string | null;
  target?: number | null;
  schedule: number[];
}

export class TickLabDB extends Dexie {
  habits!: EntityTable<Habit, "id">;
  entries!: Table<Entry, [string, string]>;
  days!: Table<Day, [string, string]>;
  profiles!: EntityTable<Profile, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  meta!: Table<SyncState, string>;

  constructor() {
    super("ticklab");

    this.version(1).stores({
      habits: "id, user_id, sort, updated_at, deleted, archived_at",
      entries: "[habit_id+day], user_id, day, updated_at",
      days: "[user_id+day], user_id, day, updated_at",
      outbox: "++id, table, created_at",
    });

    // v2: keyed outbox for deduplication, profile cache, meta table, and a
    // `name` index used by search. The compound outbox index changes the table's
    // primary key, which Dexie handles by rebuilding it.
    this.version(2)
      .stores({
        habits: "id, user_id, sort, updated_at, deleted, archived_at, name",
        entries: "[habit_id+day], user_id, day, updated_at",
        days: "[user_id+day], user_id, day, updated_at",
        profiles: "id, updated_at",
        outbox: "id, table, updated_at, attempts, failed_at",
        meta: "key",
      })
      .upgrade(async () => {
        // Nothing to backfill: v1 rows already carry the same shape apart from
        // Date-vs-number timestamps, which Dexie coerces on read.
      });
  }
}

let instance: TickLabDB | null = null;
let unavailable = false;

/**
 * IndexedDB is unavailable during SSR and in some private-browsing modes. Callers
 * fall back to server reads, so `null` is a supported state rather than a crash.
 */
export function getDb(): TickLabDB | null {
  if (typeof indexedDB === "undefined") {
    unavailable = true;
    return null;
  }
  if (unavailable) return null;
  if (!instance) {
    try {
      instance = new TickLabDB();
    } catch {
      unavailable = true;
      return null;
    }
  }
  return instance;
}

/** Test seam: drops the cached instance so a fresh database can be installed. */
export function __setDb(db: TickLabDB | null): void {
  instance = db;
  unavailable = db === null;
}

export const DB_NAME = "ticklab";

/** Any row that has a primary key this module knows how to derive. */
export interface KeyableRow {
  id?: string;
  habit_id?: string;
  user_id?: string | null;
  day?: string;
}

/**
 * The row's identity within its table. Habit ids are UUIDs, so "|" is a safe
 * separator for the compound cases.
 */
export function rowKeyFor(table: SyncTableName, row: KeyableRow): string {
  switch (table) {
    case "habits":
    case "profiles":
      return String(row.id);
    case "entries":
      return `${String(row.habit_id)}|${String(row.day)}`;
    case "days":
      return `${String(row.user_id)}|${String(row.day)}`;
  }
}
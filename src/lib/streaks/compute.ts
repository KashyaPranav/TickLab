/**
 * Habit shapes shared by the streak, stats and sync layers. Deliberately narrow:
 * the streak maths only needs id + schedule + target + archived_at.
 */

import { addDays, isoWeekday } from "@/lib/dates";

export type HabitKind = "tick" | "count" | "duration" | "number";

export interface HabitLike {
  id: string;
  /** ISO weekdays, Monday = 1 .. Sunday = 7. Empty array means never scheduled. */
  schedule: number[];
  /** Count/duration/number target. Ignored for "tick". */
  target?: number | null;
  /**
   * An archived habit stops counting toward streaks from the day it was archived.
   * Accepts a day key ("2024-05-01"), an ISO timestamp, or epoch milliseconds;
   * callers with a stored epoch should prefer passing the day key.
   */
  archived_at?: string | number | null;
}

export interface EntryLike {
  habit_id: string;
  day: string;
  value: number;
}

/** Fraction of scheduled habits that must be complete for a day to count. */
export const DEFAULT_STREAK_THRESHOLD = 0.7;

/** A "missed day" pass granted once per ISO week. */
export interface FreezeConfig {
  /** How many freezes are granted per ISO week. 0 disables the feature. */
  perWeek: number;
}

/**
 * The first day on which a habit no longer counts, or null when it is active.
 *
 * An archived habit still explains the past: it must keep earning its streak up
 * to and including the day before it was archived, and only drop out afterwards.
 * Epoch values fall back to their UTC day, so a caller that knows the user's zone
 * should hand in a day key instead.
 */
export function archivedFromDay(habit: HabitLike): string | null {
  const raw = habit.archived_at;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const date = new Date(raw);
    return date.toISOString().slice(0, 10);
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, 10);
}

/** True when the habit was already archived as of `day`. */
export function isArchivedOn(habit: HabitLike, day: string): boolean {
  const from = archivedFromDay(habit);
  return from !== null && day >= from;
}

export function isScheduledOn(habit: HabitLike, day: string): boolean {
  return habit.schedule.includes(isoWeekday(day));
}

/** Habits scheduled on `day`, excluding any archived before that day. */
export function scheduledHabits(habits: HabitLike[], day: string): HabitLike[] {
  return habits.filter(
    (h) =>
      h.schedule.length > 0 && isScheduledOn(h, day) && !isArchivedOn(h, day),
  );
}

export function entryValue(
  habitId: string,
  entries: EntryLike[],
  day: string,
): number {
  return entries.find((e) => e.habit_id === habitId && e.day === day)?.value ?? 0;
}

/**
 * Whether an entry satisfies a habit's target.
 *
 * "tick" only needs a positive value. Count-style habits are capped at target, so
 * 10 reps against a target of 8 is still complete.
 */
export function habitMetTarget(
  habit: HabitLike,
  entries: EntryLike[],
  day: string,
): boolean {
  if (habit.schedule.length > 0 && !isScheduledOn(habit, day)) return false;
  const value = entryValue(habit.id, entries, day);
  if (habit.target && habit.target > 0) return value >= habit.target;
  return value > 0;
}

export interface DayScore {
  day: string;
  scheduled: number;
  completed: number;
  /** completed / scheduled, or null when nothing was scheduled. */
  ratio: number | null;
  complete: boolean;
}

export function scoreDay(
  habits: HabitLike[],
  entries: EntryLike[],
  day: string,
  threshold = DEFAULT_STREAK_THRESHOLD,
): DayScore {
  const scheduled = scheduledHabits(habits, day);
  const completed = scheduled.filter((h) => habitMetTarget(h, entries, day)).length;
  const ratio = scheduled.length === 0 ? null : completed / scheduled.length;
  return {
    day,
    scheduled: scheduled.length,
    completed,
    ratio,
    complete: ratio !== null && ratio >= threshold,
  };
}

/** A day counts toward a streak once the ratio of completed to scheduled habits
 * reaches the threshold. Unscheduled habits are excluded from both sides, so a
 * rest day cannot lower it. */
export function isDayComplete(
  habits: HabitLike[],
  entries: EntryLike[],
  day: string,
  threshold = DEFAULT_STREAK_THRESHOLD,
): boolean {
  return scoreDay(habits, entries, day, threshold).complete;
}

type DayStatus = "skip" | "pending" | "complete" | "frozen" | "miss";

export interface StreakOptions {
  threshold?: number;
  /** Day to walk back from; the caller's "today". */
  today?: string;
  freezes?: FreezeConfig;
  /** Do not count days before this key (e.g. sign-up date). */
  since?: string;
}

export interface StreakResult {
  /** Consecutive complete days ending at (or just before) today. */
  current: number;
  /** Best run within the scanned window. */
  longest: number;
  /** Days rescued by freeze tokens. */
  frozenDays: number;
  /** First day of the current run, null when current is 0. */
  startedOn: string | null;
}

const EMPTY: StreakResult = {
  current: 0,
  longest: 0,
  frozenDays: 0,
  startedOn: null,
};

/**
 * Walk backwards from `today` in one pass, tracking the live run length.
 *
 * Two subtleties:
 *  - Unscheduled days are skipped outright: they neither extend nor break a run.
 *  - "Today" is lenient. A user who has not checked in at 9am still has their
 *    streak; the day is only judged once it is actually over.
 */
export function computeStreaks(
  habits: HabitLike[],
  entries: EntryLike[],
  options: StreakOptions = {},
): StreakResult {
  const { threshold = DEFAULT_STREAK_THRESHOLD, today, freezes = { perWeek: 0 }, since } = options;

  const active = habits.filter((h) => h.schedule.length > 0);
  if (active.length === 0 || !today) return EMPTY;

  const floor = clampFloor(since, entries, active);
  const freezesLeft = new Map<string, number>();

  const takeFreeze = (day: string): boolean => {
    const key = isoWeek(day);
    const remaining = freezesLeft.get(key) ?? freezes.perWeek;
    if (remaining <= 0) return false;
    freezesLeft.set(key, remaining - 1);
    return true;
  };

  const statusOf = (day: string): DayStatus => {
    if (!active.some((h) => isScheduledOn(h, day))) return "skip";
    if (isDayComplete(active, entries, day, threshold)) return "complete";
    // Today is still in progress, so an incomplete today is pending, not a miss.
    // This has to be checked before spending a freeze: the day is not lost yet,
    // and burning the user's weekly allowance on it would be a data point of an
    // unfinished day.
    if (day === today) return "pending";
    if (freezes.perWeek > 0 && takeFreeze(day)) return "frozen";
    return "miss";
  };

  let run = 0;
  let longest = 0;
  let frozenDays = 0;
  let current: number | null = null;
  let startedOn: string | null = null;

  let cursor = today;
  // Backstop: 20 years of days is far beyond any plausible history.
  for (let i = 0; i < 8000 && cursor >= floor; i++) {
    const status = statusOf(cursor);

    switch (status) {
      case "skip":
      case "pending":
        // Rest days and the still-open day leave the run untouched.
        break;
      case "complete":
      case "frozen": {
        if (status === "frozen") frozenDays++;
        run++;
        longest = Math.max(longest, run);
        // Walking backwards, the last write wins and is therefore the earliest
        // day of the run. Frozen while `current` is still undecided, because a
        // later run must not overwrite the reported start.
        if (current === null) startedOn = cursor;
        break;
      }
      case "miss": {
        // A miss closes the run; its length at that moment is the current streak.
        if (current === null) {
          current = run;
          startedOn = null;
        }
        run = 0;
        break;
      }
    }

    cursor = addDays(cursor, -1);
  }

  if (current === null) current = run;

  return { current, longest, frozenDays, startedOn: current > 0 ? startedOn : null };
}

/** Convenience wrapper returning just the current streak length. */
export function currentStreak(
  habits: HabitLike[],
  entries: EntryLike[],
  options: StreakOptions = {},
): number {
  return computeStreaks(habits, entries, options).current;
}

/**
 * Scanning 8000 days on a fresh account is wasteful. Stop at the earlier of the
 * caller's `since` bound and the first day that actually has data.
 */
function clampFloor(
  since: string | undefined,
  entries: EntryLike[],
  habits: HabitLike[],
): string {
  let floor = since ?? "0001-01-01";
  const ids = new Set(habits.map((h) => h.id));
  let earliest: string | null = null;
  for (const entry of entries) {
    if (!ids.has(entry.habit_id)) continue;
    if (earliest === null || entry.day < earliest) earliest = entry.day;
  }
  if (earliest !== null && earliest > floor) floor = earliest;
  return floor;
}

/** ISO-8601 year-week bucket, used to ration freeze tokens. */
export function isoWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  // Shift to the Thursday of the week; its calendar year defines the ISO year.
  const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1;
  const thursday = new Date(date.getTime() + (4 - isoWeekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = ((jan4.getUTCDay() + 6) % 7) + 1;
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - jan4.getTime()) / 86_400_000 - (4 - jan4Weekday)) / 7,
    );
  return `${year}-W${String(week).padStart(2, "0")}`;
}
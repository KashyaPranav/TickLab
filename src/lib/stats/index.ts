/**
 * Pure functions that turn raw rows into view models. No I/O, no React, no
 * Date.now() without an explicit `today`, so every number on screen is
 * reproducible in a test.
 */

import {
  addDays,
  dayKeyToParts,
  isoWeekday,
  rangeDays,
  startOfMonth,
  startOfWeek,
  type DayKey,
} from "@/lib/dates";
import {
  DEFAULT_STREAK_THRESHOLD,
  entryValue,
  habitMetTarget,
  isScheduledOn,
  scheduledHabits,
  type EntryLike,
  type HabitLike,
} from "@/lib/streaks/compute";

export interface PeriodStats {
  from: DayKey;
  to: DayKey;
  /** Mean completion across days that had at least one habit scheduled. */
  completion: number;
  /** completed / scheduled habit slots across the whole period. */
  completedSlots: number;
  scheduledSlots: number;
  daysScored: number;
  perfectDays: number;
  /** Consecutive complete days at the end of the period. */
  bestRunInPeriod: number;
}

export interface HabitStats extends PeriodStats {
  habitId: string;
  /** Total recorded value, e.g. minutes or glasses. */
  totalValue: number;
  daysRecorded: number;
}

/** Cell model for the GitHub-style heatmap. */
export interface HeatmapDay {
  day: DayKey;
  completed: number;
  scheduled: number;
  ratio: number | null;
  /** 0-4 intensity bucket for rendering. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Anything the day had scheduled at all. */
  active: boolean;
}

export interface HeatmapWeek {
  /** The Monday that starts this column. */
  start: DayKey;
  days: HeatmapDay[];
}

export interface Heatmap {
  weeks: HeatmapWeek[];
  from: DayKey;
  to: DayKey;
  levels: [number, number, number, number, number];
}

/** Habits that met their target on `day`, out of those scheduled. */
export function completionOn(
  habits: HabitLike[],
  entries: EntryLike[],
  day: DayKey,
): { completed: number; scheduled: number; ratio: number | null } {
  const scheduled = scheduledHabits(habits, day);
  const completed = scheduled.filter((h) => habitMetTarget(h, entries, day)).length;
  return {
    completed,
    scheduled: scheduled.length,
    ratio: scheduled.length === 0 ? null : completed / scheduled.length,
  };
}

export function ratioToLevel(ratio: number | null): HeatmapDay["level"] {
  if (ratio === null || ratio <= 0) return 0;
  if (ratio < 0.4) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 1) return 3;
  return 4;
}

export interface RangeOptions {
  habits: HabitLike[];
  entries: EntryLike[];
  from: DayKey;
  to: DayKey;
  threshold?: number;
}

/**
 * Aggregate stats over a period.
 *
 * Days with nothing scheduled are excluded from `completion` entirely: averaging
 * in empty rest days would drag every percentage toward zero.
 */
export function periodStats(options: RangeOptions): PeriodStats {
  const { habits, entries, from, to } = options;
  const { threshold = DEFAULT_STREAK_THRESHOLD } = options;

  const days = rangeDays(from, to);
  let completedSlots = 0;
  let scheduledSlots = 0;
  let daysScored = 0;
  let perfectDays = 0;
  let ratioSum = 0;
  let run = 0;
  let bestRunInPeriod = 0;

  for (const day of days) {
    const { completed, scheduled, ratio } = completionOn(habits, entries, day);
    if (ratio === null) continue;

    completedSlots += completed;
    scheduledSlots += scheduled;
    daysScored++;
    ratioSum += ratio;
    if (completed === scheduled) perfectDays++;
    if (ratio >= threshold) {
      run++;
      bestRunInPeriod = Math.max(bestRunInPeriod, run);
    } else {
      run = 0;
    }
  }

  return {
    from,
    to,
    completion: daysScored === 0 ? 0 : ratioSum / daysScored,
    completedSlots,
    scheduledSlots,
    daysScored,
    perfectDays,
    bestRunInPeriod,
  };
}

/** Stats for one habit over the same period shape. */
export function habitStats(
  habit: HabitLike,
  entries: EntryLike[],
  from: DayKey,
  to: DayKey,
): HabitStats {
  const scoped = entries.filter((e) => e.habit_id === habit.id);
  const base = periodStats({ habits: [habit], entries: scoped, from, to });

  const days = rangeDays(from, to).filter((day) => isScheduledOn(habit, day));
  const recorded = days.filter((day) => entryValue(habit.id, scoped, day) > 0);

  return {
    ...base,
    habitId: habit.id,
    totalValue: days.reduce(
      (sum, day) => sum + entryValue(habit.id, scoped, day),
      0,
    ),
    daysRecorded: recorded.length,
  };
}

/**
 * Build a heatmap of whole ISO weeks so columns line up.
 *
 * `weeks` always starts on a Monday and the first and last columns are padded
 * with out-of-range days, which the renderer simply skips.
 */
export function buildHeatmap(options: RangeOptions): Heatmap {
  const { habits, entries, from, to } = options;

  const gridStart = startOfWeek(from);
  const gridEnd = addDays(startOfWeek(to), 6);
  const levels: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  const weeks: HeatmapWeek[] = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 7)) {
    const days: HeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      if (day < from || day > to) continue;

      const { completed, scheduled, ratio } = completionOn(habits, entries, day);
      const level = ratioToLevel(ratio);
      levels[level]++;
      days.push({ day, completed, scheduled, ratio, level, active: scheduled > 0 });
    }
    weeks.push({ start: cursor, days });
  }

  return { weeks, from, to, levels };
}

export interface WeekStripDay {
  day: DayKey;
  weekday: number;
  /** Single glyph summarising the day: dot strength. */
  level: HeatmapDay["level"];
  completed: number;
  scheduled: number;
  isToday: boolean;
  isFuture: boolean;
}

/** The 7-day strip under the Today header. */
export function weekStrip(
  habits: HabitLike[],
  entries: EntryLike[],
  today: DayKey,
): WeekStripDay[] {
  const start = startOfWeek(today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    const { completed, scheduled, ratio } = completionOn(habits, entries, day);
    return {
      day,
      weekday: isoWeekday(day),
      level: ratioToLevel(ratio),
      completed,
      scheduled,
      isToday: day === today,
      isFuture: day > today,
    };
  });
}

export interface MonthGrid {
  /** Full ISO weeks covering the month. */
  weeks: WeekStripDay[][];
  monthLabel: string;
  /** Days of the target month, for highlighting. */
  monthDays: Set<DayKey>;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Calendar grid for month view, padded to whole weeks. */
export function monthGrid(
  habits: HabitLike[],
  entries: EntryLike[],
  anyDayInMonth: DayKey,
  today: DayKey,
): MonthGrid {
  const monthStart = startOfMonth(anyDayInMonth);
  const { month, year } = dayKeyToParts(monthStart);
  const monthDays = new Set<DayKey>();
  const gridStart = startOfWeek(monthStart);

  const weeks: WeekStripDay[][] = [];
  let cursor = gridStart;
  // Six rows covers every month layout.
  for (let w = 0; w < 6; w++) {
    const row: WeekStripDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      const { month: dm } = dayKeyToParts(day);
      if (dm === month) monthDays.add(day);

      const { completed, scheduled, ratio } = completionOn(habits, entries, day);
      row.push({
        day,
        weekday: isoWeekday(day),
        level: ratioToLevel(ratio),
        completed,
        scheduled,
        isToday: day === today,
        isFuture: day > today,
      });
    }
    weeks.push(row);
    cursor = addDays(cursor, 7);
  }

  return { weeks, monthLabel: `${MONTH_NAMES[month - 1]} ${year}`, monthDays };
}

export interface ConsistencySummary {
  last7: number;
  last30: number;
  last90: number;
  total: number;
}

/** Rolling completion rates used on the Insights screen. */
export function consistency(
  habits: HabitLike[],
  entries: EntryLike[],
  today: DayKey,
): ConsistencySummary {
  const win = (days: number) =>
    periodStats({
      habits,
      entries,
      from: addDays(today, -(days - 1)),
      to: today,
    }).completion;

  const first = entries.length > 0 ? entries.reduce((min, e) => (e.day < min ? e.day : min), entries[0].day) : today;

  return {
    last7: win(7),
    last30: win(30),
    last90: win(90),
    total: periodStats({ habits, entries, from: first, to: today }).completion,
  };
}
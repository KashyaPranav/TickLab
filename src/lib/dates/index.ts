/**
 * Local-date correctness.
 *
 * Every check-in is stored against a `day` key of the form "YYYY-MM-DD" that is
 * resolved in the *user's* timezone, never the device's. A day does not end at
 * midnight: `rolloverHour` shifts the boundary (a night owl who sleeps at 4am
 * still considers 04:00 on the 12th part of the 12th).
 *
 * These functions are pure and take an explicit `now` so they are testable.
 */

/** A resolved calendar day, independent of any Date object. */
export type DayKey = string; // "YYYY-MM-DD"

export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export interface RolloverOptions {
  /** IANA zone, e.g. "Asia/Kolkata". */
  timeZone: string;
  /** Local hour at which the previous day rolls over. 0 = midnight, 3 = 3am. */
  rolloverHour?: number;
}

export const DEFAULT_ROLLOVER_HOUR = 0;

export function assertDayKey(value: string): DayKey {
  if (!ISO_DAY_RE.test(value)) {
    throw new Error(`Invalid day key: ${value} (expected YYYY-MM-DD)`);
  }
  return value;
}

export function isValidDayKey(value: unknown): value is DayKey {
  return typeof value === "string" && ISO_DAY_RE.test(value);
}

/** Split a day key into numeric parts. */
export function dayKeyToParts(key: DayKey): {
  year: number;
  month: number; // 1-12
  date: number; // 1-31
  time: number; // UTC timestamp of the civil date
} {
  assertDayKey(key);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const date = Number(key.slice(8, 10));
  const time = Date.UTC(year, month - 1, date);
  return { year, month, date, time };
}

/** True only for well-formed keys naming a date that actually exists. */
export function isRealDayKey(key: unknown): boolean {
  if (!isValidDayKey(key)) return false;
  const { year, month, date, time } = dayKeyToParts(key);
  const d = new Date(time);
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === date
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function makeDayKey(year: number, month: number, date: number): DayKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(date)}` as DayKey;
}

/**
 * Offset of `timeZone` from UTC at a given instant, in minutes.
 * Computed rather than hard-coded so DST transitions resolve correctly.
 */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  // getTimezoneOffset is minutes *behind* UTC, so negate it.
  return -getOffset(timeZone, at);
}

function getOffset(timeZone: string, at: Date): number {
  const dtf = getFormatter(timeZone);
  const parts = dtf.formatToParts(at);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === "year") map.year = Number(part.value);
    if (part.type === "month") map.month = Number(part.value);
    if (part.type === "day") map.day = Number(part.value);
    if (part.type === "hour") map.hour = Number(part.value);
    if (part.type === "minute") map.minute = Number(part.value);
    if (part.type === "second") map.second = Number(part.value);
  }
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour,
    map.minute,
    map.second,
  );
  // formatToParts can yield hour 24 for midnight in some ICU versions.
  const normalized = map.hour === 24 ? asUTC - 24 * 3600_000 : asUTC;
  return (at.getTime() - normalized) / 60_000;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The local day key for an instant in a timezone, honouring the rollover hour.
 *
 *   2024-03-10T18:30Z in Asia/Kolkata, rolloverHour 0  -> "2024-03-10"
 *   2024-03-11T02:00Z in Asia/Kolkata, rolloverHour 3  -> "2024-03-10"
 */
export function dayKeyInZone(now: Date, options: RolloverOptions): DayKey {
  const { timeZone, rolloverHour = DEFAULT_ROLLOVER_HOUR } = options;
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
  const offset = tzOffsetMinutes(timeZone, now);
  const shifted = new Date(now.getTime() + (offset - rolloverHour * 60) * 60_000);
  return toDayKeyUtc(shifted);
}

/** "Today" for the user. */
export function todayLocal(
  options: RolloverOptions = { timeZone: "UTC" },
  now: Date = new Date(),
): DayKey {
  return dayKeyInZone(now, options);
}

/** Convenience wrapper for callers that only have a bare timezone string. */
export function todayInZone(
  timeZone: string,
  rolloverHour = 0,
  now: Date = new Date(),
): DayKey {
  return dayKeyInZone(now, { timeZone, rolloverHour });
}

/** Day key from a Date using its UTC components (used after shifting above). */
export function toDayKeyUtc(date: Date): DayKey {
  return makeDayKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

/**
 * Convert a day key into a Date at the start of that day *in the given zone*.
 * The exact instant shifts across DST, which is why this needs the zone.
 */
export function dayKeyToDate(key: DayKey, timeZone: string): Date {
  assertDayKey(key);
  const { year, month, date } = dayKeyToParts(key);
  const naive = Date.UTC(year, month - 1, date, 0, 0, 0);
  // Two passes converge: the first guess gives the offset, which may then change
  // the offset again on a DST boundary day.
  let guess = naive - tzOffsetMinutes(timeZone, new Date(naive)) * 60_000;
  guess = naive - tzOffsetMinutes(timeZone, new Date(guess)) * 60_000;
  return new Date(guess);
}

/** ISO weekday: Monday = 1 ... Sunday = 7, matching the `schedule` column. */
export function isoWeekday(key: DayKey): number {
  const { time } = dayKeyToParts(key);
  return ((new Date(time).getUTCDay() + 6) % 7) + 1;
}

export function weekdayShort(key: DayKey): string {
  return WEEKDAY_SHORT[isoWeekday(key) - 1];
}

export function weekdayInitial(key: DayKey): string {
  return WEEKDAY_SHORT[isoWeekday(key) - 1].slice(0, 1);
}

/**
 * Add calendar days to a day key. Operates on the civil date, so it is immune to
 * DST (adding a day across a transition always yields the next calendar day).
 */
export function addDays(key: DayKey, amount: number): DayKey {
  return toDayKeyUtc(new Date(dayKeyToParts(key).time + amount * 86_400_000));
}

export function diffInDays(from: DayKey, to: DayKey): number {
  return Math.round((dayKeyToParts(to).time - dayKeyToParts(from).time) / 86_400_000);
}

/** Inclusive list of day keys from `from` to `to`. */
export function rangeDays(from: DayKey, to: DayKey): DayKey[] {
  const span = diffInDays(from, to);
  if (span < 0) return [];
  const out: DayKey[] = [];
  for (let i = 0; i <= span; i++) out.push(addDays(from, i));
  return out;
}

export function minDay(a: DayKey, b: DayKey): DayKey {
  return a <= b ? a : b;
}

export function maxDay(a: DayKey, b: DayKey): DayKey {
  return a >= b ? a : b;
}

/** Monday of the ISO week containing `key`. */
export function startOfWeek(key: DayKey): DayKey {
  return addDays(key, -(isoWeekday(key) - 1));
}

export function startOfMonth(key: DayKey): DayKey {
  const { year, month } = dayKeyToParts(key);
  return makeDayKey(year, month, 1);
}

export function endOfMonth(key: DayKey): DayKey {
  const { year, month } = dayKeyToParts(key);
  return makeDayKey(year, month, daysInMonth(year, month));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatDayKey(
  key: DayKey,
  opts: { weekday?: boolean; year?: boolean; style?: "short" | "medium" | "long" } = {},
): string {
  const { weekday = false, year = false, style = "short" } = opts;
  const { month: m, date } = dayKeyToParts(key);
  const y = key.slice(0, 4);
  const base =
    style === "long"
      ? `${MONTH_SHORT[m - 1]} ${date}, ${y}`
      : style === "medium"
        ? `${MONTH_SHORT[m - 1]} ${date}`
        : `${pad(date)} ${MONTH_SHORT[m - 1]}${year ? ` ${y}` : ""}`;
  return weekday ? `${weekdayShort(key)}, ${base}` : base;
}

/** "today" / "yesterday" / "12 Mar" for the day navigator. */
export function relativeLabel(key: DayKey, today: DayKey): string {
  const delta = diffInDays(today, key);
  if (delta === 0) return "Today";
  if (delta === -1) return "Yesterday";
  if (delta === 1) return "Tomorrow";
  return formatDayKey(key, { weekday: delta > -7 && delta < 7, year: delta < -300 });
}

/**
 * The last N day keys ending at `end`, oldest first.
 */
export function lastNDays(end: DayKey, count: number): DayKey[] {
  const out: DayKey[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(end, -i));
  return out;
}
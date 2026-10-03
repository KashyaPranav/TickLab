import { describe, it, expect } from "vitest";
import {
  archivedFromDay,
  computeStreaks,
  currentStreak,
  habitMetTarget,
  isArchivedOn,
  isDayComplete,
  isScheduledOn,
  isoWeek,
  scheduledHabits,
  scoreDay,
  type EntryLike,
  type HabitLike,
} from "@/lib/streaks/compute";
import { dayKeyInZone } from "@/lib/dates";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];

function habit(overrides: Partial<HabitLike> & { id: string }): HabitLike {
  return { schedule: EVERY_DAY, target: null, archived_at: null, ...overrides };
}

function entries(...rows: [string, string][]): EntryLike[] {
  return rows.map(([habit_id, day]) => ({ habit_id, day, value: 1 }));
}

function entry(habit_id: string, day: string, value = 1): EntryLike {
  return { habit_id, day, value };
}

describe("scheduling", () => {
  it("maps ISO weekdays onto days", () => {
    const h = habit({ id: "a", schedule: [1, 5] }); // Monday, Friday
    expect(isScheduledOn(h, "2024-01-01")).toBe(true); // Monday
    expect(isScheduledOn(h, "2024-01-05")).toBe(true); // Friday
    expect(isScheduledOn(h, "2024-01-03")).toBe(false); // Wednesday
    expect(isScheduledOn(h, "2024-01-07")).toBe(false); // Sunday
  });

  it("treats Sunday as 7, not 0", () => {
    const h = habit({ id: "a", schedule: [7] });
    expect(isScheduledOn(h, "2024-01-07")).toBe(true);
    expect(isScheduledOn(h, "2024-01-01")).toBe(false);
  });
});

describe("target satisfaction", () => {
  it("a tick habit only needs a positive value", () => {
    const h = habit({ id: "a" });
    expect(habitMetTarget(h, entries(["a", "2024-01-01"]), "2024-01-01")).toBe(true);
    expect(habitMetTarget(h, [entry("a", "2024-01-01", 0)], "2024-01-01")).toBe(false);
    expect(habitMetTarget(h, [], "2024-01-01")).toBe(false);
  });

  it("a count habit must reach its target", () => {
    const h = habit({ id: "a", target: 8 });
    expect(habitMetTarget(h, [entry("a", "2024-01-01", 7)], "2024-01-01")).toBe(false);
    expect(habitMetTarget(h, [entry("a", "2024-01-01", 8)], "2024-01-01")).toBe(true);
  });

  it("overshooting the target still counts as complete", () => {
    const h = habit({ id: "a", target: 8 });
    expect(habitMetTarget(h, [entry("a", "2024-01-01", 12)], "2024-01-01")).toBe(true);
  });

  it("ignores entries on days the habit is not scheduled", () => {
    const h = habit({ id: "a", schedule: WEEKDAYS });
    expect(habitMetTarget(h, entries(["a", "2024-01-06"]), "2024-01-06")).toBe(false);
  });
});

describe("day scoring", () => {
  const habits = [
    habit({ id: "a" }),
    habit({ id: "b" }),
    habit({ id: "c" }),
    habit({ id: "weekend", schedule: [6, 7] }),
  ];

  it("counts only habits scheduled that day", () => {
    const mondayEntries = entries(["a", "2024-01-01"], ["b", "2024-01-01"]);
    // Monday: the weekend-only habit is not scheduled.
    const monday = scoreDay(habits, mondayEntries, "2024-01-01");
    expect(monday.scheduled).toBe(3);
    expect(monday.completed).toBe(2);
    expect(monday.ratio).toBeCloseTo(2 / 3);

    // Saturday: it is.
    const saturday = scoreDay(habits, mondayEntries, "2024-01-06");
    expect(saturday.scheduled).toBe(4);
    expect(saturday.completed).toBe(0);
    expect(saturday.ratio).toBe(0);
  });

  it("a day with nothing scheduled is not complete and has no ratio", () => {
    const restOnly = habit({ id: "rest", schedule: [6, 7] });
    const monday = scoreDay([restOnly], entries(["rest", "2024-01-06"]), "2024-01-01");
    expect(monday.scheduled).toBe(0);
    expect(monday.ratio).toBeNull();
    expect(monday.complete).toBe(false);
  });

  it("reaching the threshold makes the day complete", () => {
    const many = Array.from({ length: 10 }, (_, i) => habit({ id: `h${i}` }));
    const done = many.map((h) => entry(h.id, "2024-01-01"));
    // 7 of 10 = 0.7, which meets the default threshold exactly.
    expect(isDayComplete(many, done.slice(0, 7), "2024-01-01")).toBe(true);
    expect(isDayComplete(many, done.slice(0, 6), "2024-01-01")).toBe(false);
    expect(isDayComplete(many, done, "2024-01-01", 1)).toBe(true);
  });
});

describe("current streak", () => {
  const h = [habit({ id: "a" })];

  it("counts consecutive complete days ending today", () => {
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
    );
    expect(currentStreak(h, all, { today: "2024-01-03" })).toBe(3);
  });

  it("does not punish an incomplete today, but does judge yesterday", () => {
    const throughYesterday = entries(["a", "2024-01-01"], ["a", "2024-01-02"]);
    // Today unchecked, yesterday done -> streak is 2.
    expect(currentStreak(h, throughYesterday, { today: "2024-01-03" })).toBe(2);
  });

  it("breaks the streak when yesterday was missed", () => {
    // Today is complete but yesterday was missed, so the run is only today.
    const all = entries(["a", "2024-01-01"], ["a", "2024-01-03"]);
    expect(currentStreak(h, all, { today: "2024-01-03" })).toBe(1);
  });

  it("breaks the streak when yesterday was missed and today is unchecked", () => {
    const all = entries(["a", "2024-01-01"], ["a", "2024-01-02"]);
    expect(currentStreak(h, all, { today: "2024-01-04" })).toBe(0);
  });

  it("skips unscheduled days without breaking the run", () => {
    // Mon-Wed only. Today is Saturday, so Thu-Sat are invisible to the streak.
    const monWed = [habit({ id: "a", schedule: [1, 2, 3] })];
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
    );
    expect(currentStreak(monWed, all, { today: "2024-01-06" })).toBe(3);
  });

  it("skips an unscheduled trailing gap", () => {
    // Weekdays only, checked in through Friday, read on Sunday.
    const weekdays = [habit({ id: "a", schedule: WEEKDAYS })];
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
      ["a", "2024-01-04"],
      ["a", "2024-01-05"],
    );
    expect(currentStreak(weekdays, all, { today: "2024-01-07" })).toBe(5);
  });

  it("ignores archived habits", () => {
    const archived = [habit({ id: "a" }), habit({ id: "old", archived_at: "2024-01-01T00:00:00Z" })];
    const all = entries(["a", "2024-01-01"], ["a", "2024-01-02"]);
    expect(currentStreak(archived, all, { today: "2024-01-02" })).toBe(2);
  });

  it("returns zero with no habits or no today", () => {
    expect(currentStreak([], entries(["a", "2024-01-01"]), { today: "2024-01-01" })).toBe(0);
    expect(currentStreak(h, entries(["a", "2024-01-01"]), {})).toBe(0);
  });

  it("does not credit days before the first entry", () => {
    const all = entries(["a", "2024-01-03"], ["a", "2024-01-04"]);
    expect(currentStreak(h, all, { today: "2024-01-04" })).toBe(2);
  });
});

describe("longest streak", () => {
  const h = [habit({ id: "a" })];

  it("finds the best run anywhere in history", () => {
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
      // 04 missed
      ["a", "2024-01-05"],
      ["a", "2024-01-06"],
    );
    const result = computeStreaks(h, all, { today: "2024-01-06" });
    expect(result.longest).toBe(3);
    expect(result.current).toBe(2);
  });

  it("reports where the current run started", () => {
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
      ["a", "2024-01-04"],
    );
    expect(computeStreaks(h, all, { today: "2024-01-04" }).startedOn).toBe("2024-01-01");
  });
});

describe("freeze tokens", () => {
  const h = [habit({ id: "a" })];

  it("a single miss is forgiven when freezes are enabled", () => {
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      // 03 missed but inside one ISO week
      ["a", "2024-01-04"],
    );
    const result = computeStreaks(h, all, {
      today: "2024-01-04",
      freezes: { perWeek: 1 },
    });
    // The forgiven day extends the run: 4 scheduled days, 3 done, 1 frozen.
    expect(result.current).toBe(4);
    expect(result.frozenDays).toBe(1);
  });

  it("a miss breaks the streak when freezes are disabled", () => {
    const all = entries(["a", "2024-01-01"], ["a", "2024-01-04"]);
    // Yesterday (the 3rd) was missed; today is complete.
    expect(currentStreak(h, all, { today: "2024-01-04" })).toBe(1);
  });

  it("only one freeze is granted per ISO week", () => {
    // 2024-01-02 (Tue) and 2024-01-01 (Mon) are both missed and both in 2024-W01.
    const all = entries(
      ["a", "2023-12-31"],
      ["a", "2024-01-03"],
      ["a", "2024-01-04"],
    );
    const result = computeStreaks(h, all, {
      today: "2024-01-04",
      freezes: { perWeek: 1 },
    });
    // The 2nd is forgiven and the run covers the 2nd-4th; the 1st then ends it.
    expect(result.current).toBe(3);
    expect(result.frozenDays).toBe(1);
  });

  it("a miss in a later week gets its own freeze", () => {
    // Weekdays only, so weekends never enter the picture. Wed 03 (W01) and
    // Tue 09 (W02) are missed; each week has its own allowance.
    const weekdays = [habit({ id: "a", schedule: WEEKDAYS })];
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      // 2024-01-03 missed -> W01 freeze
      ["a", "2024-01-04"],
      ["a", "2024-01-05"],
      ["a", "2024-01-08"],
      // 2024-01-09 missed -> W02 freeze
      ["a", "2024-01-10"],
    );
    const result = computeStreaks(weekdays, all, {
      today: "2024-01-10",
      freezes: { perWeek: 1 },
    });
    // Eight scheduled weekdays, two of them forgiven.
    expect(result.current).toBe(8);
    expect(result.frozenDays).toBe(2);
  });
});

describe("backfilled days", () => {
  const h = [habit({ id: "a" })];

  it("a day filled in later counts toward the streak", () => {
    // Only today is present, then the user backfills the previous two days.
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
    );
    expect(currentStreak(h, all, { today: "2024-01-03" })).toBe(3);
  });

  it("backfilling a hole joins two runs", () => {
    const partial = entries(["a", "2024-01-01"], ["a", "2024-01-03"]);
    // Today only; the 2nd is a hole.
    expect(currentStreak(h, partial, { today: "2024-01-03" })).toBe(1);

    const backfilled = [...partial, entry("a", "2024-01-02")];
    expect(currentStreak(h, backfilled, { today: "2024-01-03" })).toBe(3);
  });

  it("a backfilled day before the current run does not inflate it", () => {
    const all = entries(
      ["a", "2024-01-01"],
      ["a", "2024-01-04"],
      ["a", "2024-01-05"],
    );
    expect(currentStreak(h, all, { today: "2024-01-05" })).toBe(2);
  });
});

describe("timezone-driven day boundaries", () => {
  // A habit scheduled every day. The point is that "today" is whatever the
  // user's own timezone says it is, so the day that is still in progress is
  // never counted as a miss.
  const h = [habit({ id: "a" })];

  it("treats the user's local day as in progress, not as a miss", () => {
    // 2024-01-11T18:30Z is already 2024-01-12 in Asia/Kolkata (UTC+5:30).
    const now = new Date("2024-01-11T18:30:00Z");
    const localToday = dayKeyInZone(now, { timeZone: "Asia/Kolkata" });
    expect(localToday).toBe("2024-01-12");

    const all = entries(
      ["a", "2024-01-09"],
      ["a", "2024-01-10"],
      ["a", "2024-01-11"],
    );
    expect(currentStreak(h, all, { today: localToday })).toBe(3);
  });

  it("the same instant yields a different streak depending on the zone", () => {
    const now = new Date("2024-01-11T18:30:00Z");
    // Checked in through the 10th only; the 11th was never ticked.
    const all = entries(["a", "2024-01-09"], ["a", "2024-01-10"]);

    // In Kolkata it is already the 12th, so the 11th is over and was missed.
    const kolkataToday = dayKeyInZone(now, { timeZone: "Asia/Kolkata" });
    expect(kolkataToday).toBe("2024-01-12");
    expect(currentStreak(h, all, { today: kolkataToday })).toBe(0);

    // In UTC the 11th is still in progress, so the run survives it.
    const utcToday = dayKeyInZone(now, { timeZone: "UTC" });
    expect(utcToday).toBe("2024-01-11");
    expect(currentStreak(h, all, { today: utcToday })).toBe(2);
  });

  it("a rollover hour keeps a late-night check-in on the previous day", () => {
    const now = new Date("2024-01-11T20:30:00Z"); // 02:00 IST on the 12th
    expect(dayKeyInZone(now, { timeZone: "Asia/Kolkata", rolloverHour: 3 })).toBe(
      "2024-01-11",
    );
    const all = entries(
      ["a", "2024-01-09"],
      ["a", "2024-01-10"],
      ["a", "2024-01-11"],
    );
    expect(
      currentStreak(h, all, {
        today: dayKeyInZone(now, { timeZone: "Asia/Kolkata", rolloverHour: 3 }),
      }),
    ).toBe(3);
  });
});

describe("ISO week bucketing", () => {
  it("groups days into the same ISO week", () => {
    expect(isoWeek("2024-01-01")).toBe(isoWeek("2024-01-07"));
  });

  it("splits at the week boundary", () => {
    expect(isoWeek("2024-01-07")).not.toBe(isoWeek("2024-01-08"));
  });

  it("handles the ISO year boundary", () => {
    // 2024-12-30 is a Monday in ISO year 2025.
    expect(isoWeek("2024-12-30").startsWith("2025")).toBe(true);
  });
});
describe("archived habits keep explaining the past", () => {
  it("stops counting only from the archived day onward", () => {
    const archived = habit({ id: "a", archived_at: "2024-01-03" });

    // Before the archive it is a normal scheduled habit.
    expect(scheduledHabits([archived], "2024-01-02")).toHaveLength(1);
    // The archive day itself is the first day it no longer counts.
    expect(scheduledHabits([archived], "2024-01-03")).toHaveLength(0);
    expect(scheduledHabits([archived], "2024-01-04")).toHaveLength(0);
  });

  it("counts a run that spans the day before the archive", () => {
    const h = [habit({ id: "a", archived_at: "2024-01-04" })];
    const entries: EntryLike[] = [
      { habit_id: "a", day: "2024-01-01", value: 1 },
      { habit_id: "a", day: "2024-01-02", value: 1 },
      { habit_id: "a", day: "2024-01-03", value: 1 },
    ];

    // Today is an archived day, so it is unscheduled and skipped outright.
    const result = computeStreaks(h, entries, { today: "2024-01-04" });
    expect(result.current).toBe(3);
    expect(result.startedOn).toBe("2024-01-01");
  });

  it("accepts an epoch archived_at as well as a day key", () => {
    const ms = Date.UTC(2024, 0, 3, 12, 0, 0);
    const archived = habit({ id: "a", archived_at: ms });
    expect(archivedFromDay(archived)).toBe("2024-01-03");
    expect(isArchivedOn(archived, "2024-01-02")).toBe(false);
    expect(isArchivedOn(archived, "2024-01-03")).toBe(true);
  });

  it("treats an ISO timestamp as its calendar day", () => {
    const archived = habit({ id: "a", archived_at: "2024-01-03T18:30:00.000Z" });
    expect(archivedFromDay(archived)).toBe("2024-01-03");
  });

  it("keeps an active habit unarchived", () => {
    expect(archivedFromDay(habit({ id: "a" }))).toBeNull();
    expect(isArchivedOn(habit({ id: "a" }), "2024-01-01")).toBe(false);
  });
});

describe("freezes are not spent on an unfinished today", () => {
  it("leaves the freeze allowance intact when today is incomplete", () => {
    const h = [habit({ id: "a" })];
    const entries: EntryLike[] = [
      { habit_id: "a", day: "2024-01-01", value: 1 },
    ];

    // 2024-01-02 is today and has no entry, so it is pending rather than a miss
    // and must not consume the single weekly freeze.
    const result = computeStreaks(h, entries, {
      today: "2024-01-02",
      freezes: { perWeek: 1 },
    });

    expect(result.current).toBe(1);
    expect(result.frozenDays).toBe(0);
  });

  it("still freezes a genuine past miss", () => {
    const h = [habit({ id: "a" })];
    const entries: EntryLike[] = [
      { habit_id: "a", day: "2024-01-01", value: 1 },
      { habit_id: "a", day: "2024-01-03", value: 1 },
    ];

    // 2024-01-02 is in the past and missed, so the freeze covers it.
    const result = computeStreaks(h, entries, {
      today: "2024-01-03",
      freezes: { perWeek: 1 },
    });

    expect(result.current).toBe(3);
    expect(result.frozenDays).toBe(1);
  });
});

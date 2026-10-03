import { describe, it, expect } from "vitest";
import {
  buildHeatmap,
  completionOn,
  consistency,
  habitStats,
  monthGrid,
  periodStats,
  ratioToLevel,
  weekStrip,
} from "@/lib/stats";
import type { EntryLike, HabitLike } from "@/lib/streaks/compute";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

function habit(id: string, overrides: Partial<HabitLike> = {}): HabitLike {
  return { id, schedule: EVERY_DAY, target: null, archived_at: null, ...overrides };
}

/** Build entries from `[habitId, day, value]` rows. */
function rows(...data: [string, string, number?][]): EntryLike[] {
  return data.map(([habit_id, day, value = 1]) => ({ habit_id, day, value }));
}

describe("completionOn", () => {
  const habits = [habit("a"), habit("b"), habit("weekend", { schedule: [6, 7] })];

  it("ignores habits that are not scheduled that day", () => {
    // Monday: the weekend habit is out.
    expect(completionOn(habits, rows(["a", "2024-01-01"]), "2024-01-01")).toEqual({
      completed: 1,
      scheduled: 2,
      ratio: 0.5,
    });
  });

  it("caps count habits at their target", () => {
    const counted = [habit("water", { target: 8 })];
    expect(completionOn(counted, rows(["water", "2024-01-01", 7]), "2024-01-01").ratio).toBe(0);
    expect(completionOn(counted, rows(["water", "2024-01-01", 9]), "2024-01-01").ratio).toBe(1);
  });

  it("reports no ratio when nothing is scheduled", () => {
    const rest = [habit("rest", { schedule: [6, 7] })];
    expect(completionOn(rest, [], "2024-01-01").ratio).toBeNull();
  });
});

describe("ratioToLevel", () => {
  it("buckets ratios into five intensities", () => {
    expect(ratioToLevel(null)).toBe(0);
    expect(ratioToLevel(0)).toBe(0);
    expect(ratioToLevel(0.2)).toBe(1);
    expect(ratioToLevel(0.5)).toBe(2);
    expect(ratioToLevel(0.9)).toBe(3);
    expect(ratioToLevel(1)).toBe(4);
  });
});

describe("periodStats", () => {
  it("averages across days that had something scheduled", () => {
    // A weekday-only habit makes Sat/Sun unscored.
    const weekdays = [habit("a", { schedule: [1, 2, 3, 4, 5] })];
    const entries = rows(
      ["a", "2024-01-01"], // Mon done
      ["a", "2024-01-02"], // Tue done
      // Wed 2024-01-03 missed
      ["a", "2024-01-04"],
      ["a", "2024-01-05"],
    );
    const stats = periodStats({
      habits: weekdays,
      entries,
      from: "2024-01-01",
      to: "2024-01-07",
    });
    expect(stats.daysScored).toBe(5);
    expect(stats.completedSlots).toBe(4);
    expect(stats.scheduledSlots).toBe(5);
    expect(stats.completion).toBeCloseTo(0.8);
    expect(stats.perfectDays).toBe(4);
  });

  it("returns zeroes for an empty range instead of NaN", () => {
    const stats = periodStats({
      habits: [],
      entries: [],
      from: "2024-01-01",
      to: "2024-01-07",
    });
    expect(stats.completion).toBe(0);
    expect(stats.daysScored).toBe(0);
    expect(stats.scheduledSlots).toBe(0);
  });

  it("tracks the best run inside the window", () => {
    const h = [habit("a")];
    const entries = rows(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
      // 04 missed
      ["a", "2024-01-05"],
      ["a", "2024-01-06"],
    );
    const stats = periodStats({ habits: h, entries, from: "2024-01-01", to: "2024-01-06" });
    expect(stats.bestRunInPeriod).toBe(3);
  });

  it("honours a custom threshold for run detection", () => {
    const h = Array.from({ length: 4 }, (_, i) => habit(`h${i}`));
    // 3 of 4 = 0.75, which is below the 0.9 threshold.
    const entries = rows(
      ["h0", "2024-01-01"],
      ["h1", "2024-01-01"],
      ["h2", "2024-01-01"],
    );
    expect(
      periodStats({ habits: h, entries, from: "2024-01-01", to: "2024-01-02", threshold: 0.9 })
        .bestRunInPeriod,
    ).toBe(0);
    expect(
      periodStats({ habits: h, entries, from: "2024-01-01", to: "2024-01-02", threshold: 0.7 })
        .bestRunInPeriod,
    ).toBe(1);
  });
});

describe("habitStats", () => {
  it("sums values and counts recorded days", () => {
    const water = habit("water", { target: 8 });
    const entries = rows(
      ["water", "2024-01-01", 8],
      ["water", "2024-01-02", 6], // below target
      ["water", "2024-01-04", 10],
    );
    const stats = habitStats(water, entries, "2024-01-01", "2024-01-07");
    expect(stats.totalValue).toBe(24);
    expect(stats.daysRecorded).toBe(3);
    expect(stats.completedSlots).toBe(2); // only the 8 and the 10 met target
    expect(stats.completion).toBeCloseTo(2 / 7);
  });

  it("is unaffected by other habits' entries", () => {
    const water = habit("water", { target: 8 });
    const entries = rows(["water", "2024-01-01", 8], ["other", "2024-01-01", 99]);
    expect(habitStats(water, entries, "2024-01-01", "2024-01-01").totalValue).toBe(8);
  });
});

describe("buildHeatmap", () => {
  const habits = [habit("a"), habit("b")];

  it("pads to whole ISO weeks", () => {
    const map = buildHeatmap({
      habits,
      entries: [],
      from: "2024-01-03", // Wednesday
      to: "2024-01-05", // Friday
    });
    // The window spans exactly one week, Monday to Sunday.
    expect(map.weeks).toHaveLength(1);
    expect(map.weeks[0].start).toBe("2024-01-01");
    expect(map.weeks[0].days).toHaveLength(3);
    expect(map.weeks[0].days.map((d) => d.day)).toEqual([
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
    ]);
  });

  it("produces one column per week in a multi-week window", () => {
    const map = buildHeatmap({
      habits,
      entries: [],
      from: "2024-01-01",
      to: "2024-01-21",
    });
    expect(map.weeks).toHaveLength(3);
    expect(map.weeks.map((w) => w.start)).toEqual([
      "2024-01-01",
      "2024-01-08",
      "2024-01-15",
    ]);
  });

  it("assigns colour levels and tallies them", () => {
    const entries = rows(
      ["a", "2024-01-01", 1],
      ["b", "2024-01-01", 1], // full -> level 4
      ["a", "2024-01-02", 1], // half  -> level 2
      // 2024-01-03 nothing -> level 0
    );
    const map = buildHeatmap({ habits, entries, from: "2024-01-01", to: "2024-01-03" });
    const [d1, d2, d3] = map.weeks[0].days;
    expect(d1.level).toBe(4);
    expect(d2.level).toBe(2);
    expect(d3.level).toBe(0);
    expect(map.levels[4]).toBe(1);
    expect(map.levels[2]).toBe(1);
    expect(map.levels[0]).toBe(1);
  });

  it("marks unscheduled days inactive but still renders them", () => {
    const rest = [habit("rest", { schedule: [6, 7] })];
    const map = buildHeatmap({
      habits: rest,
      entries: [],
      from: "2024-01-01",
      to: "2024-01-07",
    });
    const monday = map.weeks[0].days[0];
    expect(monday.active).toBe(false);
    expect(monday.level).toBe(0);
    expect(monday.scheduled).toBe(0);
  });
});

describe("weekStrip", () => {
  it("always returns seven days starting on Monday", () => {
    const strip = weekStrip([habit("a")], [], "2024-01-04");
    expect(strip).toHaveLength(7);
    expect(strip[0].day).toBe("2024-01-01");
    expect(strip[6].day).toBe("2024-01-07");
    expect(strip.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("flags today and the future", () => {
    const strip = weekStrip([habit("a")], [], "2024-01-04");
    expect(strip[0].isFuture).toBe(false);
    expect(strip[3].isToday).toBe(true);
    expect(strip[6].isFuture).toBe(true);
    expect(strip.filter((d) => d.isFuture)).toHaveLength(3);
  });

  it("reflects how full each day was", () => {
    const h = [habit("a"), habit("b")];
    const strip = weekStrip(
      h,
      rows(["a", "2024-01-01", 1], ["b", "2024-01-01", 1], ["a", "2024-01-02", 1]),
      "2024-01-07",
    );
    expect(strip[0].level).toBe(4);
    expect(strip[1].level).toBe(2);
    expect(strip[2].level).toBe(0);
  });
});

describe("monthGrid", () => {
  it("labels the month and marks its days", () => {
    const grid = monthGrid([habit("a")], [], "2024-02-14", "2024-02-14");
    expect(grid.monthLabel).toBe("February 2024");
    // 2024 is a leap year, so 29 days.
    expect(grid.monthDays.size).toBe(29);
    expect(grid.weeks).toHaveLength(6);
    expect(grid.monthDays.has("2024-02-29")).toBe(true);
    expect(grid.monthDays.has("2024-03-01")).toBe(false);
  });

  it("starts the grid on the Monday of the first week", () => {
    // 1 March 2024 is a Friday, so the grid starts on 26 February.
    const grid = monthGrid([habit("a")], [], "2024-03-15", "2024-03-15");
    expect(grid.weeks[0][0].day).toBe("2024-02-26");
    expect(grid.monthLabel).toBe("March 2024");
    expect(grid.monthDays.size).toBe(31);
  });

  it("handles a month that starts on a Monday", () => {
    // 1 April 2024 is a Monday.
    const grid = monthGrid([habit("a")], [], "2024-04-10", "2024-04-10");
    expect(grid.weeks[0][0].day).toBe("2024-04-01");
    expect(grid.monthDays.size).toBe(30);
  });
});

describe("consistency", () => {
  it("computes rolling windows", () => {
    const h = [habit("a")];
    const entries = rows(
      ["a", "2024-01-01"],
      ["a", "2024-01-02"],
      ["a", "2024-01-03"],
    );
    const result = consistency(h, entries, "2024-01-03");
    expect(result.last7).toBeCloseTo(3 / 7);
    expect(result.last30).toBeCloseTo(3 / 30);
    expect(result.total).toBe(1); // only the three recorded days are in range
  });

  it("is safe with no data at all", () => {
    const result = consistency([], [], "2024-01-03");
    expect(result.last7).toBe(0);
    expect(result.total).toBe(0);
  });
});
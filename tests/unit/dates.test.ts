import { describe, it, expect } from "vitest";
import {
  addDays,
  dayKeyInZone,
  dayKeyToDate,
  diffInDays,
  endOfMonth,
  formatDayKey,
  isRealDayKey,
  isoWeekday,
  isValidTimeZone,
  lastNDays,
  rangeDays,
  relativeLabel,
  startOfMonth,
  startOfWeek,
  todayLocal,
  tzOffsetMinutes,
  weekdayShort,
} from "@/lib/dates";

describe("day key arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2024-01-31", 1)).toBe("2024-02-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2024-01-01", -1)).toBe("2023-12-31");
  });

  it("rejects impossible calendar dates", () => {
    expect(isRealDayKey("2024-02-29")).toBe(true);
    expect(isRealDayKey("2023-02-29")).toBe(false);
    expect(isRealDayKey("2024-13-01")).toBe(false);
    expect(isRealDayKey("2024-1-01")).toBe(false);
  });

  it("computes ISO weekday with Monday = 1", () => {
    expect(isoWeekday("2024-01-01")).toBe(1); // Monday
    expect(isoWeekday("2024-01-07")).toBe(7); // Sunday
    expect(weekdayShort("2024-01-07")).toBe("Sun");
  });

  it("diffs and ranges days", () => {
    expect(diffInDays("2024-01-01", "2024-01-31")).toBe(30);
    expect(diffInDays("2024-02-28", "2024-03-01")).toBe(2); // leap year
    expect(rangeDays("2024-01-30", "2024-02-02")).toEqual([
      "2024-01-30",
      "2024-01-31",
      "2024-02-01",
      "2024-02-02",
    ]);
    expect(rangeDays("2024-01-03", "2024-01-01")).toEqual([]);
  });

  it("finds week and month boundaries", () => {
    expect(startOfWeek("2024-01-04")).toBe("2024-01-01"); // Thursday -> Monday
    expect(startOfWeek("2024-01-07")).toBe("2024-01-01"); // Sunday still same week
    expect(startOfWeek("2024-01-08")).toBe("2024-01-08"); // next Monday
    expect(startOfMonth("2024-02-14")).toBe("2024-02-01");
    expect(endOfMonth("2024-02-14")).toBe("2024-02-29");
    expect(endOfMonth("2023-02-14")).toBe("2023-02-28");
  });

  it("builds trailing windows oldest-first", () => {
    expect(lastNDays("2024-01-03", 3)).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });

  it("formats and labels relative to today", () => {
    expect(formatDayKey("2024-03-05")).toBe("05 Mar");
    expect(formatDayKey("2024-03-05", { year: true })).toBe("05 Mar 2024");
    expect(relativeLabel("2024-03-05", "2024-03-05")).toBe("Today");
    expect(relativeLabel("2024-03-04", "2024-03-05")).toBe("Yesterday");
    expect(relativeLabel("2024-03-06", "2024-03-05")).toBe("Tomorrow");
    expect(relativeLabel("2024-03-03", "2024-03-05")).toBe("Sun, 03 Mar");
  });
});

describe("timezone resolution", () => {
  const kolkata = { timeZone: "Asia/Kolkata" };
  const newYork = { timeZone: "America/New_York" };

  it("rejects unknown zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(() => dayKeyInZone(new Date(), { timeZone: "Mars/Olympus" })).toThrow();
  });

  it("resolves the same instant to different days per zone", () => {
    // 2024-01-15T19:00Z: Kolkata is already the 16th, New York is still the 15th.
    const now = new Date("2024-01-15T19:00:00Z");
    expect(dayKeyInZone(now, kolkata)).toBe("2024-01-16");
    expect(dayKeyInZone(now, newYork)).toBe("2024-01-15");
  });

  it("handles a negative UTC offset crossing backwards over midnight", () => {
    // 2024-01-15T02:00Z: New York is still the 14th.
    const now = new Date("2024-01-15T02:00:00Z");
    expect(dayKeyInZone(now, newYork)).toBe("2024-01-14");
    expect(dayKeyInZone(now, kolkata)).toBe("2024-01-15");
  });

  it("honours the rollover hour for night owls", () => {
    const opts = { timeZone: "Asia/Kolkata", rolloverHour: 3 };
    // 18:00 IST on the 15th is still "the 15th" at any rollover up to 18.
    expect(dayKeyInZone(new Date("2024-01-15T12:30:00Z"), opts)).toBe("2024-01-15");
    // 02:00 IST on the 16th belongs to the 15th when the day ends at 3am.
    expect(dayKeyInZone(new Date("2024-01-15T20:30:00Z"), opts)).toBe("2024-01-15");
    // 04:00 IST on the 16th is genuinely the 16th.
    expect(dayKeyInZone(new Date("2024-01-15T22:30:00Z"), opts)).toBe("2024-01-16");
  });

  it("a rollover of 0 is plain local midnight", () => {
    expect(todayLocal({ timeZone: "UTC" }, new Date("2024-06-01T23:59:59Z"))).toBe(
      "2024-06-01",
    );
    expect(todayLocal({ timeZone: "UTC" }, new Date("2024-06-02T00:00:00Z"))).toBe(
      "2024-06-02",
    );
  });
});

describe("daylight saving transitions", () => {
  const newYork = { timeZone: "America/New_York" };

  it("spring forward: the day still exists exactly once", () => {
    // DST starts 2024-03-10 at 02:00 local. 2024-03-09T23:30 local is the 9th.
    expect(dayKeyInZone(new Date("2024-03-10T04:30:00Z"), newYork)).toBe("2024-03-09");
    // 03:30 local on the 10th is already EDT.
    expect(dayKeyInZone(new Date("2024-03-10T07:30:00Z"), newYork)).toBe("2024-03-10");
    expect(dayKeyInZone(new Date("2024-03-11T03:30:00Z"), newYork)).toBe("2024-03-10");
    expect(dayKeyInZone(new Date("2024-03-11T04:30:00Z"), newYork)).toBe("2024-03-11");
  });

  it("fall back: the repeated hour keeps one day key", () => {
    // DST ends 2024-11-03. Both 01:30 passes local are the 3rd.
    expect(dayKeyInZone(new Date("2024-11-03T05:30:00Z"), newYork)).toBe("2024-11-03");
    expect(dayKeyInZone(new Date("2024-11-03T06:30:00Z"), newYork)).toBe("2024-11-03");
  });

  it("reports the offset shift across a transition", () => {
    expect(tzOffsetMinutes(newYork.timeZone, new Date("2024-01-15T12:00:00Z"))).toBe(-300);
    expect(tzOffsetMinutes(newYork.timeZone, new Date("2024-07-15T12:00:00Z"))).toBe(-240);
  });

  it("converts a day key back to the correct instant in that zone", () => {
    const winterStart = dayKeyToDate("2024-03-10", newYork.timeZone);
    expect(winterStart.toISOString()).toBe("2024-03-10T05:00:00.000Z");

    const summerStart = dayKeyToDate("2024-07-01", newYork.timeZone);
    expect(summerStart.toISOString()).toBe("2024-07-01T04:00:00.000Z");

    // Round-trips back to the same local day.
    for (const key of ["2024-03-10", "2024-11-03", "2024-07-01", "2024-01-01"]) {
      expect(dayKeyInZone(dayKeyToDate(key, newYork.timeZone), newYork)).toBe(key);
    }
  });

  it("changing the device timezone does not change the stored day", () => {
    // A check-in made at 20:00 IST on the 10th stays "2024-03-10" even if the
    // user later flies to Los Angeles.
    const checkedInAt = new Date("2024-03-10T14:30:00Z");
    const ist = dayKeyInZone(checkedInAt, { timeZone: "Asia/Kolkata" });
    const laterRead = dayKeyInZone(new Date("2024-03-10T18:00:00Z"), {
      timeZone: "America/Los_Angeles",
    });
    expect(ist).toBe("2024-03-10");
    // The user's profile timezone, not the device, is what resolves the day.
    expect(dayKeyInZone(new Date("2024-03-10T18:00:00Z"), { timeZone: "Asia/Kolkata" })).toBe(
      ist,
    );
    expect(laterRead).toBe("2024-03-10");
  });
});
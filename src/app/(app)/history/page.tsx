"use client";

import { useMemo, useState } from "react";
import {
  WEEKDAY_SHORT,
  addDays,
  formatDayKey,
  relativeLabel,
  startOfMonth,
  todayInZone,
} from "@/lib/dates";
import { buildHeatmap, monthGrid, periodStats } from "@/lib/stats";
import { entryValue, habitMetTarget, scheduledHabits } from "@/lib/streaks/compute";
import { useLocalSnapshot } from "@/hooks/useLocalSnapshot";

const RANGES = [
  { id: "4w", label: "4 weeks", days: 28 },
  { id: "12w", label: "12 weeks", days: 84 },
  { id: "26w", label: "6 months", days: 182 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

export default function HistoryPage() {
  const today = todayInZone(
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC",
  );
  const [rangeId, setRangeId] = useState<RangeId>("12w");
  const [cursor, setCursor] = useState<string | null>(null);

  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1];
  const from = useMemo(() => addDays(today, -(range.days - 1)), [today, range.days]);
  const to = today;

  const { habits, entries, loading } = useLocalSnapshot(from, to);

  const summary = useMemo(
    () => periodStats({ habits, entries, from, to }),
    [habits, entries, from, to],
  );

  const heatmap = useMemo(
    () => buildHeatmap({ habits, entries, from, to }),
    [habits, entries, from, to],
  );

  const calendar = useMemo(
    () => monthGrid(habits, entries, cursor ?? today, today),
    [habits, entries, cursor, today],
  );

  const selected = cursor ?? today;
  // scheduledHabits works on the narrow streak shape; keep the concrete Habit
  // rows so each day can show its name, unit and target.
  const selectedHabits = useMemo(() => {
    const scheduled = new Set(scheduledHabits(habits, selected).map((h) => h.id));
    return habits.filter((h) => scheduled.has(h.id));
  }, [habits, selected]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <div
          role="group"
          aria-label="Date range"
          className="inline-flex rounded-lg border p-0.5"
        >
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setRangeId(option.id)}
              aria-pressed={rangeId === option.id}
              className={`h-9 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                rangeId === option.id ? "bg-accent font-medium" : "text-muted-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <section
        aria-label="Period summary"
        className="mb-6 grid grid-cols-3 gap-3"
      >
        <Stat label="Completion" value={`${Math.round(summary.completion * 100)}%`} />
        <Stat label="Perfect days" value={String(summary.perfectDays)} />
        <Stat label="Best run" value={`${summary.bestRunInPeriod}d`} />
      </section>

      <section aria-label="Activity heatmap" className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          {formatDayKey(from, { style: "medium" })} –{" "}
          {formatDayKey(to, { style: "medium" })}
        </h2>
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-1" style={{ minWidth: heatmap.weeks.length * 14 }}>
            {heatmap.weeks.map((week) => (
              <div key={week.start} className="flex flex-col gap-1">
                {Array.from({ length: 7 }, (_, i) => {
                  const cell = week.days[i];
                  if (!cell) {
                    return <span key={i} className="h-3 w-3 rounded-sm" />;
                  }
                  return (
                    <span
                      key={cell.day}
                      title={`${cell.day}: ${cell.completed}/${cell.scheduled}`}
                      className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[cell.level]}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span>Less</span>
          {LEVEL_CLASS.map((className) => (
            <span key={className} className={`h-3 w-3 rounded-sm ${className}`} />
          ))}
          <span>More</span>
        </div>
      </section>

      <section aria-label="Month view" className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">{calendar.monthLabel}</h2>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setCursor(monthStep(cursor ?? today, -1))}
              className="h-9 rounded-lg border px-3 text-sm hover:bg-accent"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setCursor(monthStep(cursor ?? today, 1))}
              className="h-9 rounded-lg border px-3 text-sm hover:bg-accent"
            >
              ›
            </button>
          </div>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {WEEKDAY_SHORT.map((label) => (
            <span key={label}>{label.slice(0, 1)}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendar.weeks.flat().map((day) => (
            <button
              key={day.day}
              type="button"
              onClick={() => setCursor(day.day)}
              aria-pressed={selected === day.day}
              aria-label={`${day.day}, ${day.completed} of ${day.scheduled} done`}
              className={`aspect-square rounded-lg border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                calendar.monthDays.has(day.day) ? "" : "opacity-30"
              } ${LEVEL_SOLID[day.level]} ${
                selected === day.day ? "ring-2 ring-ring ring-offset-1" : ""
              }`}
            >
              {Number(day.day.slice(8, 10))}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Selected day">
        <h2 className="mb-2 text-sm font-medium">
          {relativeLabel(selected, today)}
        </h2>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : selectedHabits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing was scheduled on this day.
          </p>
        ) : (
          <ul className="space-y-2">
            {selectedHabits.map((habit) => {
              const value = entryValue(habit.id, entries, selected);
              const met = habitMetTarget(habit, entries, selected);
              return (
                <li
                  key={habit.id}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                      met ? "bg-primary text-primary-foreground" : "border"
                    }`}
                  >
                    {met ? "✓" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{habit.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {habit.target
                        ? `${value} of ${habit.target}${habit.unit ? ` ${habit.unit}` : ""}`
                        : value > 0
                          ? "Done"
                          : "Not done"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Move a day key by whole months, clamping to the end of a shorter month. */
function monthStep(day: string, delta: number): string {
  const start = startOfMonth(day);
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7)) - 1 + delta;
  const target = new Date(Date.UTC(year, month, 1));
  const nextYear = target.getUTCFullYear();
  const nextMonth = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const wanted = Number(day.slice(8, 10));
  const clamped = Math.min(wanted, lastDay);
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

const LEVEL_CLASS = [
  "bg-muted/40",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

const LEVEL_SOLID = [
  "bg-card text-muted-foreground",
  "bg-primary/15",
  "bg-primary/35",
  "bg-primary/60",
  "bg-primary text-primary-foreground",
] as const;

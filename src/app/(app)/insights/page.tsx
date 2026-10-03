"use client";

import { useMemo, useState } from "react";
import { addDays, formatDayKey, todayInZone } from "@/lib/dates";
import { consistency, habitStats, periodStats } from "@/lib/stats";
import { computeStreaks } from "@/lib/streaks/compute";
import { useLocalSnapshot } from "@/hooks/useLocalSnapshot";

const WINDOWS = [
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "1 year", days: 365 },
] as const;

type WindowId = (typeof WINDOWS)[number]["id"];

export default function InsightsPage() {
  const today = todayInZone(
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC",
  );
  const [windowId, setWindowId] = useState<WindowId>("30");

  const window = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[0];
  const from = useMemo(() => addDays(today, -(window.days - 1)), [today, window.days]);

  const { habits, entries, loading } = useLocalSnapshot(from, today);

  const overall = useMemo(
    () => periodStats({ habits, entries, from, to: today }),
    [habits, entries, from, today],
  );

  const rolling = useMemo(
    () => consistency(habits, entries, today),
    [habits, entries, today],
  );

  const streaks = useMemo(
    () => computeStreaks(habits, entries, { today }),
    [habits, entries, today],
  );

  const perHabit = useMemo(
    () =>
      habits
        .filter((h) => !h.archived_at)
        .map((habit) => ({
          habit,
          stats: habitStats(habit, entries, from, today),
        }))
        // Strongest first: the habits that are actually working lead.
        .sort((a, b) => b.stats.completion - a.stats.completion),
    [habits, entries, from, today],
  );

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">Crunching your numbers…</p>
      </div>
    );
  }

  if (habits.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Add a habit and check in for a few days. Patterns show up here once
            there is something to look at.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <div
          role="group"
          aria-label="Time window"
          className="inline-flex rounded-lg border p-0.5"
        >
          {WINDOWS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setWindowId(option.id)}
              aria-pressed={windowId === option.id}
              className={`h-9 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                windowId === option.id ? "bg-accent font-medium" : "text-muted-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <section aria-label="Overall" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Completion"
          value={`${Math.round(overall.completion * 100)}%`}
          hint={`${overall.completedSlots} of ${overall.scheduledSlots} slots`}
        />
        <Metric
          label="Perfect days"
          value={String(overall.perfectDays)}
          hint={`of ${overall.daysScored} scored`}
        />
        <Metric
          label="Current streak"
          value={`${streaks.current}d`}
          hint={streaks.startedOn ? `since ${formatDayKey(streaks.startedOn, { style: "medium" })}` : "no run yet"}
        />
        <Metric
          label="Longest run"
          value={`${streaks.longest}d`}
          hint={streaks.frozenDays > 0 ? `${streaks.frozenDays} frozen` : "no freezes used"}
        />
      </section>

      <section aria-label="Rolling completion" className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Rolling completion
        </h2>
        <div className="space-y-2">
          <Bar label="Last 7 days" value={rolling.last7} />
          <Bar label="Last 30 days" value={rolling.last30} />
          <Bar label="Last 90 days" value={rolling.last90} />
          <Bar label="All time" value={rolling.total} />
        </div>
      </section>

      <section aria-label="Per habit">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          {formatDayKey(from, { style: "medium" })} – {formatDayKey(today, { style: "medium" })}
        </h2>

        {perHabit.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active habits in this window.
          </p>
        ) : (
          <ul className="space-y-3">
            {perHabit.map(({ habit, stats }) => (
              <li key={habit.id} className="rounded-xl border bg-card p-3">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="truncate font-medium">{habit.name}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                    {Math.round(stats.completion * 100)}%
                  </p>
                </div>

                <Meter value={stats.completion} />

                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">Days logged</dt>{" "}
                    <dd className="inline tabular-nums">{stats.daysRecorded}</dd>
                  </div>
                  <div>
                    <dt className="inline">Total</dt>{" "}
                    <dd className="inline tabular-nums">
                      {stats.totalValue}
                      {habit.unit ? ` ${habit.unit}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Best run</dt>{" "}
                    <dd className="inline tabular-nums">{stats.bestRunInPeriod}d</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">
        <Meter value={value} />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
        {pct}%
      </span>
    </div>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDayKey, isValidTimeZone, todayLocal } from "@/lib/dates";
import {
  computeStreaks,
  entryValue,
  habitMetTarget,
  scheduledHabits,
} from "@/lib/streaks/compute";
import { getUser } from "@/lib/supabase/auth";
import { scheduleSync } from "@/lib/sync/engine";
import { incrementEntry, setEntryValue, toggleTick } from "@/lib/db/queries";
import { useLocalSnapshot } from "@/hooks/useLocalSnapshot";
import type { Habit } from "@/lib/db/db";

const KIND_LABEL: Record<Habit["kind"], string> = {
  tick: "Simple check",
  count: "Counter",
  duration: "Timer",
  number: "Numeric",
};

/** The device timezone, falling back to UTC if the runtime cannot name one. */
function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** Resolve the signed-in user id, or null while signed out. */
function useUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getUser().then((user) => {
      if (active) setUserId(user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  return userId;
}

export default function TodayPage() {
  // A user-selected timezone arrives once the profile is cached; until then the
  // device zone is the best available answer.
  const [timeZone] = useState(deviceTimeZone);
  const today = todayLocal({ timeZone });
  const userId = useUserId();
  const { habits, entries, loading } = useLocalSnapshot(today, today);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // scheduledHabits works on the narrow streak shape; keep the concrete Habit
  // objects so each row can still render its name, unit and kind.
  const todays = useMemo(() => {
    const scheduled = new Set(scheduledHabits(habits, today).map((h) => h.id));
    return habits.filter((h) => scheduled.has(h.id));
  }, [habits, today]);

  const streaks = useMemo(
    () => computeStreaks(habits, entries, { today }),
    [habits, entries, today],
  );

  const doneCount = todays.filter((h) => habitMetTarget(h, entries, today)).length;

  async function commit(run: () => Promise<void>, habitName: string) {
    setPendingId(habitName);
    try {
      await run();
      // Local write already succeeded, so queue it for the background sync
      // instead of blocking the tap on the network.
      scheduleSync();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save that check-in",
      );
    } finally {
      setPendingId(null);
    }
  }

  function handleTick(habit: Habit) {
    return commit(
      async () => {
        if (!userId) throw new Error("Sign in to save check-ins");
        await toggleTick(habit.id, today, userId);
      },
      habit.id,
    );
  }

  function handleStep(habit: Habit, delta: number) {
    return commit(
      async () => {
        if (!userId) throw new Error("Sign in to save check-ins");
        await incrementEntry(habit.id, today, delta, userId);
      },
      habit.id,
    );
  }

  function handleCount(habit: Habit, value: number) {
    return commit(
      async () => {
        if (!userId) throw new Error("Sign in to save check-ins");
        await setEntryValue(habit.id, today, value, userId);
      },
      habit.id,
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">
          {formatDayKey(today, { weekday: true, style: "medium" })}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Today</h1>
      </header>

      <section
        aria-label="Daily summary"
        className="mb-6 grid grid-cols-3 gap-3"
      >
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Done</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {doneCount}
            <span className="text-sm font-normal text-muted-foreground">
              /{todays.length}
            </span>
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Streak</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {streaks.current}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              day{streaks.current === 1 ? "" : "s"}
            </span>
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Best</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {streaks.longest}
          </p>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your habits…</p>
      ) : todays.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-base font-medium">Nothing scheduled today</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add a habit and pick the days it should appear on.
          </p>
          <Link
            href="/habits"
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add a habit
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {todays.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              value={entryValue(habit.id, entries, today)}
              busy={pendingId === habit.id}
              onTick={handleTick}
              onStep={handleStep}
              onCount={handleCount}
            />
          ))}
        </ul>
      )}

      {habits.length > 0 && todays.length < habits.length ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {habits.length - todays.length} habit
          {habits.length - todays.length === 1 ? " is" : "s are"} not scheduled
          today.
        </p>
      ) : null}
    </div>
  );
}

interface HabitRowProps {
  habit: Habit;
  value: number;
  busy: boolean;
  onTick: (habit: Habit) => void;
  onStep: (habit: Habit, delta: number) => void;
  onCount: (habit: Habit, value: number) => void;
}

function HabitRow({ habit, value, busy, onTick, onStep, onCount }: HabitRowProps) {
  const done = habit.target && habit.target > 0 ? value >= habit.target : value > 0;

  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{habit.name}</p>
        <p className="text-xs text-muted-foreground">
          {KIND_LABEL[habit.kind]}
          {habit.unit ? ` (${habit.unit})` : ""}
          {habit.target ? ` · target ${habit.target}` : ""}
        </p>
      </div>

      {habit.kind === "tick" ? (
        <button
          type="button"
          onClick={() => onTick(habit)}
          disabled={busy}
          aria-pressed={done}
          aria-label={`${done ? "Undo" : "Check in"} ${habit.name}`}
          className={`h-11 w-11 shrink-0 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${
            done
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input hover:border-primary"
          }`}
        >
          <span aria-hidden="true">{done ? "✓" : ""}</span>
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Stepper
            label="−"
            onClick={() => onStep(habit, -1)}
            disabled={busy || value <= 0}
          />
          <input
            type="number"
            inputMode="decimal"
            value={Number.isFinite(value) ? value : 0}
            step={habit.kind === "duration" ? 5 : 1}
            min={0}
            aria-label={`${habit.name} value`}
            onChange={(event) => onCount(habit, Number(event.target.value))}
            className="h-11 w-16 rounded-lg border bg-background text-center text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Stepper
            label="+"
            onClick={() => onStep(habit, habit.kind === "duration" ? 5 : 1)}
            disabled={busy}
          />
        </div>
      )}
    </li>
  );
}

function Stepper({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === "+" ? "Increase" : "Decrease"}
      className="h-11 w-11 rounded-lg border text-lg leading-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      {label}
    </button>
  );
}
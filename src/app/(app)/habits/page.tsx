"use client";

import { useState } from "react";
import { toast } from "sonner";
import { WEEKDAY_SHORT } from "@/lib/dates";
import { getUser } from "@/lib/supabase/auth";
import { scheduleSync } from "@/lib/sync/engine";
import {
  archiveHabit,
  createHabit,
  deleteHabit,
  restoreHabit,
  updateHabit,
} from "@/lib/db/queries";
import { useLocalSnapshot } from "@/hooks/useLocalSnapshot";
import type { Habit, HabitKind } from "@/lib/db/db";

const KINDS: { value: HabitKind; label: string; hint: string }[] = [
  { value: "tick", label: "Check off", hint: "Done or not done" },
  { value: "count", label: "Count", hint: "e.g. 8 reps" },
  { value: "duration", label: "Duration", hint: "e.g. 20 minutes" },
  { value: "number", label: "Number", hint: "e.g. 3 pages" },
];

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

export default function HabitsPage() {
  const { habits, loading } = useLocalSnapshot();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = habits.filter((h) => (showArchived ? !!h.archived_at : !h.archived_at));

  async function run(action: () => Promise<void>, message: string) {
    try {
      await action();
      scheduleSync();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    }
  }

  async function handleCreate(draft: Parameters<typeof createHabit>[0]) {
    const user = await getUser();
    await run(async () => {
      await createHabit(draft, user?.id ?? null);
      setCreating(false);
    }, "Habit added");
  }

  async function handleArchive(habit: Habit) {
    await run(() => archiveHabit(habit.id), `${habit.name} archived`);
  }

  async function handleRestore(habit: Habit) {
    await run(() => restoreHabit(habit.id), `${habit.name} restored`);
  }

  async function handleDelete(habit: Habit) {
    // Soft delete: the row stays on the server and its history stays visible.
    await run(() => deleteHabit(habit.id), `${habit.name} deleted`);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Habits</h1>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditing(null);
          }}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          New habit
        </button>
      </header>

      <div
        role="group"
        aria-label="Filter habits"
        className="mb-4 inline-flex rounded-lg border p-0.5"
      >
        <FilterButton active={!showArchived} onClick={() => setShowArchived(false)}>
          Active
        </FilterButton>
        <FilterButton active={showArchived} onClick={() => setShowArchived(true)}>
          Archived
        </FilterButton>
      </div>

      {creating ? (
        <HabitForm
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      ) : null}

      {editing ? (
        <HabitForm
          habit={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (patch) => {
            await run(() => updateHabit(editing.id, patch), "Habit updated");
            setEditing(null);
          }}
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {showArchived ? "Nothing archived." : "No habits yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((habit) => (
            <li
              key={habit.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{habit.name}</p>
                <p className="text-xs text-muted-foreground">
                  {KINDS.find((k) => k.value === habit.kind)?.label}
                  {habit.unit ? ` · ${habit.unit}` : ""}
                  {habit.target ? ` · target ${habit.target}` : ""}
                  {" · "}
                  {habit.schedule.length === 7
                    ? "Every day"
                    : habit.schedule.map((d) => WEEKDAY_SHORT[d - 1]).join(", ")}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                {!showArchived ? (
                  <>
                    <SmallButton onClick={() => setEditing(habit)}>Edit</SmallButton>
                    <SmallButton onClick={() => handleArchive(habit)}>Archive</SmallButton>
                  </>
                ) : (
                  <>
                    <SmallButton onClick={() => handleRestore(habit)}>Restore</SmallButton>
                    <SmallButton tone="danger" onClick={() => handleDelete(habit)}>
                      Delete
                    </SmallButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface HabitFormProps {
  habit?: Habit;
  onSubmit: (patch: {
    name: string;
    kind: HabitKind;
    unit: string | null;
    target: number | null;
    schedule: number[];
  }) => Promise<void>;
  onCancel: () => void;
}

function HabitForm({ habit, onSubmit, onCancel }: HabitFormProps) {
  const [name, setName] = useState(habit?.name ?? "");
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? "tick");
  const [target, setTarget] = useState(String(habit?.target ?? ""));
  const [unit, setUnit] = useState(habit?.unit ?? "");
  const [schedule, setSchedule] = useState<number[]>(habit?.schedule ?? EVERY_DAY);
  const [busy, setBusy] = useState(false);

  const needsTarget = kind !== "tick";

  function toggleDay(day: number) {
    setSchedule((current) => {
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b);
      // An empty schedule would never show up in Today, so keep one selected.
      return next.length === 0 ? current : next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the habit a name");
      return;
    }

    setBusy(true);
    try {
      const parsed = Number(target);
      await onSubmit({
        name: trimmed,
        kind,
        target: needsTarget && target !== "" && Number.isFinite(parsed) ? parsed : null,
        unit: unit.trim() || null,
        schedule,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-4 rounded-xl border bg-card p-4">
      <h2 className="font-medium">{habit ? "Edit habit" : "New habit"}</h2>

      <div>
        <label htmlFor="habit-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input
          id="habit-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          className="h-11 w-full rounded-lg border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Type</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-lg border p-2 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                kind === option.value ? "border-primary bg-accent" : ""
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="sr-only"
              />
              <span className="block font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">
                {option.hint}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {needsTarget ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="habit-target" className="mb-1 block text-sm font-medium">
              Daily target
            </label>
            <input
              id="habit-target"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-11 w-full rounded-lg border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="habit-unit" className="mb-1 block text-sm font-medium">
              Unit
            </label>
            <input
              id="habit-unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              maxLength={16}
              placeholder="minutes"
              className="h-11 w-full rounded-lg border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      ) : null}

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Repeat</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_SHORT.map((label, index) => {
            const day = index + 1;
            const active = schedule.includes(day);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={active}
                className={`h-10 min-w-12 rounded-lg border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save habit"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "bg-accent font-medium" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  children,
  tone = "default",
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone === "danger" ? "text-destructive hover:bg-destructive/10" : "hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
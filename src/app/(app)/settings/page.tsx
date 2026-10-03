"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isValidTimeZone } from "@/lib/dates";
import { DEFAULT_STREAK_THRESHOLD } from "@/lib/streaks/compute";
import {
  clearLocalData,
  getCachedProfile,
  listDays,
  listEntries,
  listHabits,
  saveProfile,
} from "@/lib/db/queries";
import { deleteAccount, getUser, signOut } from "@/lib/supabase/auth";
import { outboxSummary, retryFailed } from "@/lib/sync/queue";
import type { Profile } from "@/lib/db/db";

const THRESHOLDS = [0.5, 0.7, 0.8, 1] as const;
const ROLLOVER_HOURS = [0, 2, 3, 4] as const;

export default function SettingsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => {
    void getUser().then((user) => setUserId(user?.id ?? null));
    void getCachedProfile().then(setProfile);
    void refreshOutbox();
  }, []);

  async function refreshOutbox() {
    const summary = await outboxSummary();
    setPending(summary.pending);
    setFailed(summary.failed);
  }

  const save = useMemo(
    () => async (patch: Partial<Profile>) => {
      const current = profile;
      if (!current) return;
      const next: Profile = { ...current, ...patch };
      setProfile(next);
      try {
        await saveProfile({
          id: next.id,
          tz: next.tz,
          theme: next.theme,
          rollover_hour: next.rollover_hour,
          streak_threshold: next.streak_threshold,
          freeze_per_week: next.freeze_per_week,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save");
      }
    },
    [profile],
  );

  async function handleExport() {
    setBusy(true);
    try {
      const [habits, entries, days] = await Promise.all([
        listHabits({ includeArchived: true, includeDeleted: true }),
        listEntries(),
        listDays(),
      ]);
      // The export is written out field by field rather than by stripping keys:
      // it is a published format, so an internal column showing up here would
      // become an accidental part of the contract. Sync bookkeeping is omitted.
      const payload = {
        exported_at: new Date().toISOString(),
        version: 1,
        habits: habits.map((h) => ({
          id: h.id,
          name: h.name,
          icon: h.icon,
          group: h.grp,
          kind: h.kind,
          unit: h.unit,
          target: h.target,
          schedule: h.schedule,
          sort: h.sort,
          archived_at: h.archived_at,
          deleted: h.deleted,
        })),
        entries: entries.map((e) => ({
          habit_id: e.habit_id,
          day: e.day,
          value: e.value,
          note: e.note,
        })),
        days: days.map((d) => ({
          day: d.day,
          mood: d.mood,
          note: d.note,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ticklab-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Signing out always clears the server session, but what happens to the local
   * copy is the user's call: someone on a shared device wants the rows gone,
   * someone signing out to switch accounts wants them kept so the merge can
   * re-own them. Clearing unconditionally, as this used to, silently threw away
   * unsynced work.
   */
  async function handleSignOut(removeLocalData: boolean) {
    setBusy(true);
    try {
      await signOut();
      if (removeLocalData) await clearLocalData();
      toast.success(removeLocalData ? "Signed out and cleared this device" : "Signed out");
      router.push("/login");
    } finally {
      setBusy(false);
      setConfirmingSignOut(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const result = await deleteAccount();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.push("/");
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  const zone = profile?.tz ?? "";
  const zoneValid = zone === "" || isValidTimeZone(zone);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>

      <section aria-label="Account" className="mb-8 rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-medium">Account</h2>
        {userId ? (
          <>
            <p className="mb-3 truncate text-sm text-muted-foreground">
              Signed in as <span className="font-mono text-xs">{userId}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirmingSignOut(true)}
                aria-haspopup="dialog"
                aria-expanded={confirmingSignOut}
                className="h-10 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
              >
                Sign out
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="h-10 rounded-lg border px-3 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                Delete account
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not signed in. Everything stays on this device.{" "}
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="font-medium underline underline-offset-4"
            >
              Sign in
            </button>{" "}
            to sync across devices.
          </p>
        )}

        {failed > 0 ? (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              {failed} change{failed === 1 ? "" : "s"} could not sync. They are
              saved locally and safe.
            </p>
            <button
              type="button"
              onClick={() => void retryFailed().then(refreshOutbox)}
              className="mt-2 h-9 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
            >
              Retry now
            </button>
          </div>
        ) : pending > 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {pending} change{pending === 1 ? "" : "s"} waiting to sync.
          </p>
        ) : null}
      </section>

      <section aria-label="Data" className="mb-8 rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-medium">Your data</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Download everything as JSON. It is your data, readable without us.
        </p>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={busy}
          className="h-10 rounded-lg border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Preparing…" : "Export JSON"}
        </button>
      </section>

      <section aria-label="Streaks and time" className="mb-8 rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-medium">Streaks and time</h2>

        {!profile ? (
          <p className="text-sm text-muted-foreground">
            These settings follow your account, so they appear once you sign in.
          </p>
        ) : null}

        <div className="space-y-5">
          <div>
            <label htmlFor="tz" className="mb-1 block text-sm font-medium">
              Time zone
            </label>
            <input
              id="tz"
              value={zone}
              onChange={(event) => void save({ tz: event.target.value })}
              placeholder="Asia/Kolkata"
              aria-invalid={!zoneValid}
              className={`h-11 w-full rounded-lg border bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                zoneValid ? "" : "border-destructive"
              }`}
            />
            {!zoneValid ? (
              <p className="mt-1 text-sm text-destructive">
                That is not a recognised IANA zone, e.g. Europe/London.
              </p>
            ) : null}
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">
              A day starts at
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {ROLLOVER_HOURS.map((hour) => (
                <Choice
                  key={hour}
                  active={profile?.rollover_hour === hour}
                  onClick={() => void save({ rollover_hour: hour })}
                >
                  {hour === 0 ? "Midnight" : `${hour}:00am`}
                </Choice>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              A late check-in after this hour counts towards the next day.
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">
              Day counts when
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {THRESHOLDS.map((threshold) => (
                <Choice
                  key={threshold}
                  active={profile?.streak_threshold === threshold}
                  onClick={() => void save({ streak_threshold: threshold })}
                >
                  {Math.round(threshold * 100)}%
                </Choice>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Share of the day&rsquo;s scheduled habits you need to finish.
              Default is {Math.round(DEFAULT_STREAK_THRESHOLD * 100)}%.
            </p>
          </fieldset>
        </div>
      </section>

      {confirmingSignOut ? (
        <SignOutDialog
          busy={busy}
          onKeep={() => void handleSignOut(false)}
          onRemove={() => void handleSignOut(true)}
          onCancel={() => setConfirmingSignOut(false)}
        />
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete your account?"
          body="This permanently removes your habits, entries and history from the server, and clears this device. It cannot be undone."
          confirmLabel="Delete everything"
          busy={busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </div>
  );
}

function Choice({
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
      className={`h-10 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "border-primary bg-accent font-medium" : "hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-xl border bg-card p-4"
      >
        <h2 className="font-medium">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            ref={ref}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-10 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sign-out asks what to do with the local copy rather than assuming. Both
 * choices sign out of the server session; only the second one destroys data.
 */
function SignOutDialog({
  busy,
  onKeep,
  onRemove,
  onCancel,
}: {
  busy: boolean;
  onKeep: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Sign out"
        className="w-full max-w-sm rounded-xl border bg-card p-4"
      >
        <h2 className="font-medium">Sign out?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your synced data stays on the server and comes back when you sign in
          again. Anything still queued on this device has not reached the server
          yet.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            ref={keepRef}
            type="button"
            onClick={onKeep}
            disabled={busy}
            className="h-10 rounded-lg border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Keep data on this device
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="h-10 rounded-lg border px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            Remove data from this device
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

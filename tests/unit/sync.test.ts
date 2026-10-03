import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, TickLabDB, __setDb, type Habit } from "@/lib/db/db";
import {
  clearLocalData,
  createHabit,
  deleteHabit,
  entriesForDay,
  listHabits,
  reorderHabits,
  setEntryValue,
  toggleTick,
} from "@/lib/db/queries";
import {
  MAX_ATTEMPTS,
  backoffMs,
  localWins,
  resolveConflict,
  stillNeedsPush,
} from "@/lib/sync/conflict";
import {
  acknowledge,
  markFailed,
  outboxSummary,
  readyItems,
  retryFailed,
  RETRY_AFTER_MS,
} from "@/lib/sync/queue";
import { LAST_PULLED_KEY, invalidatePullCursor } from "@/lib/sync/pull";
import { getMeta } from "@/lib/db/queries";

let db: TickLabDB;

beforeEach(async () => {
  // A fresh, isolated database per test.
  __setDb(new TickLabDB());
  db = getDb()!;
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
  __setDb(null);
});

describe("local writes", () => {
  it("creates a habit and queues it", async () => {
    const habit = await createHabit({ name: "Read", kind: "tick", schedule: [1, 2, 3] }, "user-1");

    expect(habit.id).toBeTruthy();
    expect(habit.target).toBeNull(); // tick habits have no target
    expect(habit.sort).toBe(0);

    const queued = await readyItems();
    expect(queued).toHaveLength(1);
    expect(queued[0].table).toBe("habits");
    expect(queued[0].rowKey).toBe(habit.id);
  });

  it("collapses repeated edits of the same row into one queued item", async () => {
    const habit = await createHabit({ name: "Read", kind: "count", target: 8, schedule: [1] }, "u");

    for (let i = 1; i <= 5; i++) {
      await setEntryValue(habit.id, "2024-01-01", i, "u");
    }

    const entryItems = (await readyItems()).filter((i) => i.table === "entries");
    expect(entryItems).toHaveLength(1);
    // The surviving payload is the newest value, not the first.
    expect((entryItems[0].payload as { value: number }).value).toBe(5);
  });

  it("toggles a tick back off", async () => {
    const habit = await createHabit({ name: "Meditate", kind: "tick", schedule: [1] }, "u");

    expect(await toggleTick(habit.id, "2024-01-01", "u")).toBe(1);
    expect(await toggleTick(habit.id, "2024-01-01", "u")).toBe(0);

    const values = await entriesForDay("2024-01-01", [habit.id]);
    expect(values.get(habit.id)).toBe(0);
  });

  it("queues value 0 rather than dropping the row, so unchecking replicates", async () => {
    const habit = await createHabit({ name: "Meditate", kind: "tick", schedule: [1] }, "u");
    await toggleTick(habit.id, "2024-01-01", "u");
    await toggleTick(habit.id, "2024-01-01", "u");

    const queued = await readyItems();
    expect((queued.find((i) => i.table === "entries")!.payload as { value: number }).value).toBe(0);
  });

  it("soft-deletes and hides archived habits by default", async () => {
    await createHabit({ name: "Keep", kind: "tick", schedule: [1] }, "u");
    const doomed = await createHabit({ name: "Drop", kind: "tick", schedule: [1] }, "u");

    await deleteHabit(doomed.id);

    const active = await listHabits();
    expect(active.map((h) => h.name)).toEqual(["Keep"]);

    const all = await listHabits({ includeDeleted: true });
    expect(all.map((h) => h.name).sort()).toEqual(["Drop", "Keep"]);
    expect(all.find((h) => h.name === "Drop")!.deleted).toBe(true);
  });

  it("persists a new order", async () => {
    const a = await createHabit({ name: "A", kind: "tick", schedule: [1] }, "u");
    const b = await createHabit({ name: "B", kind: "tick", schedule: [1] }, "u");
    const c = await createHabit({ name: "C", kind: "tick", schedule: [1] }, "u");

    await reorderHabits([c.id, a.id, b.id]);

    const ordered = await listHabits();
    expect(ordered.map((h) => h.name)).toEqual(["C", "A", "B"]);
  });

  it("hides archived habits from the Today list but keeps their history", async () => {
    const habit = await createHabit({ name: "Old", kind: "tick", schedule: [1] }, "u");
    await setEntryValue(habit.id, "2024-01-01", 1, "u");

    const { archiveHabit } = await import("@/lib/db/queries");
    await archiveHabit(habit.id);

    expect(await listHabits()).toHaveLength(0);
    expect(await listHabits({ includeArchived: true })).toHaveLength(1);
    // Archiving must never destroy history.
    expect((await entriesForDay("2024-01-01", [habit.id])).get(habit.id)).toBe(1);
  });

  it("soft-deleting a habit keeps its entries for the history view", async () => {
    const habit = await createHabit({ name: "Old", kind: "count", target: 5, schedule: [1] }, "u");
    await setEntryValue(habit.id, "2024-01-01", 4, "u");

    await deleteHabit(habit.id);

    expect(await listHabits()).toHaveLength(0);
    expect((await entriesForDay("2024-01-01", [habit.id])).get(habit.id)).toBe(4);
  });
});

describe("outbox retry handling", () => {
  it("keeps a failed item queued until its attempts run out", async () => {
    await createHabit({ name: "Read", kind: "tick", schedule: [1] }, "u");
    const [item] = await readyItems();

    // Below the cap the row is still pending: it must never be dropped.
    await markFailed(item, "network down");
    let summary = await outboxSummary();
    expect(summary.failed).toBe(0);
    expect(summary.pending).toBe(1);

    // Reaching the cap parks it.
    await markFailed({ ...item, attempts: MAX_ATTEMPTS - 1 }, "network down");
    summary = await outboxSummary();
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(0);
  });

  it("holds a parked row out of the batch until an explicit retry", async () => {
    await createHabit({ name: "Read", kind: "tick", schedule: [1] }, "u");
    const [item] = await readyItems();
    await markFailed({ ...item, attempts: MAX_ATTEMPTS - 1 }, "network down");

    // A parked row is not retried on a timer; it waits for the user.
    expect(await readyItems()).toHaveLength(0);
    expect(await retryFailed()).toBe(1);
    expect(await readyItems()).toHaveLength(1);
  });

  it("gives a recently failed row a cooldown before retrying it", async () => {
    await createHabit({ name: "Read", kind: "tick", schedule: [1] }, "u");
    const [item] = await readyItems();
    await markFailed(item, "network down");

    // Failed moments ago and still under the cap, so the cooldown applies.
    expect(await readyItems()).toHaveLength(0);

    // Once the cooldown has passed the row goes out again on its own.
    const db = getDb()!;
    const stored = (await db.outbox.get(item.id))!;
    await db.outbox.update(item.id, {
      failed_at: Date.now() - RETRY_AFTER_MS - 1,
    });
    expect(stored.attempts).toBe(1);
    expect(await readyItems()).toHaveLength(1);
  });

  it("removes acknowledged items", async () => {
    await createHabit({ name: "Read", kind: "tick", schedule: [1] }, "u");
    const items = await readyItems();
    await acknowledge(items);
    expect(await readyItems()).toHaveLength(0);
  });

  it("resets the backoff attempt counter on a fresh edit", async () => {
    const habit = await createHabit({ name: "Read", kind: "tick", schedule: [1] }, "u");
    await setEntryValue(habit.id, "2024-01-01", 1, "u");

    const entries = (await readyItems()).filter((i) => i.table === "entries");
    await markFailed({ ...entries[0], attempts: MAX_ATTEMPTS - 1 }, "boom");
    expect((await outboxSummary()).failed).toBe(1);

    // Editing again re-queues the row, which must clear the failure flag.
    await setEntryValue(habit.id, "2024-01-01", 2, "u");
    expect((await outboxSummary()).failed).toBe(0);
  });
});

describe("conflict resolution", () => {
  it("prefers the newer row", () => {
    expect(localWins({ updated_at: 200 }, { updated_at: 100 })).toBe(true);
    expect(localWins({ updated_at: 100 }, { updated_at: 200 })).toBe(false);
  });

  it("breaks ties toward the server so two devices converge", () => {
    const result = resolveConflict({ v: "a", updated_at: 100 }, { v: "b", updated_at: 100 });
    expect(result.source).toBe("remote");
    expect(result.value).toEqual({ v: "b", updated_at: 100 });
  });

  it("keeps an item queued when the row was edited mid-flight", () => {
    // Queued at 100, the server confirms 150, but the local row is now 200.
    expect(stillNeedsPush(100, { updated_at: 200 }, 150)).toBe(true);
    // Local row is exactly what the server has.
    expect(stillNeedsPush(100, { updated_at: 150 }, 150)).toBe(false);
    // Row vanished locally, nothing left to push.
    expect(stillNeedsPush(100, undefined, 150)).toBe(false);
  });

  it("grows the backoff delay but stays under the cap", () => {
    const first = backoffMs(1);
    const tenth = backoffMs(10);
    expect(tenth).toBeGreaterThan(first);
    expect(backoffMs(50)).toBeLessThanOrEqual(300_000);
  });
});

describe("two devices converge", () => {
  // Two separate databases standing in for two browsers. Outgoing writes are
  // replayed by hand because there is no server here; what is under test is that
  // the merge rules produce the same state on both sides.
  it("resolves concurrent edits the same way on both devices", async () => {
    const deviceA = new TickLabDB();
    const deviceB = new TickLabDB();
    await deviceA.delete();
    await deviceB.delete();
    await deviceA.open();
    await deviceB.open();

    const sharedId = "11111111-2222-3333-4444-555555555555";
    const base: Habit = {
      id: sharedId,
      user_id: "u1",
      name: "Read",
      icon: null,
      grp: null,
      kind: "tick",
      unit: null,
      target: null,
      schedule: [1, 2, 3, 4, 5, 6, 7],
      sort: 0,
      archived_at: null,
      updated_at: 1_000,
      deleted: false,
    };

    // Both devices start from the same row.
    await deviceA.habits.put(base);
    await deviceB.habits.put(base);

    // A renames it at t=2000; B archives it at t=3000.
    await deviceA.habits.put({ ...base, name: "Read books", updated_at: 2_000 });
    await deviceB.habits.put({ ...base, archived_at: 3_000, updated_at: 3_000 });

    const remoteForA = (await deviceB.habits.get(sharedId))!;
    const remoteForB = (await deviceA.habits.get(sharedId))!;
    const localA = (await deviceA.habits.get(sharedId))!;
    const localB = (await deviceB.habits.get(sharedId))!;

    const winnerOnA = resolveConflict(localA, remoteForA);
    const winnerOnB = resolveConflict(localB, remoteForB);

    expect(winnerOnA.source).toBe("remote");
    expect(winnerOnB.source).toBe("remote");
    expect(winnerOnA.value).toEqual(winnerOnB.value);
    expect((winnerOnA.value as Habit).archived_at).toBe(3_000);

    await deviceA.delete();
    await deviceB.delete();
  });

  it("a pending local write survives a pull and is re-queued", async () => {
    const habit = await createHabit({ name: "Offline edit", kind: "count", target: 5, schedule: [1] }, "u");
    await setEntryValue(habit.id, "2024-01-01", 3, "u");

    const localHabit = (await db.habits.get(habit.id))!;
    // The server copy is older, so last-write-wins keeps the local row.
    const staleRemote = { ...localHabit, name: "Stale", updated_at: localHabit.updated_at - 1 };
    const merged = resolveConflict(localHabit, staleRemote);
    expect(merged.source).toBe("local");
    expect((merged.value as Habit).name).toBe("Offline edit");

    // And the outbox still holds the value that never reached the server.
    const queued = await readyItems();
    expect((queued.find((i) => i.table === "entries")!.payload as { value: number }).value).toBe(3);
  });
});

describe("sync cursor", () => {
  it("starts unset and can be invalidated", async () => {
    expect(await getMeta(LAST_PULLED_KEY, 0)).toBe(0);
    await db.meta.put({ key: LAST_PULLED_KEY, value: 12345 });
    expect(await getMeta(LAST_PULLED_KEY, 0)).toBe(12345);

    await invalidatePullCursor();
    expect(await getMeta(LAST_PULLED_KEY, 0)).toBe(0);
  });
});

describe("sign-out cleanup", () => {
  it("wipes every local table", async () => {
    const habit = await createHabit({ name: "Read", kind: "tick", schedule: [1] }, "u");
    await setEntryValue(habit.id, "2024-01-01", 1, "u");
    await db.meta.put({ key: "x", value: 1 });

    await clearLocalData();

    expect(await db.habits.count()).toBe(0);
    expect(await db.entries.count()).toBe(0);
    expect(await db.days.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});
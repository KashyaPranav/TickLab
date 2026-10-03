import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, TickLabDB, __setDb, type Entry, type Habit } from "@/lib/db/db";
import { adoptGuestData, needsGuestMerge } from "@/lib/db/queries";

const USER = "user-1";

let db: TickLabDB;

beforeEach(async () => {
  __setDb(new TickLabDB());
  db = getDb()!;
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
  __setDb(null);
});

function habit(id: string, owner: string | null, updated_at: number): Habit {
  return {
    id,
    user_id: owner,
    name: `habit ${id}`,
    emoji: "x",
    color: "#000",
    schedule: "daily",
    target: 1,
    archived: 0,
    position: 0,
    created_at: updated_at,
    updated_at,
  } as unknown as Habit;
}

function entry(habit_id: string, day: string, owner: string | null, updated_at: number): Entry {
  return {
    habit_id,
    day,
    user_id: owner,
    value: 1,
    updated_at,
  } as unknown as Entry;
}

describe("adoptGuestData", () => {
  it("re-owns guest rows and queues them in the same transaction", async () => {
    await db.habits.bulkPut([habit("h1", null, 10)]);
    await db.entries.bulkPut([entry("h1", "2026-01-01", null, 10)]);

    const adopted = await adoptGuestData(USER);

    expect(adopted).toBe(2);

    // Owned now.
    expect((await db.habits.get("h1"))!.user_id).toBe(USER);
    expect((await db.entries.get(["h1", "2026-01-01"]))!.user_id).toBe(USER);

    // No guest rows left behind.
    expect(await db.habits.filter((h) => h.user_id === null).count()).toBe(0);
    expect(await db.entries.filter((e) => e.user_id === null).count()).toBe(0);

    // And all of it is queued to push, carrying the real user id.
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(2);
    expect((await db.outbox.get("habits:h1"))!.payload.user_id).toBe(USER);
    expect((await db.outbox.get("entries:h1|2026-01-01"))!.payload.user_id).toBe(USER);
  });

  it("leaves day rows alone, which cannot be guest-owned", async () => {
    // A Day is keyed by [user_id, day] and IndexedDB rejects null keys, so a
    // guest day row cannot exist. Adopting must not disturb existing days.
    await db.days.bulkPut([
      { user_id: USER, day: "2026-01-01", mood: 3, note: "ok", updated_at: 5 },
    ]);

    await adoptGuestData(USER);

    expect(await db.days.count()).toBe(1);
    expect((await db.days.get([USER, "2026-01-01"]))!.mood).toBe(3);
  });

  it("keeps guest and server rows when their ids differ", async () => {
    await db.habits.bulkPut([
      habit("phone", null, 10),
      habit("laptop", USER, 10),
    ]);

    await adoptGuestData(USER);

    expect(await db.habits.count()).toBe(2);
    expect(await db.habits.filter((h) => h.user_id === USER).count()).toBe(2);
  });

  it("does not queue or delete anything when there are no guest rows", async () => {
    await db.habits.bulkPut([habit("existing", USER, 10)]);

    const adopted = await adoptGuestData(USER);

    expect(adopted).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.habits.count()).toBe(1);
  });

  it("is not repeated once adopted for that account", async () => {
    await db.habits.bulkPut([habit("h1", null, 10)]);

    expect(await needsGuestMerge()).toBe(true);
    await adoptGuestData(USER);
    // Idempotent: no guest rows remain, so there is nothing left to do.
    expect(await needsGuestMerge()).toBe(false);
    await adoptGuestData(USER);
    expect(await db.habits.count()).toBe(1);
  });

  it("adopts guest rows created after an earlier sign-out", async () => {
    await db.habits.bulkPut([habit("h1", null, 10)]);
    await adoptGuestData(USER);
    expect(await needsGuestMerge()).toBe(false);

    // Sign out, create a habit while signed out, sign back in.
    await db.habits.bulkPut([habit("h2", null, 20)]);
    expect(await needsGuestMerge()).toBe(true);

    await adoptGuestData(USER);
    expect(await db.habits.filter((h) => h.user_id === USER).count()).toBe(2);
    expect(await db.habits.filter((h) => h.user_id === null).count()).toBe(0);
  });

  it("is a no-op when nothing is signed in yet", async () => {
    await db.habits.bulkPut([habit("h1", null, 10)]);
    await adoptGuestData("");
    expect(await db.habits.filter((h) => h.user_id === null).count()).toBe(1);
  });
});
import { describe, it, expect } from "vitest";
import { mergeByUpdatedAt } from "@/lib/auth/guest-merge";

type Row = {
  id: string;
  updated_at: number;
  owner: string;
  note?: string;
};

const key = (row: Row) => row.id;

function guest(id: string, updated_at: number, note?: string): Row {
  return { id, updated_at, owner: "guest", note };
}

function server(id: string, updated_at: number, note?: string): Row {
  return { id, updated_at, owner: "account", note };
}

describe("mergeByUpdatedAt", () => {
  it("keeps every guest row when the account is empty", () => {
    const result = mergeByUpdatedAt(
      [guest("a", 1), guest("b", 2), guest("c", 3)],
      [],
      key,
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    // Nothing was superseded, so nothing may be deleted locally.
    expect(result.supersededLocalKeys).toEqual([]);
    expect(result.adoptedServerKeys).toEqual([]);
    expect(result.rows.every((r) => r.owner === "guest")).toBe(true);
  });

  it("keeps guest rows with different ids even when times match", () => {
    // Same name on two devices is two real habits, not one.
    const result = mergeByUpdatedAt(
      [guest("phone-habit", 100)],
      [server("laptop-habit", 100)],
      key,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.id).sort()).toEqual([
      "laptop-habit",
      "phone-habit",
    ]);
  });

  it("resolves overlapping ids last-write-wins", () => {
    const local = guest("same", 200, "local edit");
    const remote = server("same", 100, "remote edit");

    const result = mergeByUpdatedAt([local], [remote], key);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].note).toBe("local edit");
    expect(result.supersededLocalKeys).toEqual([]);
    expect(result.adoptedServerKeys).toEqual([]);
  });

  it("adopts the server row when it is newer", () => {
    const local = guest("same", 100, "local edit");
    const remote = server("same", 300, "remote edit");

    const result = mergeByUpdatedAt([local], [remote], key);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].note).toBe("remote edit");
    expect(result.rows[0].owner).toBe("account");
    expect(result.supersededLocalKeys).toEqual(["same"]);
    expect(result.adoptedServerKeys).toEqual(["same"]);
  });

  it("prefers the server row on an exact tie", () => {
    // Deterministic tie-break: without this, two devices could each keep their
    // own copy and the divergence would survive indefinitely.
    const result = mergeByUpdatedAt(
      [guest("same", 100, "local")],
      [server("same", 100, "remote")],
      key,
    );

    expect(result.rows[0].note).toBe("remote");
  });

  it("re-owns nothing on a tie and never reports a loss for a kept row", () => {
    const result = mergeByUpdatedAt(
      [guest("a", 10), guest("b", 20)],
      [server("a", 5), server("b", 5)],
      key,
    );

    expect(result.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.supersededLocalKeys).toEqual([]);
  });

  it("passes through server rows with no guest counterpart", () => {
    const result = mergeByUpdatedAt(
      [guest("a", 10)],
      [server("z", 50)],
      key,
    );

    expect(result.rows.map((r) => r.id).sort()).toEqual(["a", "z"]);
    expect(result.supersededLocalKeys).toEqual([]);
  });

  it("de-duplicates repeated keys in the guest set", () => {
    const result = mergeByUpdatedAt(
      [guest("a", 10), guest("a", 20)],
      [],
      key,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].updated_at).toBe(20);
  });

  it("keys days by user and day rather than by a single id", () => {
    type DayRow = { user_id: string | null; day: string; updated_at: number };
    const dayKey = (row: DayRow) => `${row.user_id}|${row.day}`;

    const result = mergeByUpdatedAt(
      [{ user_id: null, day: "2026-01-01", updated_at: 5 }],
      [{ user_id: "user-1", day: "2026-01-01", updated_at: 9 }],
      dayKey,
    );

    // Different owners are different rows, so the guest day is kept as its own.
    expect(result.rows).toHaveLength(2);
  });

  it("is stable and idempotent across repeated merges", () => {
    const guestRows = [guest("a", 10), guest("b", 20)];
    const serverRows = [server("b", 5)];

    const first = mergeByUpdatedAt(guestRows, serverRows, key);
    const second = mergeByUpdatedAt(first.rows, serverRows, key);

    expect(second.rows.map((r) => r.id).sort()).toEqual(
      first.rows.map((r) => r.id).sort(),
    );
  });
});
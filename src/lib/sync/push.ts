import { supabase } from "@/lib/supabase/client";
import { acknowledge, groupByTable, markFailed, readyItems } from "./queue";
import { stillNeedsPush } from "./conflict";
import { getDb, type OutboxItem, type OutboxTableName, type TickLabDB } from "@/lib/db/db";

export interface PushResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Sends the outbox to Postgres.
 *
 * Rows are upserted rather than replaced, so a value of 0 (an unchecked tick)
 * still replicates: this is why every syncable row carries an `updated_at` and we
 * upsert on primary key conflict.
 */
export async function push(limit?: number): Promise<PushResult> {
  const local = getDb();

  const result: PushResult = { sent: 0, failed: 0, skipped: 0 };
  if (!supabase || !local) return result;

  const items = await readyItems(limit);
  if (items.length === 0) return result;

  const grouped = await groupByTable(items);

  for (const [table, batch] of grouped) {
    const rows = batch.map((item) => item.payload as never);

    const { error } = await supabase
      .from(table)
      .upsert(rows as never, { onConflict: conflictTarget(table) });

    if (error) {
      for (const item of batch) {
        await markFailed(item, error.message);
      }
      result.failed += batch.length;
      continue;
    }

    // Re-read the rows the server now holds so we only clear outbox items whose
    // payload the server actually accepted.
    const echoed = await fetchUpdatedAt(table, batch);
    const accepted: OutboxItem[] = [];

    for (const item of batch) {
      const localRow = await readLocal(local, table, item.rowKey);
      const remoteUpdatedAt = echoed.get(item.rowKey);

      if (remoteUpdatedAt === undefined) {
        // The server did not report the row; assume it landed and let the next
        // pull reconcile.
        accepted.push(item);
        result.sent++;
        continue;
      }

      if (stillNeedsPush(item.updated_at, localRow, remoteUpdatedAt)) {
        // Edited again while in flight; keep it queued.
        result.skipped++;
        continue;
      }
      accepted.push(item);
      result.sent++;
    }

    await acknowledge(accepted);
  }

  return result;
}

function conflictTarget(table: OutboxTableName): string {
  switch (table) {
    case "habits":
      return "id";
    case "entries":
      return "habit_id,day";
    case "days":
      return "user_id,day";
    default: {
      const exhaustive: never = table;
      throw new Error(`Unhandled sync table: ${String(exhaustive)}`);
    }
  }
}

/**
 * Postgres does not echo rows on upsert, so read back just the rows we sent,
 * filtered to the ids in this batch.
 */
async function fetchUpdatedAt(
  table: OutboxTableName,
  batch: OutboxItem[],
): Promise<Map<string, number>> {
  if (!supabase) return new Map();
  const out = new Map<string, number>();

  const columns = primaryKeyColumns(table);
  let query = supabase
    .from(table)
    .select(columns.join(","))
    .limit(1000);

  if (table === "habits") {
    query = query.in("id", batch.map((i) => i.rowKey));
  } else if (table === "entries") {
    query = query.in("habit_id", batch.map((i) => i.rowKey.split("|")[0]));
  } else {
    query = query.in("user_id", batch.map((i) => i.rowKey.split("|")[0]));
  }

  const { data, error } = await query;
  if (error || !data) return out;

  for (const row of data) {
    // The selected column set is table-specific, so normalise to a plain record.
    const record = row as unknown as Record<string, unknown>;
    out.set(rowKeyFrom(table, record), Date.parse(String(record.updated_at)));
  }

  return out;
}

function primaryKeyColumns(table: OutboxTableName): string[] {
  switch (table) {
    case "habits":
      return ["id", "updated_at"];
    case "entries":
      return ["habit_id", "day", "updated_at"];
    case "days":
      return ["user_id", "day", "updated_at"];
    default: {
      const exhaustive: never = table;
      throw new Error(`Unhandled sync table: ${String(exhaustive)}`);
    }
  }
}

function rowKeyFrom(table: OutboxTableName, row: Record<string, unknown>): string {
  switch (table) {
    case "habits":
      return String(row.id);
    case "entries":
      return `${String(row.habit_id)}|${String(row.day)}`;
    case "days":
      return `${String(row.user_id)}|${String(row.day)}`;
    default: {
      const exhaustive: never = table;
      throw new Error(`Unhandled sync table: ${String(exhaustive)}`);
    }
  }
}

async function readLocal(
  local: TickLabDB,
  table: OutboxTableName,
  rowKey: string,
): Promise<{ updated_at: number } | undefined> {
  switch (table) {
    case "habits":
      return local.habits.get(rowKey);
    case "entries": {
      const [habitId, day] = rowKey.split("|");
      return local.entries.get([habitId, day]);
    }
    case "days": {
      const [userId, day] = rowKey.split("|");
      return local.days.get([userId, day]);
    }
    default: {
      const exhaustive: never = table;
      throw new Error(`Unhandled sync table: ${String(exhaustive)}`);
    }
  }
}

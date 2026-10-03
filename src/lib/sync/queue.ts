import { getDb, type OutboxItem, type OutboxTableName } from "@/lib/db/db";
import { MAX_ATTEMPTS } from "./conflict";

/** Batched so a heavy day of backfilling does not fire hundreds of requests. */
export const PUSH_BATCH_SIZE = 50;

/** Quiet period after a failure before the row is retried automatically. */
export const RETRY_AFTER_MS = 15_000;

export interface OutboxSummary {
  pending: number;
  failed: number;
  oldestAt: number | null;
}

/**
 * A row is parked once it has burned through its attempts. Parked rows are never
 * retried on a timer; only an explicit retry returns them to the queue. Silently
 * looping on a permanently bad row would drain the battery forever.
 */
function isParked(item: OutboxItem): boolean {
  return item.attempts >= MAX_ATTEMPTS;
}

export async function pendingCount(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  return db.outbox.filter((item) => !isParked(item)).count();
}

export async function outboxSummary(): Promise<OutboxSummary> {
  const db = getDb();
  if (!db) {
    return { pending: 0, failed: 0, oldestAt: null };
  }
  const items = await db.outbox.toArray();
  const failed = items.filter(isParked).length;
  return {
    pending: items.length - failed,
    failed,
    oldestAt: items.length > 0 ? Math.min(...items.map((i) => i.updated_at)) : null,
  };
}

/**
 * Items ready to send.
 *
 * A parked item (`failed_at` set) stays out of the batch until the user asks for
 * a retry: re-sending it on a timer would loop forever on a permanently bad row
 * and drain the battery. Recent failures are given a short cooldown so a burst
 * of edits does not hammer a struggling network.
 */
export async function readyItems(limit = PUSH_BATCH_SIZE): Promise<OutboxItem[]> {
  const db = getDb();
  if (!db) return [];
  const now = Date.now();
  const items = await db.outbox.orderBy("updated_at").toArray();
  return items
    .filter((item) => {
      if (isParked(item)) return false;
      // Untouched rows go straight out; a row that just failed waits for the
      // cooldown so a struggling network is not hammered.
      if (item.failed_at === null) return true;
      return now - item.failed_at >= RETRY_AFTER_MS;
    })
    .slice(0, limit);
}

export async function groupByTable(
  items: OutboxItem[],
): Promise<Map<OutboxTableName, OutboxItem[]>> {
  const grouped = new Map<OutboxTableName, OutboxItem[]>();
  for (const item of items) {
    const list = grouped.get(item.table);
    if (list) list.push(item);
    else grouped.set(item.table, [item]);
  }
  return grouped;
}

/** Removes items that the server has accepted. */
export async function acknowledge(items: OutboxItem[]): Promise<void> {
  const db = getDb();
  if (!db || items.length === 0) return;
  await db.outbox.bulkDelete(items.map((i) => i.id));
}

/**
 * Records a failure. The row stays in the outbox the whole time, which is what
 * guarantees a check-in is never silently dropped; only the attempt counter and
 * the cooldown timestamp change.
 */
export async function markFailed(item: OutboxItem, error: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.outbox.update(item.id, {
    attempts: item.attempts + 1,
    last_error: error,
    failed_at: Date.now(),
  });
}

/** Returns parked rows to the queue, e.g. after the user taps "retry". */
export async function retryFailed(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const failed = await db.outbox.filter(isParked).toArray();
  await db.outbox.bulkPut(
    failed.map((item) => ({ ...item, failed_at: null, attempts: 0, last_error: null })),
  );
  return failed.length;
}
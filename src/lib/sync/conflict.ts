/**
 * Conflict resolution.
 *
 * Last-write-wins per row is the right call here: the data is single-user, and a
 * user editing the same habit on two devices within the same second is vanishingly
 * rare compared to the cost of a CRDT. Soft deletes win over nothing at all, and a
 * tombstone is only superseded by a strictly newer write.
 */

export interface Versioned {
  updated_at: number;
}

export type Winner<L, R> = { source: "local" | "remote"; value: L | R };

/**
 * Returns the row that should survive. Ties go to the remote copy so that two
 * devices which made the same edit converge on identical bytes rather than each
 * keeping its own version.
 */
export function resolveConflict<L extends Versioned, R extends Versioned>(
  local: L,
  remote: R,
): Winner<L, R> {
  if (local.updated_at > remote.updated_at) {
    return { source: "local", value: local };
  }
  return { source: "remote", value: remote };
}

/** Convenience boolean form. */
export function localWins(local: Versioned, remote: Versioned): boolean {
  return local.updated_at > remote.updated_at;
}

/**
 * Whether a queued local write still needs to be pushed after the server replied.
 *
 * If the user edited the same row again while the push was in flight, the local
 * copy is newer than what we just sent, so the outbox entry must stay.
 */
export function stillNeedsPush(
  queuedAt: number,
  localRow: Versioned | undefined,
  remoteUpdatedAt: number,
): boolean {
  if (!localRow) return false; // row vanished locally, nothing to push
  return localRow.updated_at > remoteUpdatedAt || queuedAt > remoteUpdatedAt;
}

/** Retry delay with exponential backoff and jitter, capped at 5 minutes. */
export function backoffMs(attempts: number, base = 1_000, max = 300_000): number {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempts - 1));
  // Full jitter keeps a fleet of clients from retrying in lockstep.
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/** Attempts allowed before an item is parked in `failed_at`. */
export const MAX_ATTEMPTS = 8;
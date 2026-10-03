/**
 * Re-owning guest rows after a first sign-in.
 *
 * Kept free of Dexie and Supabase imports on purpose: the interesting behaviour
 * is the conflict rule, and that has to be provable without a database or a
 * network. `mergeGuestData` below is the thin, side-effecting wrapper.
 */

/** The minimum a row needs for last-write-wins to be decidable. */
export interface MergeableRow {
  updated_at: number;
}

export interface MergeResult<T> {
  /** Rows to persist locally, already de-duplicated and ordered by key. */
  rows: T[];
  /** Guest rows that lost to a newer server row and should be dropped. */
  supersededLocalKeys: string[];
  /** Rows the server won; the local copy should be overwritten. */
  adoptedServerKeys: string[];
}

/**
 * Last-write-wins by `updated_at`, keyed by row identity.
 *
 * Two rows with different ids are both kept: a habit created on the phone and
 * the same-named habit created on the laptop are two real habits, and silently
 * collapsing them would lose tracking history.
 *
 * `keyOf` must return the row's identity within its table (the habit id, or
 * `userId|day` for days).
 */
export function mergeByUpdatedAt<T extends MergeableRow>(
  guestRows: T[],
  serverRows: T[],
  keyOf: (row: T) => string,
): MergeResult<T> {
  const serverByKey = new Map<string, T>();
  for (const row of serverRows) serverByKey.set(keyOf(row), row);

  const rows: T[] = [];
  const supersededLocalKeys: string[] = [];
  const adoptedServerKeys: string[] = [];
  const seen = new Set<string>();

  for (const row of guestRows) {
    const key = keyOf(row);
    // A duplicate key inside one table cannot normally exist, but if it somehow
    // does the newer row is the real one: keep the later occurrence rather than
    // whichever happened to be read first.
    const alreadySeen = seen.has(key);
    if (alreadySeen) {
      const at = rows.findIndex((candidate) => keyOf(candidate) === key);
      if (at !== -1 && row.updated_at > rows[at].updated_at) rows[at] = row;
      continue;
    }
    seen.add(key);

    const server = serverByKey.get(key);
    if (!server) {
      // No counterpart: the guest row is the only copy in existence.
      rows.push(row);
      continue;
    }
    if (row.updated_at > server.updated_at) {
      rows.push(row);
    } else {
      // The server copy is newer or identical; it wins and replaces the local.
      rows.push(server);
      supersededLocalKeys.push(key);
      adoptedServerKeys.push(key);
    }
  }

  // Server rows with no guest counterpart are untouched and stay as they are.
  for (const row of serverRows) {
    const key = keyOf(row);
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  }

  return { rows, supersededLocalKeys, adoptedServerKeys };
}

export const GUEST_OWNER = null;
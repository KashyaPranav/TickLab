"use client";

/**
 * A tiny signal that local data changed.
 *
 * IndexedDB gives no per-row change events we can subscribe to, and the UI reads
 * the database directly rather than through the sync engine. Without this, a
 * write made while offline would sit in the database with nothing on screen
 * telling the view to look again, because there is no successful sync to hang a
 * refresh off.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeLocalChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called after a write has committed. */
export function notifyLocalChanged(): void {
  for (const listener of listeners) listener();
}
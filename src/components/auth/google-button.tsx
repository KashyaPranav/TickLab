"use client";

import { useState } from "react";
import { signInWithGoogle } from "@/lib/supabase/auth";
import { GoogleMark } from "./auth-card";

/**
 * Starts Google OAuth. Shared by /login and /signup so the two cannot drift.
 *
 * `useState` for the pending flag rather than a global: the button leaves the
 * page on success, so a busy state that outlives the click would only ever be a
 * way to leave someone stuck on a spinner.
 */
export function GoogleButton({
  label = "Continue with Google",
}: {
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await signInWithGoogle();
    if (result.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleMark />
        {pending ? "Opening Google…" : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-center text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
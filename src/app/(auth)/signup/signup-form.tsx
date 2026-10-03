"use client";

import Link from "next/link";
import { useState } from "react";
import { isSupabaseConfigured, signInWithMagicLink } from "@/lib/supabase/auth";
import { AuthCard, AuthError } from "@/components/auth/auth-card";
import { GoogleButton } from "@/components/auth/google-button";

/** Mirrors LoginForm: the page is a server component, this is not. */
export function SignupForm({ initialError }: { initialError: string | null }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signInWithMagicLink(email.trim());
      if (result.error) setError(result.error);
      else setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <AuthCard title="Create an account">
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Accounts are not available in this deployment. TickLab still works and
            keeps everything on this device.
          </p>
          <Link
            href="/today"
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Start without an account
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account">
      <AuthError message={initialError} />

      {sent ? (
        <div role="status" className="rounded-xl border border-dashed p-6 text-center">
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We sent a sign-in link to {email}. Open it on this device and you are
            set.
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-4 text-sm font-medium underline underline-offset-4"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <GoogleButton />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="signup-email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-11 w-full rounded-lg border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Create account"}
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            No password needed. We email you a link instead.
          </p>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      )}
    </AuthCard>
  );
}
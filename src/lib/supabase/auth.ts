"use client";

import { supabase, requireSupabase, isSupabaseConfigured } from "./client";
import type { ProfileRow } from "./types";

export { isSupabaseConfigured };

export async function signInWithMagicLink(
  email: string,
  redirectTo?: string,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Sign-in is not available in this deployment." };
  }
  const { error } = await requireSupabase().auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectTo ?? `${window.location.origin}/today`,
    },
  });
  return { error: error?.message ?? null };
}

/**
 * Starts the Google OAuth flow.
 *
 * `prompt: "select_account"` is deliberate: without it Google silently reuses
 * whichever account last signed in, which on a shared device looks like the
 * wrong account was picked and cannot be worked around by the user.
 *
 * Linking note: Supabase links a Google identity to an existing account only
 * when the emails match *and* are verified. That is why email confirmation must
 * stay enabled in the Supabase project. With it disabled, an attacker who
 * registers an unverified address matching a victim's email could have Google
 * auto-link into the victim's account.
 */
export async function signInWithGoogle(
  redirectTo?: string,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Sign-in is not available in this deployment." };
  }
  const origin = window.location.origin;
  const { error } = await requireSupabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo ?? `${origin}/auth/callback?next=/today`,
      queryParams: { prompt: "select_account" },
    },
  });
  return { error: error?.message ?? null };
}

export async function getSession() {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/** Loads the caller's profile row, which carries tz and rollover settings. */
export async function fetchProfile(): Promise<ProfileRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .maybeSingle();
  if (error) return null;
  return data as ProfileRow | null;
}

/**
 * Deletes the account. Cascades are handled by foreign keys on the server, so
 * habits, entries and days go with it.
 */
export async function deleteAccount(): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("delete_account");
  if (error) return { error: error.message };
  // The local copy must go too, otherwise a shared device leaks the cache.
  const { clearLocalData } = await import("@/lib/db/queries");
  await clearLocalData();
  return { error: null };
}

/** Subscribes to auth changes; returns an unsubscribe function. */
export function onAuthChange(
  handler: (event: string, userId: string | null) => void,
): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    handler(event, session?.user?.id ?? null);
  });
  return () => data.subscription.unsubscribe();
}
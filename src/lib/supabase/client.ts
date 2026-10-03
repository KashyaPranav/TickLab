import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Browser client. Only the anon key ever reaches this bundle; all row-level
 * authorization is enforced by Postgres RLS, never here.
 *
 * The session lives in cookies rather than localStorage so that the proxy and
 * server components observe the same signed-in state, and so it survives an
 * offline reload. @supabase/ssr wires the cookie jar itself and already no-ops
 * when there is no document, which is what lets this module be imported during
 * prerendering; overriding those hooks with `document.cookie` breaks the build.
 *
 * PKCE is the default flow.
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createBrowserClient<Database>(url!, anonKey!)
  : null;

export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}
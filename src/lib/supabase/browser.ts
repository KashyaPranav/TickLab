import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Browser client.
 *
 * Uses @supabase/ssr so the session is mirrored into cookies that a server
 * component and the proxy can both read. Callers must create this lazily inside
 * a browser context: constructing it during SSR would bake one request's cookie
 * jar into a shared module-level singleton.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
}
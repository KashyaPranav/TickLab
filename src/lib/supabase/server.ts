import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Server-side Supabase client backed by cookies.
 *
 * Cookies rather than localStorage are what let a server component read the
 * session, which is why the landing page can render its signed-in state without
 * a client round-trip. Only the anon key is ever used here; a service-role key
 * must never reach any code that can be bundled for the browser.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The
            // proxy refreshes the session on the next request instead, so this
            // is safe to ignore rather than fatal.
          }
        },
      },
    },
  );
}
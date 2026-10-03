import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

/**
 * TickLab is local-first: the app has to work with no account at all, so this
 * deliberately does *not* gate the app routes on a session. Everything under
 * /(app) reads and writes IndexedDB, which is available whether or not anyone is
 * signed in.
 *
 * Real authorization is enforced by Postgres row-level security on the sync
 * tables. A visitor without a session simply has nothing to sync, so a redirect
 * here would only block the offline-first promise.
 *
 * What this does do is refresh the session cookie. Supabase access tokens are
 * short-lived, so without a rolling refresh a signed-in user's session would
 * lapse mid-visit and they would be silently treated as a guest on the next
 * sync. `getClaims()` reads and validates the local token without a network
 * round-trip, and only calls out to Supabase when the token is actually
 * expired, which is what keeps an offline reload working.
 */

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Habit data is private to the device, so nothing may be cached by an
  // intermediary. This is also what keeps a signed-in user's rows out of a
  // shared cache while their own IndexedDB remains the source of truth.
  let response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");

  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          response.headers.set("Cache-Control", "private, no-store");
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    // Validates the existing token locally; refreshes only if it has expired.
    await supabase.auth.getClaims();
  } catch {
    // Offline or Supabase unreachable. The cookie is left untouched so the
    // session survives and the request still renders from IndexedDB.
  }

  // Keep the landing page out of caches too, now that it renders auth state.
  if (pathname === "/") {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

export const config = {
  matcher: [
    // Exclude static assets and images; they never carry a session.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)",
  ],
};
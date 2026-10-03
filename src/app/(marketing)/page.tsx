import Landing from "./landing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The landing page is signed-in-aware, so it cannot be statically prerendered:
 * a cached copy would show one account's CTA to everyone.
 *
 * `getClaims` reads the session cookie without a network round-trip and only
 * calls out when the token has actually expired, so a normal visit costs no
 * extra request. If Supabase is unconfigured the page still renders.
 */
export default async function LandingPage() {
  let loggedIn = false;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data } = await supabase.auth.getClaims();
      loggedIn = Boolean(data?.claims?.sub);
    } catch {
      // Offline, or Supabase unreachable. The signed-out CTA is the safe guess.
      loggedIn = false;
    }
  }

  return <Landing loggedIn={loggedIn} />;
}
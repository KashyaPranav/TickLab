import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/auth/redirect";

/**
 * OAuth landing route for the PKCE flow.
 *
 * Google redirects here with `?code=...`, we trade the code for a session and
 * set the session cookie. This has to be a route handler rather than a page
 * because the cookie write requires a mutable response.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  // Google reports a cancelled consent screen as an error redirect, not a code.
  const providerError = searchParams.get("error");
  const next = safeRedirect(searchParams.get("next"));

  if (providerError) {
    const reason = new URLSearchParams({
      error: providerError === "access_denied" ? "consent_cancelled" : "auth_failed",
    });
    return NextResponse.redirect(`${origin}/login?${reason.toString()}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
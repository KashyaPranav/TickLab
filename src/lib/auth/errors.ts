/**
 * Human-readable copy for the error codes the OAuth callback can bounce back.
 *
 * Kept as a map rather than string comparison at the call sites so that a code
 * arriving from the query string can never be rendered as raw text: an
 * unrecognised code falls through to a generic message instead of being echoed
 * back to the user.
 */
const MESSAGES: Record<string, string> = {
  consent_cancelled: "Google sign-in was cancelled. Nothing was changed.",
  auth_failed: "Google sign-in failed. Please try again.",
  missing_code: "Google sign-in did not complete. Please try again.",
};

const GENERIC = "Something went wrong signing in. Please try again.";

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? GENERIC;
}
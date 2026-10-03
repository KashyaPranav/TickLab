import { z } from "zod";

/**
 * Where an OAuth callback is allowed to send someone.
 *
 * `next` arrives from the query string, so it is fully attacker-controlled. An
 * unchecked value here is an open redirect: an attacker sends a victim through
 * Google and drops them on a convincing phishing page the moment the session
 * lands. Only same-origin relative paths are accepted, and `//evil.com` is
 * rejected explicitly because browsers treat it as protocol-relative.
 */
const nextParam = z
  .string()
  .trim()
  .min(1)
  .max(512)
  // Rejects "//evil.com", "http://evil.com", "javascript:...", "\evil.com".
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "next must be a same-origin relative path",
  })
  .refine((value) => !value.includes("\\"), {
    message: "next must not contain backslashes",
  })
  // Control characters can be used to smuggle a newline into a Location header.
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "next must not contain control characters",
  });

export const DEFAULT_REDIRECT = "/today";

/**
 * Returns a safe in-app path, falling back to /today for anything unrecognised.
 * Never returns a value that could leave the origin.
 */
export function safeRedirect(next: string | null | undefined): string {
  if (!next) return DEFAULT_REDIRECT;
  const parsed = nextParam.safeParse(next);
  return parsed.success ? parsed.data : DEFAULT_REDIRECT;
}
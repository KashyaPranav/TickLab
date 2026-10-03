import { describe, it, expect } from "vitest";
import { safeRedirect, DEFAULT_REDIRECT } from "@/lib/auth/redirect";
import { authErrorMessage } from "@/lib/auth/errors";

describe("safeRedirect", () => {
  it("keeps a normal in-app path", () => {
    expect(safeRedirect("/today")).toBe("/today");
    expect(safeRedirect("/habits")).toBe("/habits");
  });

  it("falls back when nothing is supplied", () => {
    expect(safeRedirect(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("http://evil.example")).toBe(DEFAULT_REDIRECT);
  });

  // "//evil.example" is protocol-relative: assigning it to a Location header
  // sends the browser to another origin, which is the open redirect this
  // function exists to prevent.
  it("rejects protocol-relative URLs", () => {
    expect(safeRedirect("//evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("//evil.example/path")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects backslash tricks", () => {
    expect(safeRedirect("/\\evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("\\\\evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects non-http schemes", () => {
    expect(safeRedirect("javascript:alert(1)")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("data:text/html,<script>")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects control characters used for header smuggling", () => {
    expect(safeRedirect("/today\r\nSet-Cookie: a=b")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/today\nLocation: //evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/today\u0000")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects absurdly long input", () => {
    expect(safeRedirect(`/${"a".repeat(600)}`)).toBe(DEFAULT_REDIRECT);
  });

  it("never returns a value that leaves the origin", () => {
    const hostile = [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/today\r\nSet-Cookie: a=b",
    ];
    for (const value of hostile) {
      const result = safeRedirect(value);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
    }
  });
});

describe("authErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage("")).toBeNull();
  });

  it("maps known codes to copy", () => {
    expect(authErrorMessage("consent_cancelled")).toContain("cancelled");
    expect(authErrorMessage("auth_failed")).toContain("failed");
  });

  // An unrecognised code is never echoed back; only the generic message is.
  it("does not echo an unknown code back to the user", () => {
    const result = authErrorMessage("<script>alert(1)</script>");
    expect(result).not.toContain("script");
    expect(result).toBe("Something went wrong signing in. Please try again.");
  });
});
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

const { GET } = await import("@/app/auth/callback/route");

function request(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3100"));
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("exchanges a code and lands on /today by default", async () => {
    const response = await GET(request("/auth/callback?code=valid-code"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3100/today");
  });

  it("honours a safe same-origin next", async () => {
    const response = await GET(request("/auth/callback?code=valid-code&next=/habits"));
    expect(response.headers.get("location")).toBe("http://localhost:3100/habits");
  });

  it("refuses an off-origin next and falls back to /today", async () => {
    const response = await GET(
      request("/auth/callback?code=valid-code&next=//evil.example/steal"),
    );
    expect(response.headers.get("location")).toBe("http://localhost:3100/today");
  });

  it("maps a cancelled consent screen to its own error code", async () => {
    const response = await GET(request("/auth/callback?error=access_denied"));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/login?error=consent_cancelled",
    );
  });

  it("maps any other provider error to a generic code", async () => {
    const response = await GET(request("/auth/callback?error=server_error"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/login?error=auth_failed",
    );
  });

  it("does not call the exchange when there is no code", async () => {
    const response = await GET(request("/auth/callback"));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/login?error=auth_failed",
    );
  });

  it("reports a failed exchange instead of redirecting as signed in", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: "Invalid or expired code" },
    });

    const response = await GET(request("/auth/callback?code=expired"));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/login?error=auth_failed",
    );
  });

  it("drops an unsafe next even when the exchange succeeds", async () => {
    const response = await GET(
      request("/auth/callback?code=valid-code&next=https://evil.example"),
    );
    expect(response.headers.get("location")).toBe("http://localhost:3100/today");
  });
});
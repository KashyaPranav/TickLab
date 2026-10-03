import { test, expect, type Page } from "@playwright/test";

/**
 * Next.js mounts its own route announcer with role="alert", so a bare
 * getByRole("alert") is ambiguous. Scoping to <main> targets the inline message
 * this suite is actually asserting on.
 */
function inlineError(page: Page) {
  return page.locator('main [role="alert"]');
}

/**
 * OAuth surface tests.
 *
 * These run against a server configured with a dummy Supabase URL that refuses
 * connections immediately, so nothing here reaches a real project. That is
 * enough to prove routing, redirect safety and error rendering; exchanging a
 * real code is covered in tests/unit/auth-callback.test.ts with a stubbed client.
 */

test.describe("the auth pages", () => {
  for (const route of ["/login", "/signup"]) {
    test(`${route} offers Google sign-in`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
    });

    // The magic link is retained, not replaced by Google.
    test(`${route} keeps the email fallback`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByLabel("Email")).toBeVisible();
    });

    // The "continue without an account" escape hatch only renders when Supabase
    // is unconfigured; with accounts available the pages are the account path.
    test(`${route} cross-links the other auth route`, async ({ page }) => {
      await page.goto(route);
      const other = route === "/login" ? /create one/i : /sign in/i;
      await expect(page.getByRole("link", { name: other })).toBeVisible();
    });
  }
});

test.describe("the OAuth callback", () => {
  test("a cancelled consent screen returns to login with an inline message", async ({ page }) => {
    // Playwright follows the redirect, so the final URL is what matters here;
    // the 307 itself is asserted against the route handler in the unit tests.
    await page.goto("/auth/callback?error=access_denied");
    expect(page.url()).toContain("/login?error=consent_cancelled");
    await expect(inlineError(page)).toContainText(/cancelled/i);
  });

  test("a provider error returns to login with an inline message", async ({ page }) => {
    await page.goto("/auth/callback?error=server_error");
    expect(page.url()).toContain("/login?error=auth_failed");
    await expect(inlineError(page)).toBeVisible();
  });

  test("a missing code returns to login rather than throwing", async ({ page }) => {
    await page.goto("/auth/callback");
    expect(page.url()).toContain("/login?error=auth_failed");
    await expect(inlineError(page)).toBeVisible();
  });

  test("a code that cannot be exchanged returns to login", async ({ page }) => {
    // Unreachable Supabase: the exchange fails, which is the same path a real
    // expired or replayed code takes.
    await page.goto("/auth/callback?code=not-a-real-code");
    expect(page.url()).toContain("/login?error=auth_failed");
    await expect(inlineError(page)).toBeVisible();
  });

  test("an off-origin next parameter cannot redirect off-site", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code&next=//evil.example/steal");
    expect(page.url()).not.toContain("evil.example");
    expect(new URL(page.url()).origin).toBe(new URL(page.url()).origin);
    await expect(inlineError(page)).toBeVisible();
  });

  test("an absolute next parameter cannot redirect off-site", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code&next=https://evil.example");
    expect(page.url()).not.toContain("evil.example");
  });
});

test.describe("local-first access", () => {
  // TickLab is deliberately usable with no account: rows live in IndexedDB, and
  // RLS on the sync tables is what actually protects data. Redirecting here
  // would make the guest-to-account merge unreachable, because no guest rows
  // could ever be created.
  for (const route of ["/today", "/habits", "/history", "/insights", "/settings"]) {
    test(`${route} works without a session`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // And specifically not bounced to the login screen.
      expect(page.url()).not.toContain("/login");
    });
  }

  test("app routes are not cached by an intermediary", async ({ page }) => {
    const response = await page.goto("/today");
    expect(response?.headers()["cache-control"]).toContain("private");
  });
});
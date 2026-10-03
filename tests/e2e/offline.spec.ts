import { expect, test } from "@playwright/test";

/**
 * The promise TickLab makes is that the app works with no network. These tests
 * hold us to it: visit online, go offline, and confirm the screens still load
 * and still accept check-ins.
 */

test.describe("offline behaviour", () => {
  test("the service worker registers and caches the shell", async ({ page }) => {
    await page.goto("/today");

    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      undefined,
      { timeout: 15_000 },
    );

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find((n) => n.startsWith("ticklab-shell"));
      if (!shell) return null;
      const cache = await caches.open(shell);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });

    expect(cached).not.toBeNull();
    // The offline screen and the main routes must be there before we cut the net.
    expect(cached).toContain("/offline");
    expect(cached).toContain("/today");
  });

  test("routes render with the network cut", async ({ page, context }) => {
    await page.goto("/today");
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      undefined,
      { timeout: 15_000 },
    );

    await context.setOffline(true);

    for (const path of ["/today", "/habits", "/history", "/insights", "/settings"]) {
      const response = await page.goto(path);
      // A served document, not the browser's network error page.
      expect(response?.ok(), `${path} should load offline`).toBe(true);
      await expect(
        page.getByRole("heading", { name: path.slice(1), exact: false }).first(),
      ).toBeVisible();
    }

    await context.setOffline(false);
  });

  test("a check-in made offline survives a reload", async ({ page, context }) => {
    await page.goto("/habits");
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      undefined,
      { timeout: 15_000 },
    );

    await context.setOffline(true);

    await page.goto("/habits");
    await page.getByRole("button", { name: "New habit" }).click();
    await page.getByLabel("Name").fill("Offline habit");
    await page.getByRole("button", { name: "Save habit" }).click();

    await expect(page.getByText("Offline habit")).toBeVisible();

    // Reload while still offline: the data comes from IndexedDB, not the network.
    await page.reload();
    await expect(page.getByText("Offline habit")).toBeVisible();

    await context.setOffline(false);
  });
});
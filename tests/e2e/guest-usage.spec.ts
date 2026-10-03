import { test, expect } from "@playwright/test";

/**
 * The core local-first promise, driven through the UI rather than the DB layer.
 *
 * The DB functions have always accepted a null owner, but /today used to throw
 * "Sign in to save check-ins" before calling them, so a signed-out visitor could
 * create a habit and then never check it off. That also made the guest-to-account
 * merge unreachable, because no guest check-ins could exist.
 *
 * These run with no session; the Supabase URL points at a closed port.
 */

test.describe("signed out", () => {
  test("can create a habit and check it off", async ({ page }) => {
    await page.goto("/habits");
    await page.getByRole("button", { name: "New habit" }).click();
    await page.getByLabel(/name/i).first().fill("Meditate");
    await page.getByRole("button", { name: /save|create|add habit/i }).last().click();

    await expect(page.getByText("Meditate")).toBeVisible();

    await page.goto("/today");
    const check = page.getByRole("button", { name: "Check in Meditate" });
    await expect(check).toBeVisible();

    await check.click();

    // The summary must actually move, and the row must offer to undo.
    await expect(page.getByText("1/1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo Meditate" })).toBeVisible();
  });

  test("check-ins survive a reload", async ({ page }) => {
    await page.goto("/habits");
    await page.getByRole("button", { name: "New habit" }).click();
    await page.getByLabel(/name/i).first().fill("Read");
    await page.getByRole("button", { name: /save|create|add habit/i }).last().click();
    // The Dexie write is async; wait for the row before navigating away, or the
    // page load can win the race and see an empty database.
    await expect(page.getByText("Read")).toBeVisible();

    await page.goto("/today");
    await page.getByRole("button", { name: "Check in Read" }).click();
    await expect(page.getByText("1/1")).toBeVisible();

    await page.reload();
    await expect(page.getByText("1/1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo Read" })).toBeVisible();
  });

  test("a check-in is queued for sync, not lost", async ({ page }) => {
    await page.goto("/habits");
    await page.getByRole("button", { name: "New habit" }).click();
    await page.getByLabel(/name/i).first().fill("Stretch");
    await page.getByRole("button", { name: /save|create|add habit/i }).last().click();
    await expect(page.getByText("Stretch")).toBeVisible();

    await page.goto("/today");
    await page.getByRole("button", { name: "Check in Stretch" }).click();

    await page.goto("/settings");
    // Habit creation plus the check-in are both pending; the exact count is not
    // important, that there is a queue at all is.
    await expect(page.getByText(/waiting to sync/)).toBeVisible();
  });
});
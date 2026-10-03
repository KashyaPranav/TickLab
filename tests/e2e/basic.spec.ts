import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import sharp from "sharp";

test("landing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TickLab/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your streak survives");
});

test("landing page fits the viewport without scrolling", async ({ page }) => {
  await page.goto("/");
  const metrics = await page.evaluate(() => ({
    scrollsHorizontally: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollsVertically: document.documentElement.scrollHeight > window.innerHeight,
  }));
  expect(metrics.scrollsHorizontally).toBe(false);
  expect(metrics.scrollsVertically).toBe(false);
});

test.describe("the try-it card", () => {
  // The card has a slow float animation, so Playwright would otherwise wait
  // forever for it to be "stable" before clicking.
  test.use({ reducedMotion: "reduce" });

  test("tracks progress and celebrates a completed day", async ({ page }) => {
    await page.goto("/");

    const rows = page.getByRole("checkbox");
    await expect(rows).toHaveCount(4);

    // One habit starts checked, so the demo opens mid-way rather than empty.
    await expect(page.locator(".lp-ring span")).toHaveText("25%");

    for (const name of ["Gym session", "Read something new", "8 glasses of water"]) {
      await page.getByRole("checkbox", { name: new RegExp(name) }).click();
    }

    await expect(page.locator(".lp-ring span")).toHaveText("100%");
    await expect(page.getByText("Day complete. Streak extended.")).toBeVisible();
    await expect(page.locator(".lp-card")).toHaveClass(/full/);

    // Un-ticking must retract the celebration, not leave it stuck on.
    await page.getByRole("checkbox", { name: /Gym session/ }).click();
    await expect(page.locator(".lp-ring span")).toHaveText("75%");
    await expect(page.getByText("Day complete. Streak extended.")).toBeHidden();
  });
});

test.describe("the rotating headline", () => {
  /**
   * Asserted as timing contract rather than by watching pixels: the four words
   * share one 10s cycle and must be offset by exactly 2.5s each. If those drift,
   * two words overlap or the line goes blank between them, and a sampling test
   * would only catch it by luck on a loaded machine.
   */
  test("words are staggered one quarter-cycle apart", async ({ page }) => {
    await page.goto("/");

    const timing = await page.evaluate(() =>
      [...document.querySelectorAll(".lp-rot span")].map((span) => {
        const style = getComputedStyle(span);
        return {
          word: span.textContent,
          duration: parseFloat(style.animationDuration),
          delay: parseFloat(style.animationDelay),
          name: style.animationName,
        };
      }),
    );

    expect(timing.map((t) => t.word)).toEqual([
      "tunnels",
      "flights",
      "dead zones",
      "new phones",
    ]);
    for (const t of timing) {
      expect(t.name, `${t.word} should be animated`).toBe("word");
      expect(t.duration, `${t.word} cycle length`).toBe(10);
    }
    expect(timing.map((t) => t.delay)).toEqual([0, 2.5, 5, 7.5]);
  });

  /**
   * Guards the bug where the gradient sat on .lp-rot instead of each span.
   * Chromium then built the text mask from the whole subtree and ignored the
   * spans' opacity, so all four words rendered on top of each other: computed
   * opacity cycled correctly while the pixels never changed. Counting ink over
   * time is the only thing that actually distinguishes those two outcomes.
   */
  test("only the leading word is actually painted", async ({ page }) => {
    await page.goto("/");
    // The drifting background orbs also register as saturated pixels.
    await page.addStyleTag({ content: ".lp-orb,.lp-grid{visibility:hidden!important}" });

    const box = await page.locator(".lp-rot").boundingBox();
    assert(box, "rotating word should have a box");

    const inkPerSample: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { data, info } = await sharp(await page.screenshot({ clip: box! }))
        .raw()
        .toBuffer({ resolveWithObject: true });
      let ink = 0;
      for (let p = 0; p < data.length; p += info.channels) {
        const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
        if (Math.max(r, g, b) > 110 && (Math.abs(r - g) > 25 || Math.abs(g - b) > 25)) ink++;
      }
      inkPerSample.push(ink);
      await page.waitForTimeout(700);
    }

    // "tunnels" and "dead zones" differ enough in glyphs that a genuine rotation
    // must produce more than one distinct ink level.
    expect(new Set(inkPerSample).size, `ink levels: ${inkPerSample.join(",")}`).toBeGreaterThan(1);
    expect(Math.max(...inkPerSample), "some word is visible").toBeGreaterThan(0);
  });

  test("falls back to a single static word when motion is reduced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const opacities = await page.evaluate(() =>
      [...document.querySelectorAll(".lp-rot span")].map(
        (span) => +getComputedStyle(span).opacity,
      ),
    );
    expect(opacities[0], "first word stays readable").toBe(1);
    expect(opacities.slice(1).every((o) => o === 0), "others stay hidden").toBe(true);
  });
});

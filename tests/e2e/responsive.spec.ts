import { expect, test } from "@playwright/test";

/**
 * Layout guards.
 *
 * These exist because a habit tracker gets opened on whatever phone is in your
 * hand, and the worst possible failure here is a habit you cannot tick off
 * because the button is off-screen.
 */

const ROUTES = ["/", "/today", "/habits", "/history", "/insights", "/settings", "/login", "/signup"];

/** 320 is the narrowest phone still in real use; 430 is a large one. */
const VIEWPORTS = [
  { name: "small", width: 320, height: 640 },
  { name: "phone", width: 375, height: 667 },
  { name: "large", width: 430, height: 932 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route} does not scroll sideways`, async ({ page }) => {
        await page.goto(route);
        await expect(page.locator("body")).toBeVisible();

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            // Which element is actually sticking out, if any.
            culprit: (() => {
              const widest = [...document.querySelectorAll<HTMLElement>("body *")]
                .map((el) => ({
                  tag: el.tagName.toLowerCase(),
                  right: el.getBoundingClientRect().right,
                }))
                .sort((a, b) => b.right - a.right)[0];
              return widest && widest.right > doc.clientWidth + 1 ? widest.tag : null;
            })(),
          };
        });

        expect(
          overflow.scrollWidth,
          `${route} overflows by ${
            overflow.scrollWidth - overflow.clientWidth
          }px (widest: ${overflow.culprit ?? "unknown"})`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      });
    }
  });
}

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("every main route is reachable from the nav", async ({ page }) => {
    await page.goto("/today");

    for (const label of ["Habits", "History", "Insights", "Settings"]) {
      const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label });
      await expect(link).toBeVisible();
    }
  });

  test("the primary action is reachable without sideways scrolling", async ({ page }) => {
    await page.goto("/habits");
    await expect(page.getByRole("button", { name: "New habit" })).toBeInViewport();
  });
});
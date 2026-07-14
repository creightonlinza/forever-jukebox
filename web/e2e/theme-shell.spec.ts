import { expect, test } from "@playwright/test";

test.describe("theme", () => {
  test("toggles light/dark, persists fj-theme, applies before first paint on reload", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("body")).not.toHaveClass(/theme-light/);

    // theme lives in the settings modal (radio group)
    const lightRadio = page.locator(
      'input[name="settings-theme"][value="light"]',
    );
    const darkRadio = page.locator(
      'input[name="settings-theme"][value="dark"]',
    );

    await page.locator("#settings-open").click();
    await lightRadio.check();
    await expect(page.locator("body")).toHaveClass(/theme-light/);
    await expect(lightRadio).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("fj-theme"))).toBe(
      "light",
    );
    await page.locator("#settings-close").click();

    // hard reload — theme must apply pre-paint from fj-theme
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/theme-light/);
    await page.locator("#settings-open").click();
    await expect(lightRadio).toBeChecked();

    await darkRadio.check();
    await expect(page.locator("body")).not.toHaveClass(/theme-light/);
    expect(await page.evaluate(() => localStorage.getItem("fj-theme"))).toBe(
      "dark",
    );
  });
});

test.describe("shell chrome", () => {
  test("footer renders the credit (with host line when configured)", async ({
    page,
  }) => {
    await page.goto("/");
    const credit = page.locator("#site-footer-credit");
    await expect(credit).toContainText(
      "Forever Jukebox & Analysis Engine by",
    );
    await expect(credit.locator("a").first()).toHaveAttribute(
      "href",
      "https://creighton.dev",
    );
  });

  test("FOUC guard class is removed after load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/app-loading/, {
      timeout: 5_000,
    });
  });

  test("toast element exists, empty, with live-region semantics", async ({
    page,
  }) => {
    await page.goto("/");
    const toast = page.locator("#toast");
    await expect(toast).toHaveClass(/\btoast-stack\b/);
    await expect(toast).toBeEmpty();
    await expect(toast).toHaveAttribute("role", "status");
    await expect(toast).toHaveAttribute("aria-live", "polite");
  });
});

test.describe("cast entry", () => {
  test("/cast serves the vanilla cast receiver", async ({ page }) => {
    await page.goto("/cast");
    await expect(page).toHaveTitle(/Cast/);
    // the receiver page is not the React app
    await expect(page.locator("#app")).toHaveCount(0);
  });
});

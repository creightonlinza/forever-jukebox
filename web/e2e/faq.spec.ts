import { expect, test } from "@playwright/test";

test.describe("FAQ panel", () => {
  test("renders content sections and the offline app link", async ({
    page,
  }) => {
    await page.goto("/faq");
    await expect(page.locator("#faq-panel")).toContainText("What the what?");
    await expect(page.locator("#faq-panel")).toContainText(
      "How can I tune the Jukebox?",
    );
    await expect(
      page.locator('#faq-panel a[href="/offline/"]'),
    ).toBeAttached();
    await expect(page.locator("#faq-whats-new-panel")).toHaveClass(
      /\bhidden\b/,
    );
  });
});

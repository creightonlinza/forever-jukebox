import { expect, test } from "@playwright/test";
import { expectToast, loadFirstTopTrack } from "./helpers";

test.describe("report track", () => {
  test("reports a loaded track with the chosen reason", async ({ page }) => {
    // Mock the report so no real data is written.
    const reportBodies: unknown[] = [];
    await page.route("**/api/reports/*", (route) => {
      if (route.request().method() === "POST") {
        reportBodies.push(route.request().postDataJSON());
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok" }),
        });
      }
      return route.continue();
    });
    const trackId = await loadFirstTopTrack(page);

    // Assumes the first top track is outside the 30-minute delete window.
    const reportButton = page.locator("#report-track");
    await expect(page.locator("#delete-job")).toHaveClass(/\bhidden\b/);
    await expect(reportButton).not.toHaveClass(/\bhidden\b/);

    await reportButton.click();
    const modal = page.locator("#report-track-modal");
    const submit = page.locator("#report-track-submit");
    await expect(modal).toHaveClass(/\bopen\b/);
    await expect(submit).toBeDisabled();

    // Each radio sits on the same row as its label text.
    const reasons = modal.locator(".report-reason");
    await expect(reasons).toHaveCount(3);
    for (const reason of await reasons.all()) {
      const radio = await reason.locator("input").boundingBox();
      const text = await reason.locator("span").boundingBox();
      expect(radio && text).toBeTruthy();
      expect(text!.x).toBeGreaterThan(radio!.x);
      expect(text!.y).toBeLessThan(radio!.y + radio!.height);
    }

    // escape path keeps the track unreported
    await page.keyboard.press("Escape");
    await expect(modal).not.toHaveClass(/\bopen\b/);
    expect(reportBodies).toHaveLength(0);

    await reportButton.click();
    await expect(submit).toBeDisabled();
    await modal.locator('input[value="bad_audio"]').check();
    await expect(submit).toBeEnabled();
    const reportRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/api/reports/${trackId}`),
    );
    await submit.click();
    await reportRequest;

    await expectToast(page, "Track reported");
    await expect(modal).not.toHaveClass(/\bopen\b/);
    expect(reportBodies).toEqual([{ reason: "bad_audio" }]);
  });

  test("admins get the delete button instead of the report flag", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("fj-admin-key", "e2e-not-a-real-key");
    });
    await loadFirstTopTrack(page);
    await expect(page.locator("#delete-job")).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator("#report-track")).toHaveClass(/\bhidden\b/);
  });
});

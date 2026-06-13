import { expect, test } from "@playwright/test";
import { loadFirstTopTrack } from "./helpers";

test.describe("branch stats", () => {
  test("popup appears for a selected edge when stats are enabled", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    // enable branch stats via extras
    await page.keyboard.press("e");
    await page.locator("#extras-enabled").check();
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);

    await expect(page.locator("#branch-stats-popup")).toHaveClass(
      /\bhidden\b/,
    );
    // Selecting an edge requires canvas hit-testing. Sweep a fixed, dense grid
    // across the branch-arc band (deterministic for a given viz layout) until
    // the popup appears. These are hard assertions, not skips: a track is
    // always loaded by this point, so a non-measurable viz or a grid that
    // finds no edge is a real failure — not something to silently pass.
    const box = await page.locator("#viz-layer").boundingBox();
    expect(box, "viz layer must be measurable after a track loads").toBeTruthy();
    const fractionsX = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
    const fractionsY = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
    let shown = false;
    for (const fy of fractionsY) {
      for (const fx of fractionsX) {
        await page.mouse.click(
          box!.x + box!.width * fx,
          box!.y + box!.height * fy,
        );
        shown = await page
          .locator("#branch-stats-popup")
          .evaluate((el) => !el.classList.contains("hidden"))
          .catch(() => false);
        if (shown) {
          break;
        }
      }
      if (shown) {
        break;
      }
    }
    expect(
      shown,
      "a branch-stats popup should appear for some edge under the grid sweep",
    ).toBe(true);
    await expect(page.locator("#branch-stats-title")).toContainText(
      /Branch #\d+ stats/,
    );
    await expect(page.locator("#branch-stats-direction")).toContainText(
      /Backward|Forward|Same beat/,
    );
    await expect(page.locator("#branch-stats-similarity")).toContainText(/%/);
  });
});

test.describe("track deletion", () => {
  test("delete button hidden for ineligible tracks without admin mode", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    // fixture tracks are old (>30min), so the affordance must be hidden
    await expect(page.locator("#delete-job")).toHaveClass(/\bhidden\b/);
  });

  test("admin mode reveals delete; confirm flow handles failure (mocked)", async ({
    page,
  }) => {
    // Mock the DELETE so this never touches real data, even within the
    // backend's post-completion delete window.
    await page.route("**/api/jobs/*", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Invalid admin key" }),
        });
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      localStorage.setItem("fj-admin-key", "e2e-not-a-real-key");
    });
    await loadFirstTopTrack(page);
    const deleteButton = page.locator("#delete-job");
    await expect(deleteButton).not.toHaveClass(/\bhidden\b/);
    await expect(deleteButton).toHaveAttribute("title", "Delete track");

    // cancel path
    await deleteButton.click();
    const modal = page.locator("#delete-confirm-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    await expect(page.locator("#delete-confirm-cancel")).toBeFocused();
    await page.locator("#delete-confirm-cancel").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);

    // escape path
    await deleteButton.click();
    await expect(modal).toHaveClass(/\bopen\b/);
    await page.keyboard.press("Escape");
    await expect(modal).not.toHaveClass(/\bopen\b/);

    // confirm path → server rejects → failure toast, modal closes
    await deleteButton.click();
    await page.locator("#delete-confirm-delete").click();
    await expect(page.locator("#toast")).toContainText(
      "Unable to delete track",
    );
    await expect(modal).not.toHaveClass(/\bopen\b/);
    // track is still loaded
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/);
  });

  test("playback shortcuts are suppressed while the delete confirm is open", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("fj-admin-key", "e2e-not-a-real-key");
    });
    await loadFirstTopTrack(page);
    await page.locator("#delete-job").click();
    await expect(page.locator("#delete-confirm-modal")).toHaveClass(
      /\bopen\b/,
    );
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Play",
    );
  });
});

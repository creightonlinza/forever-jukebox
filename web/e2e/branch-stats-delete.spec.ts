import { expect, test, type Page } from "@playwright/test";
import { loadFirstTopTrack } from "./helpers";

// Enable the branch-stats overlay (extras) so selecting an edge reveals its
// popup. Shared by every test that needs a selected edge.
async function enableBranchStats(page: Page) {
  await page.keyboard.press("e");
  await page.locator("#extras-enabled").check();
  await page.locator("#tuning-apply").click();
  await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);
}

// Selecting an edge requires canvas hit-testing. Sweep a fixed, dense grid
// across the branch-arc band (deterministic for a given viz layout) until the
// popup appears, which means an edge is now the store's selectedEdge. A hard
// assertion: a track is loaded by this point, so finding no edge is a real
// failure, not something to silently pass.
async function selectAnyEdge(page: Page) {
  await expect(page.locator("#branch-stats-popup")).toHaveClass(/\bhidden\b/);
  const box = await page.locator("#viz-layer").boundingBox();
  expect(box, "viz layer must be measurable after a track loads").toBeTruthy();
  const fractionsX = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
  const fractionsY = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
  let shown = false;
  for (const fy of fractionsY) {
    for (const fx of fractionsX) {
      await page.mouse.click(box!.x + box!.width * fx, box!.y + box!.height * fy);
      shown = await page
        .locator("#branch-stats-popup")
        .evaluate((el) => !el.classList.contains("hidden"))
        .catch(() => false);
      if (shown) break;
    }
    if (shown) break;
  }
  expect(
    shown,
    "a branch-stats popup should appear for some edge under the grid sweep",
  ).toBe(true);
}

async function selectedBranchNumber(page: Page): Promise<number> {
  const text = (await page.locator("#branch-stats-title").textContent()) ?? "";
  const match = text.match(/Branch #(\d+)/);
  expect(match, `branch title should carry an id, got: ${text}`).toBeTruthy();
  return Number(match![1]);
}

test.describe("branch stats", () => {
  test("popup appears for a selected edge when stats are enabled", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await enableBranchStats(page);
    await selectAnyEdge(page);
    await expect(page.locator("#branch-stats-title")).toContainText(
      /Branch #\d+ stats/,
    );
    await expect(page.locator("#branch-stats-direction")).toContainText(
      /Backward|Forward|Same beat/,
    );
    await expect(page.locator("#branch-stats-similarity")).toContainText(/%/);
  });
});

test.describe("branch keyboard operations", () => {
  test("Arrow keys cycle the selected branch", async ({ page }) => {
    await loadFirstTopTrack(page);
    await enableBranchStats(page);
    await selectAnyEdge(page);
    const start = await selectedBranchNumber(page);

    // ArrowRight advances to a different edge; the popup stays open.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#branch-stats-popup")).not.toHaveClass(
      /\bhidden\b/,
    );
    const afterRight = await selectedBranchNumber(page);
    expect(afterRight).not.toBe(start);

    // ArrowLeft is the inverse step — back to where we started.
    await page.keyboard.press("ArrowLeft");
    expect(await selectedBranchNumber(page)).toBe(start);
  });

  test("'a' sets and resets an anchor branch on a backward edge", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await enableBranchStats(page);
    await selectAnyEdge(page);

    // Anchoring is only valid for a backward branch (dest before src). Step
    // through edges with ArrowRight until we land on one, then exercise 'a'.
    let foundBackward = false;
    for (let i = 0; i < 60; i++) {
      const direction =
        (await page.locator("#branch-stats-direction").textContent()) ?? "";
      if (/Backward/.test(direction)) {
        foundBackward = true;
        break;
      }
      await page.keyboard.press("ArrowRight");
    }
    expect(
      foundBackward,
      "the fixture track should expose at least one backward branch",
    ).toBe(true);

    await page.keyboard.press("a");
    await expect(page.locator("#toast")).toContainText("Anchor branch set");
    // anchor is serialized into the tuning params on the URL
    await expect(page).toHaveURL(/[?&]/);

    await page.keyboard.press("a");
    await expect(page.locator("#toast")).toContainText("Anchor branch reset");
  });

  test("Delete removes the selected branch and closes the popup", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await enableBranchStats(page);
    await selectAnyEdge(page);
    await expect(page.locator("#branch-stats-popup")).not.toHaveClass(
      /\bhidden\b/,
    );

    await page.keyboard.press("Delete");
    // deleting clears selectedEdge → popup hides, and the deletion is
    // serialized into the URL so it survives a reload/share.
    await expect(page.locator("#branch-stats-popup")).toHaveClass(/\bhidden\b/);
    await expect(page).toHaveURL(/[?&]/);
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

  test("successful delete (mocked) clears the favorite, toasts, and returns to Top", async ({
    page,
  }) => {
    // Mock the DELETE as a success WITHOUT touching real data.
    await page.route("**/api/jobs/*", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ status: 204, body: "" });
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      localStorage.setItem("fj-admin-key", "e2e-not-a-real-key");
    });
    const trackId = await loadFirstTopTrack(page);

    // Favorite it first so the delete exercises the favorite-removal branch.
    await page.locator("#favorite-toggle").click();
    await expect(page.locator("#favorite-toggle")).toHaveClass(/\bactive\b/);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("fj-favorites") ?? "[]").length,
      ),
    ).toBe(1);

    await page.locator("#delete-job").click();
    await page.locator("#delete-confirm-delete").click();

    await expect(page.locator("#toast")).toContainText("Deleted track");
    // navigated back to the Top tab (away from the deleted track)
    await expect(page.locator('[data-tab-button="top"]')).toHaveClass(
      /\bactive\b/,
    );
    await expect(page).not.toHaveURL(new RegExp(trackId));
    // the favorite was removed as part of the delete
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("fj-favorites") ?? "[]").length,
        ),
      )
      .toBe(0);
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

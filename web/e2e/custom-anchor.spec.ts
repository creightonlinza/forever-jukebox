import { expect, test, type Page } from "@playwright/test";
import { expected, loadFixtureTrack, mockFixtureTrack } from "./fixture-track";

const BEATS = expected("auto_threshold").totalBeats;
// The Arc layout lays beats on one line: x = 30 + (width - 60) * i / (count - 1), y = height / 2.
const ARC_PADDING_X = 30;

async function openExtras(page: Page) {
  await page.keyboard.press("e");
  await expect(page.locator("#tuning-modal")).toHaveClass(/\bopen\b/);
}

// Reads "Jump from 289" / "Land on 23" from the toolbar buttons.
async function readPair(page: Page): Promise<{ src: number; dest: number }> {
  const ends = page.locator("#custom-anchor-toolbar .custom-anchor-end");
  const [src, dest] = await Promise.all(
    [0, 1].map(async (index) => {
      const label = (await ends.nth(index).getAttribute("aria-label")) ?? "";
      return Number(/(\d+)$/.exec(label)?.[1]);
    }),
  );
  return { src, dest };
}

async function beatPoint(page: Page, index: number) {
  const box = await page.locator("#viz-layer canvas").last().boundingBox();
  if (!box) {
    throw new Error("viz overlay canvas has no box");
  }
  return {
    x: box.x + ARC_PADDING_X + ((box.width - 2 * ARC_PADDING_X) * index) / (BEATS - 1),
    y: box.y + box.height / 2,
  };
}

async function openEditor(page: Page) {
  await page.locator("#custom-anchor-start").click();
  await expect(page.locator("#custom-anchor-toolbar")).toBeVisible();
  await expect(page.locator("#custom-anchor-info")).toBeVisible();
}

test.describe("custom anchor editor", () => {
  test.beforeEach(async ({ page }) => {
    await mockFixtureTrack(page);
  });

  test("the Extras toggle shows the editor button and stays on after a reload", async ({
    page,
  }) => {
    await loadFixtureTrack(page);
    await expect(page.locator("#custom-anchor-start")).toHaveCount(0);

    await openExtras(page);
    await page.locator("#custom-anchor-enabled").check();
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#custom-anchor-start")).toBeVisible();

    await page.reload();
    await expect(page.locator("#custom-anchor-start")).toBeVisible({ timeout: 45_000 });

    await openExtras(page);
    await page.locator("#custom-anchor-enabled").uncheck();
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#custom-anchor-start")).toHaveCount(0);
  });

  test.describe("on the Arc layout", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem("fj-custom-anchor-enabled", "1");
        window.localStorage.setItem("fj-viz", "0");
      });
    });

    test("a dragged end commits as an ab beat pair that a shared link restores", async ({
      page,
    }) => {
      await loadFixtureTrack(page);
      await openEditor(page);
      await expect(page.locator("#viz-select")).toHaveCount(0);
      const start = await readPair(page);
      const target = Math.max(start.dest + 20, start.src - 40);
      expect(target).not.toBe(start.src);

      const from = await beatPoint(page, start.src);
      const to = await beatPoint(page, target);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();

      await expect(page).toHaveURL(new RegExp(`[?&]ab=${target}-${start.dest}(?:&|$)`));
      expect(await readPair(page)).toEqual({ src: target, dest: start.dest });

      await loadFixtureTrack(page, `?ab=${target}-${start.dest}`);
      await openEditor(page);
      expect(await readPair(page)).toEqual({ src: target, dest: start.dest });
    });

    test("keys nudge the selected end, Snap lands on the same beat of the bar, Reset drops ab", async ({
      page,
    }) => {
      await loadFixtureTrack(page);
      await openEditor(page);
      const start = await readPair(page);

      await page.locator("#custom-anchor-toolbar .custom-anchor-end").nth(1).click();
      await page.keyboard.press("ArrowRight");
      await expect(page).toHaveURL(new RegExp(`[?&]ab=${start.src}-${start.dest + 1}(?:&|$)`));

      await page.locator("#custom-anchor-snap").click();
      await expect(page.locator("#custom-anchor-info .custom-anchor-info-warn")).toHaveCount(0);

      await page.locator("#custom-anchor-reset").click();
      await expect(page).not.toHaveURL(/[?&]ab=/);
      expect(await readPair(page)).toEqual(start);
    });

    test("Escape closes the editor and gives the selects back", async ({ page }) => {
      await loadFixtureTrack(page);
      await openEditor(page);
      await page.keyboard.press("Escape");
      await expect(page.locator("#custom-anchor-toolbar")).toHaveCount(0);
      await expect(page.locator("#custom-anchor-info")).toHaveCount(0);
      await expect(page.locator("#viz-select")).toBeVisible();
      await expect(page.locator("#custom-anchor-start")).toBeVisible();
    });

    test("an ab pair that does not fit the track is ignored", async ({ page }) => {
      await loadFixtureTrack(page, `?ab=${BEATS + 50}-3`);
      await openEditor(page);
      const pair = await readPair(page);
      expect(pair.src).toBeLessThan(BEATS);
    });
  });
});

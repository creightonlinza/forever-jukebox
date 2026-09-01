import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { setRangeValue, waitForTrackLoaded } from "./helpers";

// A pinned engine contract driven through the real UI. The analysis is the
// CC0 fixture that packages/shared replays in realAnalysisParityFixtures, so a
// branch count here and a branch count there are the same number: the app is
// wired to the engine the fixture describes, or this fails.
const FIXTURE_JOB_ID = "0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e";

type FixtureCase = {
  id: string;
  config: { currentThreshold: number };
  expected: {
    computedThreshold: number;
    totalBeats: number;
    activeEdgeCount: number;
  };
};

type DeletionCase = {
  id: string;
  deleteEdgeIds: number[];
  expected: {
    activeEdgeCountBefore: number;
    activeEdgeCountAfter: number;
    deletedEdgeCount: number;
  };
};

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../test-fixtures/engine-parity/real-analysis-cases.json",
    ),
    "utf8",
  ),
) as {
  analysis: unknown;
  cases: FixtureCase[];
  deletion_cases: DeletionCase[];
};

function expected(caseId: string) {
  const found = fixture.cases.find((testCase) => testCase.id === caseId);
  if (!found) {
    throw new Error(`missing parity fixture case: ${caseId}`);
  }
  return found.expected;
}

// The engine reads the analysis, never the samples, and these tests never play:
// a short silence keeps the audio path real without committing a media file or
// pushing megabytes through every load while the rest of the suite runs.
function silentWav(seconds: number, sampleRate = 8000): Buffer {
  const frames = Math.ceil(seconds * sampleRate);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

const SILENT_AUDIO = silentWav(5);

async function mockFixtureTrack(page: Page) {
  await page.route(`**/api/analysis/${FIXTURE_JOB_ID}`, (route) =>
    route.fulfill({
      json: {
        status: "complete",
        id: FIXTURE_JOB_ID,
        progress: 100,
        source_id: null,
        source_provider: null,
        created_at: "2020-01-01T00:00:00+00:00",
        result: fixture.analysis,
      },
    }),
  );
  await page.route(`**/api/audio/${FIXTURE_JOB_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: SILENT_AUDIO,
    }),
  );
}

async function loadFixtureTrack(page: Page, search = "") {
  await page.goto(`/listen/${FIXTURE_JOB_ID}${search}`);
  await waitForTrackLoaded(page);
}

async function readBranchCount(page: Page): Promise<number> {
  await page.locator("#track-info").click();
  await expect(page.locator("#info-modal")).toHaveClass(/\bopen\b/);
  const text = await page.locator("#info-branches").textContent();
  await page.keyboard.press("Escape");
  await expect(page.locator("#info-modal")).not.toHaveClass(/\bopen\b/);
  return Number(text);
}

test.describe("engine output lock", () => {
  test.beforeEach(async ({ page }) => {
    await mockFixtureTrack(page);
  });

  test("a fresh load lands on the pinned default threshold and branch count", async ({
    page,
  }) => {
    const auto = expected("auto_threshold");
    await loadFixtureTrack(page);

    await page.locator("#tuning").click();
    await expect(page.locator("#computed-threshold")).toHaveText(
      String(auto.computedThreshold),
    );
    await expect(page.locator("#threshold")).toHaveValue(
      String(auto.computedThreshold),
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);

    await page.locator("#track-info").click();
    await expect(page.locator("#info-beats")).toHaveText(String(auto.totalBeats));
    await expect(page.locator("#info-branches")).toHaveText(
      String(auto.activeEdgeCount),
    );
    await expect(page.locator("#info-deleted-branches")).toHaveText("0");
  });

  test("moving the threshold in the tuning modal lands on the pinned count", async ({
    page,
  }) => {
    const target = expected("threshold_30");
    await loadFixtureTrack(page);
    expect(await readBranchCount(page)).toBe(
      expected("auto_threshold").activeEdgeCount,
    );

    await page.locator("#tuning").click();
    await setRangeValue(page, "#threshold", "30");
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(/thresh=30/);

    expect(await readBranchCount(page)).toBe(target.activeEdgeCount);
  });

  test("the threshold sweep reproduces the pinned branch counts", async ({
    page,
  }) => {
    for (const threshold of [20, 35, 50, 80]) {
      const target = expected(`threshold_${threshold}`);
      await loadFixtureTrack(page, `?thresh=${threshold}`);
      expect(
        await readBranchCount(page),
        `branch count at threshold ${threshold}`,
      ).toBe(target.activeEdgeCount);
    }
  });

  test("branch filters reproduce their pinned counts", async ({ page }) => {
    const filters: Array<[string, string]> = [
      ["?jb=1", "just_backwards_at_auto"],
      ["?bl=10", "long_branches_10_pct_at_auto"],
      ["?bl=20", "just_long_branches_at_auto"],
      ["?sq=0", "remove_sequential_at_auto"],
      ["?jb=1&bl=20", "backwards_and_long_at_auto"],
    ];
    for (const [search, caseId] of filters) {
      await loadFixtureTrack(page, search);
      expect(await readBranchCount(page), `branch count for ${search}`).toBe(
        expected(caseId).activeEdgeCount,
      );
    }
  });

  // d= carries engine edge ids, so it only means anything while edge
  // construction order holds; the parity fixture pins the ids and the count
  // they remove.
  test("deleted branches from the URL drop the pinned count", async ({
    page,
  }) => {
    const deletion = fixture.deletion_cases[0];
    await loadFixtureTrack(page, `?d=${deletion.deleteEdgeIds.join(",")}`);

    await page.locator("#track-info").click();
    await expect(page.locator("#info-modal")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#info-branches")).toHaveText(
      String(deletion.expected.activeEdgeCountAfter),
    );
    await expect(page.locator("#info-deleted-branches")).toHaveText(
      String(deletion.expected.deletedEdgeCount),
    );
  });
});

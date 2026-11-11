import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { waitForTrackLoaded } from "./helpers";

// The CC0 analysis that packages/shared replays in realAnalysisParityFixtures, served
// through mocked routes so specs can rely on its exact beats and branches.
export const FIXTURE_JOB_ID = "0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e";

export type FixtureCase = {
  id: string;
  config: { currentThreshold: number };
  expected: {
    computedThreshold: number;
    totalBeats: number;
    activeEdgeCount: number;
  };
};

export type DeletionCase = {
  id: string;
  deleteEdgeIds: number[];
  expected: {
    activeEdgeCountBefore: number;
    activeEdgeCountAfter: number;
    deletedEdgeCount: number;
  };
};

export const fixture = JSON.parse(
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

export function expected(caseId: string) {
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

export async function mockFixtureTrack(page: Page) {
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

export async function loadFixtureTrack(page: Page, search = "") {
  await page.goto(`/listen/${FIXTURE_JOB_ID}${search}`);
  await waitForTrackLoaded(page);
}

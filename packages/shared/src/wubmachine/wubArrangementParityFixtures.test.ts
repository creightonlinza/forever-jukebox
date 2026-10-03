import { describe, expect, it, vi } from "vitest";

vi.mock("./dubstepRenderer", () => ({ renderDubstepRemix: vi.fn() }));
vi.mock("../audio/rubberBandAdapter", () => ({
  RubberBandWorkerAdapter: class {},
}));
vi.mock("./dubstepSamples", () => ({ dubstepSampleUrl: vi.fn() }));

import {
  WUB_ARRANGEMENT_FIXTURE,
  analysisOfCase,
  planToFixture,
  readFixtureJson,
  type FixtureDoc,
} from "../../scripts/wubArrangementFixture";
import { planDubstepRemix } from "./dubstepArrangement";
import { WUB_MACHINE_ARRANGEMENT } from "./wubMachineRender";

// Shared with forever-jukebox-android (WubArrangementParityFixtureTest): the
// same analyses and options must plan the same remix on both platforms.
// Regenerate with scripts/generate-wub-arrangement-fixture.ts.
describe("wub-arrangement-cases.json", () => {
  const doc = readFixtureJson<FixtureDoc>(WUB_ARRANGEMENT_FIXTURE);

  it("holds cases", () => {
    expect(doc.schema_version).toBe(1);
    expect(doc.cases.length).toBeGreaterThan(0);
  });

  it("pins the house arrangement", () => {
    const { contiguous, sectionBudget, skipQuiet, contrast, fills } =
      WUB_MACHINE_ARRANGEMENT;
    const house = doc.cases.find((testCase) => testCase.id === "real_house");
    expect(house?.options).toEqual({
      contiguous,
      sectionBudget,
      skipQuiet,
      contrast,
      fills,
    });
  });

  for (const testCase of doc.cases) {
    it(`plans ${testCase.id} as pinned`, () => {
      const plan = planDubstepRemix(
        analysisOfCase(testCase),
        testCase.options ?? {},
      );
      expect(planToFixture(plan)).toEqual(testCase.expected);
    });
  }
});

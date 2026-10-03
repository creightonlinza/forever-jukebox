import { describe, expect, it } from "vitest";
import { DUBSTEP_SAMPLE_NAMES } from "./dubstepArrangement";
import { dubstepSampleUrl } from "./dubstepSamples";

describe("dubstepSampleUrl", () => {
  it("resolves every sample a plan can name", () => {
    expect(DUBSTEP_SAMPLE_NAMES).toHaveLength(41);
    for (const name of DUBSTEP_SAMPLE_NAMES) {
      expect(dubstepSampleUrl(name)).toContain(".webm");
    }
  });

  it("rejects unknown samples", () => {
    expect(() => dubstepSampleUrl("wubs/h")).toThrow("Unknown dubstep sample");
  });
});

import { describe, expect, it } from "vitest";
import { jobStep } from "./jobProgress";

describe("jobStep", () => {
  it("maps API status and engine progress to loading steps", () => {
    const step = (status: string, progress: number | null) => {
      const { activeId, progress: stepProgress } = jobStep(status, progress);
      return [activeId, stepProgress];
    };
    expect(step("downloading", null)).toEqual(["fetch", null]);
    expect(step("downloading", 10)).toEqual(["fetch", 0.4]);
    expect(step("processing", 0)).toEqual(["beats", null]);
    expect(step("processing", 47.5)).toEqual(["beats", 0.5]);
    expect(step("processing", 90)).toEqual(["features", 0.5]);
    expect(step("processing", 95)).toEqual(["track", null]);
  });

  it("reads the queue position from the server message", () => {
    expect(jobStep("queued", 25, "Queued • 3 ahead of you").queuedAhead).toBe(3);
    expect(jobStep("queued", 25, null).queuedAhead).toBeNull();
  });
});

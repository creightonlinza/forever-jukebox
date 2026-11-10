import { describe, expect, it } from "vitest";
import { jobLoadingStep } from "./job-progress";

describe("jobLoadingStep", () => {
  it("shows the queue position from the server message", () => {
    expect(jobLoadingStep("queued", 25, "Queued • 3 ahead of you").message?.()).toBe(
      "Queued • 3 ahead of you",
    );
    expect(jobLoadingStep("queued", 25, null).message?.()).toBe("Queued • Next in line");
  });
});

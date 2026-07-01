import { describe, expect, it } from "vitest";
import { translateJobProgress } from "./job-progress";

describe("translateJobProgress", () => {
  it("uses stable status and progress values for known API states", () => {
    expect(translateJobProgress("downloading", null, "server text")).toBe(
      "Fetching audio",
    );
    expect(translateJobProgress("processing", 5, "server text")).toBe(
      "Processing",
    );
    expect(translateJobProgress("processing", 50, "server text")).toBe(
      "Analyzing",
    );
    expect(translateJobProgress("processing", 95, "server text")).toBe(
      "Wrapping up",
    );
    expect(translateJobProgress("queued", null, "Queued • 3 ahead of you")).toBe(
      "Queued • 3 ahead of you",
    );
  });

  it("preserves unknown server messages as a fallback", () => {
    expect(translateJobProgress("custom", null, "Custom server status")).toBe(
      "Custom server status",
    );
  });
});

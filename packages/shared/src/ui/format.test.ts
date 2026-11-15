import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("format", () => {
  it("formats duration as hh:mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(61)).toBe("00:01:01");
    expect(formatDuration(3661)).toBe("01:01:01");
  });
});

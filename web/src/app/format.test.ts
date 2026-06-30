import { describe, expect, it } from "vitest";
import {
  formatCursorTime,
  formatDuration,
  formatTrackDuration,
} from "./format";

describe("format", () => {
  it("formats duration as hh:mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(61)).toBe("00:01:01");
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("formats track duration as m:ss, adding hours only when needed", () => {
    expect(formatTrackDuration("nope")).toBe("-");
    expect(formatTrackDuration(Number.NaN)).toBe("-");
    expect(formatTrackDuration(1)).toBe("0:01");
    expect(formatTrackDuration(61)).toBe("1:01");
    expect(formatTrackDuration(3599)).toBe("59:59");
    expect(formatTrackDuration(3661)).toBe("1:01:01");
  });

  it("formats cursor times with unbounded minutes", () => {
    expect(formatCursorTime(0)).toBe("0:00");
    expect(formatCursorTime(125)).toBe("2:05");
    expect(formatCursorTime(3735)).toBe("62:15");
  });
});

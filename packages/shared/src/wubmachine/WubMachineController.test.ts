import { describe, expect, it } from "vitest";
import { loopedPosition } from "./WubMachineController";

describe("loopedPosition", () => {
  it("advances linearly when not looping", () => {
    expect(loopedPosition(10, 100, false, 13, 90)).toBe(110);
  });

  it("wraps from the loop end back to the loop start", () => {
    expect(loopedPosition(10, 50, true, 13, 90)).toBe(60);
    expect(loopedPosition(10, 80, true, 13, 90)).toBe(13);
    expect(loopedPosition(10, 85, true, 13, 90)).toBe(18);
    expect(loopedPosition(10, 80 + 77 * 3 + 5, true, 13, 90)).toBe(18);
  });
});

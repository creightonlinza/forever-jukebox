import { describe, expect, it } from "vitest";
import {
  clampSwingAmount,
  DEFAULT_SWING_AMOUNT,
  getSwingSegmentsForBeat,
} from "./swingTiming";

describe("swing timing", () => {
  it("uses 0.33 as the default swing amount", () => {
    expect(DEFAULT_SWING_AMOUNT).toBe(0.33);
  });

  it("clamps swing amount defensively", () => {
    expect(clampSwingAmount(2)).toBe(0.9);
    expect(clampSwingAmount(-2)).toBe(-0.9);
    expect(clampSwingAmount(Number.NaN)).toBe(DEFAULT_SWING_AMOUNT);
  });

  it("splits a 1 second beat into default swing output durations", () => {
    const [first, second] = getSwingSegmentsForBeat({
      start: 10,
      duration: 1,
    });

    expect(first.outputDuration).toBeCloseTo(0.665, 12);
    expect(second.outputDuration).toBeCloseTo(0.335, 12);
    expect(first.outputDuration + second.outputDuration).toBeCloseTo(1, 12);
  });

  it("calculates playback rates as input duration over output duration", () => {
    const [first, second] = getSwingSegmentsForBeat({
      start: 0,
      duration: 1,
    });

    expect(first.playbackRate).toBeCloseTo(first.inputDuration / first.outputDuration);
    expect(second.playbackRate).toBeCloseTo(second.inputDuration / second.outputDuration);
  });

  it("lines up segment input starts and durations", () => {
    const [first, second] = getSwingSegmentsForBeat({
      start: 4,
      duration: 2,
    });

    expect(first.inputStart).toBe(4);
    expect(first.inputDuration).toBe(1);
    expect(second.inputStart).toBe(5);
    expect(second.inputDuration).toBe(1);
  });
});

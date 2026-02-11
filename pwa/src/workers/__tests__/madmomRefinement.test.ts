import { describe, expect, it } from "vitest";
import {
  buildBeatEvents,
  buildEnergy,
  refineEventTimes,
} from "../../../public/madmom/refinement.js";

describe("madmom beat refinement", () => {
  it("builds energy by summing beat and downbeat activations", () => {
    const energy = buildEnergy({
      beat: [0.1, 0.2, 0.3],
      downbeat: [0.9, 0.8],
    });
    expect(energy).toEqual([1.0, 1.0, 0.3]);
  });

  it("snaps to a stronger neighboring peak and applies sub-frame interpolation", () => {
    const fps = 100;
    const energy = [0.0, 1.0, 3.0, 2.0, 0.0];
    const refined = refineEventTimes([{ time_sec: 0.015 }], energy, fps);
    expect(refined).toHaveLength(1);
    // Nearest frame is 2, parabola around frame 2 shifts by +1/6 frame.
    expect(refined[0].time_sec).toBeCloseTo((2 + 1 / 6) / fps, 6);
    expect(refined[0].confidence).toBeCloseTo(1, 6);
  });

  it("falls back to midpoint confidence for flat energy windows", () => {
    const refined = refineEventTimes([{ time_sec: 0.03 }], [0.2, 0.2, 0.2], 100);
    expect(refined[0].confidence).toBe(0.5);
  });

  it("resets beat numbering when a downbeat aligns within tolerance", () => {
    const beats = [
      { time_sec: 0.0, confidence: 1.0 },
      { time_sec: 0.5, confidence: 0.9 },
      { time_sec: 1.0, confidence: 0.8 },
      { time_sec: 1.5, confidence: 0.7 },
      { time_sec: 2.0, confidence: 0.6 },
    ];
    const fps = 100;
    const downbeats = [{ time_sec: 0.0 }, { time_sec: 2.0 + 0.009 }];
    const events = buildBeatEvents(beats, downbeats, fps);
    expect(events.map((event) => event[1])).toEqual([1, 2, 3, 4, 1]);
  });
});

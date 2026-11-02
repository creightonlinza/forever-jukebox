import { describe, expect, it } from "vitest";
import { computeBeatColors } from "./beatColors";
import type { QuantumBase, Segment } from "./types";

function segment(t1: number, t2: number, t3: number) {
  return { timbre: [0, t1, t2, t3, 0, 0, 0, 0, 0, 0, 0, 0] } as Segment;
}

function beat(overlappingSegments: Segment[]) {
  return { overlappingSegments } as QuantumBase;
}

describe("computeBeatColors", () => {
  it("maps normalized timbre 1-3 to blue, red and green", () => {
    const low = segment(-10, -20, -30);
    const high = segment(10, 20, 30);
    const mixed = segment(10, -20, -30);
    expect(
      computeBeatColors([beat([low]), beat([high]), beat([mixed])], [low, high, mixed]),
    ).toEqual(["#000000", "#ffffff", "#0000ff"]);
  });

  it("uses a neutral color for beats without segments", () => {
    expect(computeBeatColors([beat([])], [])).toEqual(["#333333"]);
  });
});

import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { Edge } from "@forever-jukebox/shared";
import {
  branchDirection,
  deriveBranchStats,
  nextEdgeIndex,
  toSimilarityPercent,
} from "./branches";

const t = ((key: string) => key) as unknown as TFunction;

function edge(
  srcWhich: number,
  srcStart: number,
  destWhich: number,
  destStart: number,
  distance = 20,
): Edge {
  return {
    id: 7,
    src: { which: srcWhich, start: srcStart },
    dest: { which: destWhich, start: destStart },
    distance,
    deleted: false,
  } as unknown as Edge;
}

describe("branch helpers", () => {
  it("converts distance to a clamped similarity percent", () => {
    expect(toSimilarityPercent(0, 80)).toBe(100);
    expect(toSimilarityPercent(40, 80)).toBe(50);
    expect(toSimilarityPercent(160, 80)).toBe(0);
    expect(toSimilarityPercent(Number.NaN, 80)).toBe(0);
    expect(toSimilarityPercent(10, 0)).toBe(0);
  });

  it("cycles edge indices in both directions", () => {
    expect(nextEdgeIndex(0, 1, 3)).toBe(1);
    expect(nextEdgeIndex(2, 1, 3)).toBe(0);
    expect(nextEdgeIndex(0, -1, 3)).toBe(2);
    expect(nextEdgeIndex(-1, 1, 3)).toBe(0);
    expect(nextEdgeIndex(-1, -1, 3)).toBe(2);
  });

  it("describes branch direction by beat order", () => {
    expect(branchDirection(edge(10, 0, 4, 0), t)).toBe("listen.backward");
    expect(branchDirection(edge(4, 0, 10, 0), t)).toBe("listen.forward");
    expect(branchDirection(edge(4, 0, 4, 0), t)).toBe("listen.sameBeat");
  });

  it("derives formatted branch stats for the popup", () => {
    expect(deriveBranchStats(edge(12, 10.9, 4, 7.2, 20), 80, t)).toEqual({
      id: 7,
      start: "00:00:10",
      end: "00:00:07",
      delta: "-00:00:03",
      startBeat: "12",
      endBeat: "4",
      beatDelta: "-8",
      direction: "listen.backward",
      similarity: "75%",
    });
    expect(deriveBranchStats(edge(4, 7.2, 12, 10.9, 0), 80, t)).toMatchObject({
      delta: "+00:00:03",
      beatDelta: "+8",
      direction: "listen.forward",
      similarity: "100%",
    });
  });
});

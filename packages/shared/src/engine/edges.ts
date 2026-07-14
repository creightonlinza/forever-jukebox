import type { Edge } from "./types";

// A forward and a backward branch between the same pair of beats are twins:
// most layouts draw them as one arc, so a click on the arc may have grabbed
// the forward one when the user meant the backward one.
export function findBackwardTwin(
  edges: readonly Edge[],
  edge: Edge,
): Edge | null {
  return (
    edges.find(
      (candidate) =>
        !candidate.deleted &&
        candidate.src.which === edge.dest.which &&
        candidate.dest.which === edge.src.which,
    ) ?? null
  );
}

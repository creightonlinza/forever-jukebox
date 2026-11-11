export const BEAT_SELECT_RADIUS_PX = 8;
export const EDGE_SELECT_RADIUS_PX = 8;
export const MAX_EDGE_SAMPLES = 300;
export const MAX_EDGES_BASE = 2500;
export const BEAT_AVOID_RADIUS_PX = 6;
export const ANCHOR_HIGHLIGHT_COLOR = "#ff2d2d";
// Custom anchor match quality; poor keeps the anchor red.
export const ANCHOR_MATCH_COLORS = {
  good: "#3ddc84",
  fair: "#ffb020",
  poor: ANCHOR_HIGHLIGHT_COLOR,
} as const;
export const VISUALIZATION_LABELS = [
  "Arc",
  "Classic",
  "Galaxy",
  "Grid",
  "Infinite",
  "Wave",
] as const;

export const DEFAULT_VISUALIZATION_INDEX = Math.max(
  0,
  VISUALIZATION_LABELS.indexOf("Classic")
);

type VisualizationLabel = (typeof VISUALIZATION_LABELS)[number];

// Layouts that draw a forward and a backward branch between the same beats
// apart, so a forward selection there is deliberate. The label type makes a
// rename in VISUALIZATION_LABELS a compile error here instead of a silently
// lost capability.
const SEPARATES_PAIRED_EDGES: ReadonlySet<VisualizationLabel> = new Set(["Arc"]);

export function visualizationSeparatesPairedEdges(index: number): boolean {
  const label = VISUALIZATION_LABELS[index];
  return label !== undefined && SEPARATES_PAIRED_EDGES.has(label);
}

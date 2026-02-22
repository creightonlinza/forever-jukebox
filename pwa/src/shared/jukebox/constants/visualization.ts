export const ANALYSIS_POLL_INTERVAL_MS = 2000;
export const LISTEN_TIMER_INTERVAL_MS = 200;
export const TOP_SONGS_REFRESH_MS = 250;
export const TOP_SONGS_LIMIT = 25;
export const SEARCH_RESULTS_LIMIT = 10;
export const BEAT_SELECT_RADIUS_PX = 8;
export const EDGE_SELECT_RADIUS_PX = 8;
export const MAX_EDGE_SAMPLES = 300;
export const MAX_EDGES_BASE = 2500;
export const BEAT_AVOID_RADIUS_PX = 6;
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

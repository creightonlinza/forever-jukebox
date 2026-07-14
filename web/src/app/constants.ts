export {
  BEAT_AVOID_RADIUS_PX,
  BEAT_SELECT_RADIUS_PX,
  DEFAULT_VISUALIZATION_INDEX,
  EDGE_SELECT_RADIUS_PX,
  MAX_EDGE_SAMPLES,
  MAX_EDGES_BASE,
  VISUALIZATION_LABELS,
  visualizationSeparatesPairedEdges,
} from "@forever-jukebox/engine/constants/visualization";

export const ANALYSIS_POLL_INTERVAL_MS = 3000;
export const LISTEN_TIMER_INTERVAL_MS = 200;
export const TOP_SONGS_LIMIT = 25;

// localStorage keys for the viz controls. Shared so the writer (playback-ui)
// and the reader (VizTop's checkbox seed) can never drift apart.
export const VIZ_STORAGE_KEY = "fj-viz";
export const CANONIZER_FINISH_KEY = "fj-canonizer-finish";

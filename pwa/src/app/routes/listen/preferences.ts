import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "@/shared/utils/safeStorage";
import {
  DEFAULT_VISUALIZATION_INDEX,
  VISUALIZATION_LABELS,
} from "@forever-jukebox/shared/constants/visualization";

const CANONIZER_FINISH_STORAGE_KEY = "fj-canonizer-finish";
const VISUALIZATION_STORAGE_KEY = "fj-viz";
const ANCHOR_HIGHLIGHT_STORAGE_KEY = "fj-highlight-anchor-branch";
const BRANCH_STATS_STORAGE_KEY = "fj-branch-stats-enabled";

export function coerceVisualizationIndex(index: number) {
  if (
    Number.isFinite(index) &&
    index >= 0 &&
    index < VISUALIZATION_LABELS.length
  ) {
    return index;
  }
  return DEFAULT_VISUALIZATION_INDEX;
}

export function resolveStoredVisualizationIndex() {
  const raw = safeLocalStorageGet(VISUALIZATION_STORAGE_KEY);
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    return coerceVisualizationIndex(parsed);
  }
  return DEFAULT_VISUALIZATION_INDEX;
}

export function storeVisualizationIndex(index: number) {
  safeLocalStorageSet(VISUALIZATION_STORAGE_KEY, String(index));
}

export function resolveStoredFinishOutSong(): boolean {
  return safeLocalStorageGet(CANONIZER_FINISH_STORAGE_KEY) === "true";
}

export function storeFinishOutSong(enabled: boolean) {
  safeLocalStorageSet(CANONIZER_FINISH_STORAGE_KEY, String(enabled));
}

export function resolveStoredAnchorHighlight(): boolean {
  const stored = safeLocalStorageGet(ANCHOR_HIGHLIGHT_STORAGE_KEY);
  return stored === "1" || stored === "true";
}

export function resolveStoredBranchStatsEnabled(): boolean {
  const stored = safeLocalStorageGet(BRANCH_STATS_STORAGE_KEY);
  return stored === "1" || stored === "true";
}

export function storeAnchorHighlight(enabled: boolean) {
  safeLocalStorageSet(ANCHOR_HIGHLIGHT_STORAGE_KEY, enabled ? "1" : "0");
}

export function storeBranchStatsEnabled(enabled: boolean) {
  safeLocalStorageSet(BRANCH_STATS_STORAGE_KEY, enabled ? "1" : "0");
}

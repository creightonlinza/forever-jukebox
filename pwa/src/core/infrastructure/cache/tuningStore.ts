import type { JukeboxConfig } from "@forever-jukebox/engine";

// Per-song tuning is auto-saved in localStorage, keyed by the same fingerprint
// used for the cached analysis. Removal is centralized in analysisCache.ts so
// deleting an analysis (individually or via clear-all) also drops its tuning.
const PREFIX = "fj-tuning:";

// The subset of engine config that represents user tuning (everything except
// the fixed structural limits maxBranches / maxBranchThreshold).
export type SavedTuningConfig = Pick<
  JukeboxConfig,
  | "currentThreshold"
  | "justBackwards"
  | "justLongBranches"
  | "removeSequentialBranches"
  | "minRandomBranchChance"
  | "maxRandomBranchChance"
  | "randomBranchChanceDelta"
  | "minLongBranchPercent"
>;

export type SavedTuning = {
  v: 1;
  config: SavedTuningConfig;
  deletedEdgeIds: number[];
  anchorEdgeId: number | null;
};

function keyFor(fingerprint: string) {
  return `${PREFIX}${fingerprint}`;
}

export function loadTuning(fingerprint: string): SavedTuning | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(fingerprint));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SavedTuning>;
    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.config !== "object" ||
      parsed.config === null
    ) {
      return null;
    }
    const deletedEdgeIds = Array.isArray(parsed.deletedEdgeIds)
      ? parsed.deletedEdgeIds.filter(
          (id): id is number => typeof id === "number" && Number.isFinite(id),
        )
      : [];
    const anchorEdgeId =
      typeof parsed.anchorEdgeId === "number" &&
      Number.isFinite(parsed.anchorEdgeId)
        ? parsed.anchorEdgeId
        : null;
    return {
      v: 1,
      config: parsed.config as SavedTuningConfig,
      deletedEdgeIds,
      anchorEdgeId,
    };
  } catch {
    return null;
  }
}

export function saveTuning(fingerprint: string, tuning: SavedTuning): void {
  try {
    window.localStorage.setItem(keyFor(fingerprint), JSON.stringify(tuning));
  } catch {
    // Ignore storage failures.
  }
}

export function removeTuning(fingerprint: string): void {
  try {
    window.localStorage.removeItem(keyFor(fingerprint));
  } catch {
    // Ignore storage failures.
  }
}

export function clearAllTuning(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

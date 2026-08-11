import {
  DEFAULT_JUKEBOX_CONFIG,
  DEFAULT_MIN_LONG_BRANCH_PERCENT,
  parsePinnedThreshold,
  type JukeboxConfig,
} from "@forever-jukebox/shared";

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

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

// Stored tuning is hand-editable and survives app upgrades, so every field is
// re-read rather than trusted. Anything unusable falls back to the engine
// default, which for the threshold means auto.
function normalizeConfig(raw: Record<string, unknown>): SavedTuningConfig {
  const defaults = DEFAULT_JUKEBOX_CONFIG;
  const minLongBranchPercent = raw.minLongBranchPercent;
  // Each probability is normalized on its own, so one falling back to its
  // default can invert the pair. Reorder them the same way applying the tuning
  // form does, rather than handing the engine a minimum above its maximum.
  let minRandomBranchChance = numberInRange(
    raw.minRandomBranchChance,
    0,
    1,
    defaults.minRandomBranchChance,
  );
  let maxRandomBranchChance = numberInRange(
    raw.maxRandomBranchChance,
    0,
    1,
    defaults.maxRandomBranchChance,
  );
  if (minRandomBranchChance > maxRandomBranchChance) {
    [minRandomBranchChance, maxRandomBranchChance] = [
      maxRandomBranchChance,
      minRandomBranchChance,
    ];
  }
  return {
    currentThreshold: parsePinnedThreshold(raw.currentThreshold) ?? 0,
    justBackwards: boolOr(raw.justBackwards, defaults.justBackwards),
    justLongBranches: boolOr(raw.justLongBranches, defaults.justLongBranches),
    removeSequentialBranches: boolOr(
      raw.removeSequentialBranches,
      defaults.removeSequentialBranches,
    ),
    minRandomBranchChance,
    maxRandomBranchChance,
    randomBranchChanceDelta: numberInRange(
      raw.randomBranchChanceDelta,
      0,
      1,
      defaults.randomBranchChanceDelta,
    ),
    minLongBranchPercent:
      typeof minLongBranchPercent === "number" &&
      Number.isFinite(minLongBranchPercent) &&
      minLongBranchPercent > 0
        ? Math.min(minLongBranchPercent, 100)
        : DEFAULT_MIN_LONG_BRANCH_PERCENT,
  };
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
      config: normalizeConfig(parsed.config as Record<string, unknown>),
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

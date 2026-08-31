import type { AppContext } from "./context";
import { useAppStore } from "./store";
import {
  DEFAULT_MIN_LONG_BRANCH_PERCENT,
  parsePinnedThreshold,
  type JukeboxConfig,
} from "@forever-jukebox/shared";
import {
  DEFAULT_AUDIO_MODE_INTENSITY,
  parseAudioModeIntensityParam,
  setAudioModeIntensityParam,
  type JukeboxAudioMode,
} from "@forever-jukebox/shared/audio/audioModes";

const MIN_RANDOM_BRANCH_DELTA = 0;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const TUNING_PARAM_KEYS = [
  "jb",
  "lg",
  "bl",
  "sq",
  "thresh",
  "bp",
  "d",
  "am",
  "ai",
  "ab",
];
const MIN_LONG_BRANCH_PERCENT_OPTIONS = new Set([5, 10, 20, 30]);

function parseAudioMode(raw: string | null) {
  if (
    raw === "off" ||
    raw === "nightcore" ||
    raw === "daycore" ||
    raw === "vaporwave" ||
    raw === "eight_d" ||
    raw === "eight_bit" ||
    raw === "lofi" ||
    raw === "underwater" ||
    raw === "cathedral" ||
    raw === "cowbell" ||
    raw === "swing"
  ) {
    return raw;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mapPercentToRange(percent: number, min: number, max: number) {
  const safePercent = clamp(percent, 0, 100);
  return ((max - min) * safePercent) / 100 + min;
}

function mapValueToPercent(value: number, min: number, max: number) {
  const safeValue = clamp(value, min, max);
  return (100 * (safeValue - min)) / (max - min);
}

export function serializeParams(params: URLSearchParams): string {
  const pairs: string[] = [];
  params.forEach((value, key) => {
    const encodedKey = encodeURIComponent(key);
    let encodedValue = encodeURIComponent(value);
    if (key === "bp" || key === "d") {
      encodedValue = encodedValue.replace(/%2C/gi, ",");
    }
    pairs.push(`${encodedKey}=${encodedValue}`);
  });
  return pairs.join("&");
}

function filterTuningParams(params: URLSearchParams): URLSearchParams {
  const filtered = new URLSearchParams();
  for (const key of TUNING_PARAM_KEYS) {
    const value = params.get(key);
    if (value !== null) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

export function getTuningParamsFromUrl(): URLSearchParams {
  return filterTuningParams(new URLSearchParams(window.location.search));
}

function parseDeletedEdgeIds(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function parseAnchorBranchId(raw: string | null): number | null {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getDeletedEdgeIdsFromUrl(): number[] {
  return parseDeletedEdgeIds(
    new URLSearchParams(window.location.search).get("d"),
  );
}

export function getAnchorBranchIdFromUrl(): number | null {
  return parseAnchorBranchId(
    new URLSearchParams(window.location.search).get("ab"),
  );
}

export function getTuningParamsStringFromUrl(): string | null {
  const params = getTuningParamsFromUrl();
  const result = serializeParams(params);
  return result.length > 0 ? result : null;
}

export function hasTuningParamsInUrl(): boolean {
  return serializeParams(getTuningParamsFromUrl()).length > 0;
}

type ParsedTuning = {
  config: JukeboxConfig;
  // null when am is absent or invalid; "off" is a valid parsed value.
  audioMode: JukeboxAudioMode | null;
  audioIntensity: number;
  deletedEdgeIds: number[];
  anchorBranchId: number | null;
};

// The one parser for stored/URL tuning params: absent fields fall back to the
// given defaults.
function parseTuningParams(
  params: URLSearchParams,
  defaults: JukeboxConfig,
): ParsedTuning {
  const config = { ...defaults };
  if (params.get("jb") === "1") {
    config.justBackwards = true;
  }
  if (params.get("lg") === "1") {
    config.justLongBranches = true;
  }
  const minLongBranchPercent = Number.parseInt(params.get("bl") ?? "", 10);
  if (MIN_LONG_BRANCH_PERCENT_OPTIONS.has(minLongBranchPercent)) {
    config.justLongBranches = true;
    config.minLongBranchPercent = minLongBranchPercent;
  } else if (config.justLongBranches) {
    config.minLongBranchPercent =
      defaults.minLongBranchPercent ?? DEFAULT_MIN_LONG_BRANCH_PERCENT;
  }
  if (params.get("sq") === "0") {
    config.removeSequentialBranches = true;
  }
  if (params.has("thresh")) {
    config.currentThreshold = parsePinnedThreshold(params.get("thresh")) ?? 0;
  }
  if (params.has("bp")) {
    const fields = (params.get("bp") ?? "").split(",");
    if (fields.length === 3) {
      const minPct = Number.parseInt(fields[0] ?? "", 10);
      const maxPct = Number.parseInt(fields[1] ?? "", 10);
      const deltaPct = Number.parseInt(fields[2] ?? "", 10);
      if (Number.isFinite(minPct)) {
        config.minRandomBranchChance = mapPercentToRange(minPct, 0, 1);
      }
      if (Number.isFinite(maxPct)) {
        config.maxRandomBranchChance = mapPercentToRange(maxPct, 0, 1);
      }
      if (Number.isFinite(deltaPct)) {
        config.randomBranchChanceDelta = mapPercentToRange(
          deltaPct,
          MIN_RANDOM_BRANCH_DELTA,
          MAX_RANDOM_BRANCH_DELTA,
        );
      }
    }
  }
  const audioMode = parseAudioMode(params.get("am"));
  const audioIntensity = audioMode
    ? parseAudioModeIntensityParam(params.get("ai"), audioMode)
    : DEFAULT_AUDIO_MODE_INTENSITY;
  return {
    config,
    audioMode,
    audioIntensity,
    deletedEdgeIds: parseDeletedEdgeIds(params.get("d")),
    anchorBranchId: parseAnchorBranchId(params.get("ab")),
  };
}

export function applyTuningParamsToEngine(
  context: AppContext,
  params: URLSearchParams,
): boolean {
  const hasTuningParam = TUNING_PARAM_KEYS.some((key) => params.has(key));
  if (!hasTuningParam) {
    return false;
  }
  const parsed = parseTuningParams(params, context.defaultConfig);
  context.engine.updateConfig(parsed.config);
  const { audioMode, audioIntensity } = parsed;
  if (audioMode) {
    // Record the selection in state, but only arm the shared player and
    // cowbell overlay in jukebox mode — autocanonizer ignores tuning.
    useAppStore.setState({ jukeboxAudioMode: audioMode, audioIntensity });
    const inJukeboxMode = useAppStore.getState().playMode === "jukebox";
    if (audioMode === "cowbell" && inJukeboxMode) {
      context.cowbellOverlay.enable();
    } else {
      context.cowbellOverlay.disable();
    }
    if (audioMode !== "swing" && inJukeboxMode) {
      context.player.setJukeboxAudioMode(audioMode, audioIntensity);
    }
  }
  return true;
}

export function applyTuningParamsFromUrl(context: AppContext): boolean {
  const params = getTuningParamsFromUrl();
  const applied = applyTuningParamsToEngine(context, params);
  if (applied) {
    syncTuningParamsState(context);
  }
  return applied;
}

// The one builder for stored/URL tuning params: fixed key order, defaults
// omitted, deleted edge ids sorted and deduped.
function buildTuningParams(state: {
  config: JukeboxConfig;
  defaults: JukeboxConfig;
  deletedEdgeIds: number[];
  anchorBranchId: number | null;
  audioMode: JukeboxAudioMode;
  audioIntensity: number;
}): URLSearchParams {
  const { config, defaults } = state;
  const params = new URLSearchParams();
  if (config.justBackwards) {
    params.set("jb", "1");
  }
  if (config.justLongBranches) {
    params.set(
      "bl",
      `${
        config.minLongBranchPercent ??
        defaults.minLongBranchPercent ??
        DEFAULT_MIN_LONG_BRANCH_PERCENT
      }`,
    );
  }
  if (config.removeSequentialBranches) {
    params.set("sq", "0");
  }
  if (config.currentThreshold !== 0) {
    params.set("thresh", `${Math.round(config.currentThreshold)}`);
  }
  const minChanged =
    config.minRandomBranchChance !== defaults.minRandomBranchChance;
  const maxChanged =
    config.maxRandomBranchChance !== defaults.maxRandomBranchChance;
  const deltaChanged =
    config.randomBranchChanceDelta !== defaults.randomBranchChanceDelta;
  if (minChanged || maxChanged || deltaChanged) {
    const minPct = Math.round(
      mapValueToPercent(config.minRandomBranchChance, 0, 1),
    );
    const maxPct = Math.round(
      mapValueToPercent(config.maxRandomBranchChance, 0, 1),
    );
    const deltaPct = Math.round(
      mapValueToPercent(
        config.randomBranchChanceDelta,
        MIN_RANDOM_BRANCH_DELTA,
        MAX_RANDOM_BRANCH_DELTA,
      ),
    );
    params.set("bp", `${minPct},${maxPct},${deltaPct}`);
  }
  const deletedIds = [...new Set(state.deletedEdgeIds)].sort((a, b) => a - b);
  if (deletedIds.length > 0) {
    params.set("d", deletedIds.join(","));
  }
  if (state.anchorBranchId !== null) {
    params.set("ab", `${state.anchorBranchId}`);
  }
  appendAudioModeParams(params, state.audioMode, state.audioIntensity);
  return params;
}

export function getTuningParamsFromEngine(context: AppContext): URLSearchParams {
  const graph = context.engine.getGraphState();
  const { jukeboxAudioMode, audioIntensity } = useAppStore.getState();
  return buildTuningParams({
    config: context.engine.getConfig(),
    defaults: context.defaultConfig,
    deletedEdgeIds: graph
      ? graph.allEdges.filter((edge) => edge.deleted).map((edge) => edge.id)
      : useAppStore.getState().deletedEdgeIds,
    anchorBranchId: context.engine.getUserAnchorEdgeId?.() ?? null,
    audioMode: jukeboxAudioMode,
    audioIntensity,
  });
}

// Rewrites a stored tuning string through the one parser and one builder so
// spelling differences (key order, legacy aliases, explicit defaults, escaped
// commas, ah/unknown keys) collapse to a single canonical form.
export function canonicalizeTuningParams(
  raw: string | null | undefined,
  defaults: JukeboxConfig,
): string | null {
  if (raw == null || raw.trim() === "") {
    return null;
  }
  const params = filterTuningParams(new URLSearchParams(raw));
  const parsed = parseTuningParams(params, defaults);
  const built = buildTuningParams({
    config: parsed.config,
    defaults,
    deletedEdgeIds: parsed.deletedEdgeIds,
    anchorBranchId: parsed.anchorBranchId,
    audioMode: parsed.audioMode ?? "off",
    audioIntensity: parsed.audioIntensity,
  });
  const result = serializeParams(built);
  return result.length > 0 ? result : null;
}

export function savedTuningParamsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
  defaults: JukeboxConfig,
): boolean {
  return (
    canonicalizeTuningParams(a, defaults) ===
    canonicalizeTuningParams(b, defaults)
  );
}

// Serializes the am/ai pair for URLs and stored tuning params; "off" emits
// nothing.
export function appendAudioModeParams(
  params: URLSearchParams,
  audioMode: JukeboxAudioMode,
  audioIntensity: number,
) {
  if (audioMode !== "off") {
    params.set("am", audioMode);
    setAudioModeIntensityParam(params, audioMode, audioIntensity);
  }
}

// The audio-mode reset shared by track loads and tuning resets: store slice
// and player return to "off" at default intensity in one step.
export function resetAudioModeToOff(player: AppContext["player"]) {
  useAppStore.setState({
    jukeboxAudioMode: "off",
    audioIntensity: DEFAULT_AUDIO_MODE_INTENSITY,
  });
  player.setJukeboxAudioMode("off", DEFAULT_AUDIO_MODE_INTENSITY);
}

export function syncTuningParamsState(context: AppContext): string | null {
  const params = getTuningParamsFromEngine(context);
  const result = serializeParams(params);
  useAppStore.setState({ tuningParams: result.length > 0 ? result : null });
  return useAppStore.getState().tuningParams;
}

export function writeTuningParamsToUrl(
  tuningParams: string | null,
  replace = true,
) {
  const url = new URL(window.location.href);
  const merged = new URLSearchParams(url.search);
  for (const key of TUNING_PARAM_KEYS) {
    merged.delete(key);
  }
  if (tuningParams) {
    const params = new URLSearchParams(tuningParams);
    params.forEach((value, key) => {
      merged.set(key, value);
    });
  }
  const search = serializeParams(merged);
  url.search = search ? `?${search}` : "";
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function clearTuningParamsFromUrl(replace = true) {
  writeTuningParamsToUrl(null, replace);
}

import type { AppContext } from "./context";

const MIN_RANDOM_BRANCH_DELTA = 0;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const TUNING_PARAM_KEYS = ["jb", "lg", "sq", "thresh", "bp", "d", "am"];

function parseAudioMode(raw: string | null) {
  if (
    raw === "off" ||
    raw === "nightcore" ||
    raw === "daycore" ||
    raw === "vaporwave" ||
    raw === "eight_d" ||
    raw === "lofi" ||
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

export function getDeletedEdgeIdsFromUrl(): number[] {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("d");
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function getTuningParamsStringFromUrl(): string | null {
  const params = getTuningParamsFromUrl();
  const result = serializeParams(params);
  return result.length > 0 ? result : null;
}

export function hasTuningParamsInUrl(): boolean {
  return serializeParams(getTuningParamsFromUrl()).length > 0;
}

export function applyTuningParamsToEngine(
  context: AppContext,
  params: URLSearchParams,
): boolean {
  const hasTuningParam = TUNING_PARAM_KEYS.some((key) => params.has(key));
  if (!hasTuningParam) {
    return false;
  }
  const defaults = context.defaultConfig;
  const nextConfig = { ...defaults };
  if (params.get("jb") === "1") {
    nextConfig.justBackwards = true;
  }
  if (params.get("lg") === "1") {
    nextConfig.justLongBranches = true;
  }
  if (params.get("sq") === "0") {
    nextConfig.removeSequentialBranches = true;
  }
  if (params.has("thresh")) {
    const raw = Number.parseInt(params.get("thresh") ?? "", 10);
    if (Number.isFinite(raw) && raw >= 0) {
      nextConfig.currentThreshold = raw;
    }
  }
  if (params.has("bp")) {
    const fields = (params.get("bp") ?? "").split(",");
    if (fields.length === 3) {
      const minPct = Number.parseInt(fields[0] ?? "", 10);
      const maxPct = Number.parseInt(fields[1] ?? "", 10);
      const deltaPct = Number.parseInt(fields[2] ?? "", 10);
      if (Number.isFinite(minPct)) {
        nextConfig.minRandomBranchChance = mapPercentToRange(minPct, 0, 1);
      }
      if (Number.isFinite(maxPct)) {
        nextConfig.maxRandomBranchChance = mapPercentToRange(maxPct, 0, 1);
      }
      if (Number.isFinite(deltaPct)) {
        nextConfig.randomBranchChanceDelta = mapPercentToRange(
          deltaPct,
          MIN_RANDOM_BRANCH_DELTA,
          MAX_RANDOM_BRANCH_DELTA,
        );
      }
    }
  }
  context.engine.updateConfig(nextConfig);
  const audioMode = parseAudioMode(params.get("am"));
  if (audioMode) {
    context.state.jukeboxAudioMode = audioMode;
    if (audioMode === "cowbell") {
      context.cowbellOverlay.enable();
    } else {
      context.cowbellOverlay.disable();
    }
    if (audioMode !== "swing") {
      context.player.setJukeboxAudioMode(audioMode);
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

export function getTuningParamsFromEngine(context: AppContext): URLSearchParams {
  const params = new URLSearchParams();
  const config = context.engine.getConfig();
  const defaults = context.defaultConfig;
  const graph = context.engine.getGraphState();
  if (config.justBackwards) {
    params.set("jb", "1");
  }
  if (config.justLongBranches) {
    params.set("lg", "1");
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
  const deletedIds = graph
    ? graph.allEdges.filter((edge) => edge.deleted).map((edge) => edge.id)
    : context.state.deletedEdgeIds;
  if (deletedIds.length > 0) {
    params.set("d", deletedIds.join(","));
  }
  if (context.state.jukeboxAudioMode !== "off") {
    params.set("am", context.state.jukeboxAudioMode);
  }
  return params;
}

export function syncTuningParamsState(context: AppContext): string | null {
  const params = getTuningParamsFromEngine(context);
  const result = serializeParams(params);
  context.state.tuningParams = result.length > 0 ? result : null;
  return context.state.tuningParams;
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

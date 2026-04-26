import type { JukeboxEngine } from "../engine";
import type { JukeboxConfig } from "../engine/types";
import type { JukeboxAudioMode } from "../audio/BufferedAudioPlayer";

const MIN_RANDOM_BRANCH_DELTA = 0;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const TUNING_PARAM_KEYS = ["jb", "lg", "sq", "thresh", "bp", "d", "ah", "am"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mapPercentToRange(percent: number, min: number, max: number) {
  const safePercent = clamp(percent, 0, 100);
  return ((max - min) * safePercent) / 100 + min;
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

function parseAudioMode(raw: string | null): JukeboxAudioMode | null {
  if (
    raw === "off" ||
    raw === "nightcore" ||
    raw === "daycore" ||
    raw === "vaporwave" ||
    raw === "eight_d" ||
    raw === "lofi"
  ) {
    return raw;
  }
  return null;
}

export type CastParsedTuning = {
  config: JukeboxConfig;
  deletedEdgeIds: number[];
  highlightAnchorBranch: boolean;
  audioMode: JukeboxAudioMode | null;
  hasAudioModeParam: boolean;
  hasGraphTuning: boolean;
};

export function parseCastTuningParams(
  raw: string | null,
  defaults: JukeboxConfig,
): CastParsedTuning | null {
  if (!raw) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const hasTuningParam = TUNING_PARAM_KEYS.some((key) => params.has(key));
  if (!hasTuningParam) {
    return null;
  }
  const parseBool = (value: string | null): boolean | null => {
    if (value === null) {
      return null;
    }
    const normalized = value.toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
    return null;
  };
  const hasGraphTuning = ["jb", "lg", "sq", "thresh", "bp", "d"].some((key) =>
    params.has(key),
  );
  const nextConfig: JukeboxConfig = { ...defaults };
  const justBackwards = parseBool(params.get("jb"));
  if (justBackwards !== null) {
    nextConfig.justBackwards = justBackwards;
  }
  const justLongBranches = parseBool(params.get("lg"));
  if (justLongBranches !== null) {
    nextConfig.justLongBranches = justLongBranches;
  }
  if (params.has("sq")) {
    const rawSq = params.get("sq")?.toLowerCase() ?? "";
    if (rawSq === "0" || rawSq === "true") {
      nextConfig.removeSequentialBranches = true;
    } else if (rawSq === "1" || rawSq === "false") {
      nextConfig.removeSequentialBranches = false;
    }
  }
  if (params.has("thresh")) {
    const rawThresh = Number.parseInt(params.get("thresh") ?? "", 10);
    if (Number.isFinite(rawThresh) && rawThresh >= 2) {
      nextConfig.currentThreshold = rawThresh;
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
  const deletedEdgeIds = parseDeletedEdgeIds(params.get("d"));
  const highlightAnchorBranch = parseBool(params.get("ah")) ?? false;
  const hasAudioModeParam = params.has("am");
  const audioMode = parseAudioMode(params.get("am"));
  return {
    config: nextConfig,
    deletedEdgeIds,
    highlightAnchorBranch,
    audioMode,
    hasAudioModeParam,
    hasGraphTuning,
  };
}

export type CastTuningApplyResult = {
  parsed: CastParsedTuning | null;
  highlightOnly: boolean;
  highlightAnchorBranch: boolean;
};

export type CastTuningEngine = Pick<
  JukeboxEngine,
  "updateConfig" | "clearDeletedEdges" | "rebuildGraph" | "getGraphState" | "deleteEdge"
>;

export function applyCastTuningToEngine(
  engine: CastTuningEngine,
  defaults: JukeboxConfig,
  tuningParams: string | null,
): CastTuningApplyResult {
  const parsed = parseCastTuningParams(tuningParams, defaults);
  const highlightAnchorBranch = parsed?.highlightAnchorBranch ?? false;
  engine.updateConfig(defaults);
  engine.clearDeletedEdges();
  if (parsed) {
    engine.updateConfig(parsed.config);
  }
  engine.rebuildGraph();
  if (parsed?.deletedEdgeIds?.length) {
    const graph = engine.getGraphState();
    if (graph) {
      const edgeById = new Map(graph.allEdges.map((edge) => [edge.id, edge]));
      for (const id of parsed.deletedEdgeIds) {
        const edge = edgeById.get(id);
        if (edge) {
          engine.deleteEdge(edge);
        }
      }
      engine.rebuildGraph();
    }
  }
  return { parsed, highlightOnly: false, highlightAnchorBranch };
}

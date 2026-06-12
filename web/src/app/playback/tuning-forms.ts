import type { AppContext } from "../context";
import type { JukeboxAudioMode } from "../../audio/BufferedAudioPlayer";
import { storeAnchorHighlight } from "../anchorHighlight";
import { storeBranchStatsEnabled } from "../extrasMode";
import { useAppStore } from "../store";
import {
  getAnchorBranchIdFromUrl,
  getDeletedEdgeIdsFromUrl,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "../tuning";
import { showToast } from "../ui";
import {
  closeTuning,
  syncVolumeUI,
  updatePlayButton,
  updateTrackInfo,
} from "./status-ui";
import { canPrepareSwingMode, prepareSwingMode } from "./swing";

const DEFAULT_VOLUME = 0.5;

const MAX_RANDOM_BRANCH_DELTA = 0.2;

const RANDOM_BRANCH_DELTA_PERCENT_SCALE = 100 / MAX_RANDOM_BRANCH_DELTA;

function getDeletedEdgeIdsFromGraph(
  graph: ReturnType<AppContext["engine"]["getGraphState"]>,
) {
  if (!graph) {
    return [];
  }
  return graph.allEdges.filter((edge) => edge.deleted).map((edge) => edge.id);
}

function applyDeletedEdgesById(context: AppContext, ids: number[]): boolean {
  if (ids.length === 0) {
    return false;
  }
  const graph = context.engine.getGraphState();
  if (!graph) {
    return false;
  }
  const edgeById = new Map(graph.allEdges.map((edge) => [edge.id, edge]));
  let changed = false;
  for (const id of ids) {
    const edge = edgeById.get(id);
    if (edge && !edge.deleted) {
      context.engine.deleteEdge(edge);
      changed = true;
    }
  }
  if (changed) {
    context.engine.rebuildGraph();
  }
  return changed;
}

export function applyDeletedEdgesFromUrl(context: AppContext) {
  const urlIds = getDeletedEdgeIdsFromUrl();
  const fallbackIds = context.state.deletedEdgeIds;
  const ids = urlIds.length > 0 ? urlIds : fallbackIds;
  if (applyDeletedEdgesById(context, ids)) {
    context.state.vizData = context.engine.getVisualizationData();
    if (context.state.vizData) {
      context.jukebox.setData(context.state.vizData);
    }
  }
}

export function applyAnchorBranchFromUrl(context: AppContext) {
  const anchorBranchId = getAnchorBranchIdFromUrl();
  if (anchorBranchId === null) {
    return;
  }
  const graph = context.engine.getGraphState();
  const edge = graph?.allEdges.find((candidate) => candidate.id === anchorBranchId);
  if (!edge || edge.deleted || edge.dest.which >= edge.src.which) {
    return;
  }
  context.engine.setUserAnchorEdge(edge);
}

export function syncDeletedEdgeState(context: AppContext) {
  const { engine, state } = context;
  state.deletedEdgeIds = getDeletedEdgeIdsFromGraph(engine.getGraphState());
  syncTuningParamsState(context);
}

export type ExtrasApplyResult = {
  branchStatsChanged: boolean;
  audioModeChanged: boolean;
};

export type ExtrasFormValues = {
  bringItHomeMode: boolean;
  branchStatsEnabled: boolean;
  audioMode: JukeboxAudioMode;
};

export function getExtrasFormValues(context: AppContext): ExtrasFormValues {
  const { state } = context;
  const inJukeboxMode = state.playMode === "jukebox";
  return {
    bringItHomeMode: inJukeboxMode && state.bringItHomeMode,
    branchStatsEnabled: inJukeboxMode && state.branchStatsEnabled,
    audioMode: state.jukeboxAudioMode,
  };
}

export function applyExtrasChanges(
  context: AppContext,
  values: ExtrasFormValues,
): ExtrasApplyResult {
  const { cowbellOverlay, engine, player, state } = context;
  const previousBranchStatsEnabled = state.branchStatsEnabled;
  const previousAudioMode = state.jukeboxAudioMode;
  state.bringItHomeMode =
    state.playMode === "jukebox" && values.bringItHomeMode;
  if (state.bringItHomeMode && state.shiftBranching) {
    state.shiftBranching = false;
    engine.setForceBranch(false);
  }
  engine.setBringItHomeMode(state.bringItHomeMode);
  state.branchStatsEnabled =
    state.playMode === "jukebox" && values.branchStatsEnabled;
  if (!state.branchStatsEnabled) {
    useAppStore.setState({ branchStats: null });
  }
  storeBranchStatsEnabled(state.branchStatsEnabled);
  const nextAudioMode = values.audioMode;
  state.jukeboxAudioMode = nextAudioMode;
  if (nextAudioMode === "cowbell") {
    cowbellOverlay.enable();
  } else {
    cowbellOverlay.disable();
  }
  if (nextAudioMode === "swing") {
    if (canPrepareSwingMode(context)) {
      prepareSwingMode(context);
    } else {
      showToast(context, "Swing mode will prepare once audio is loaded", {
        icon: "hourglass_top",
      });
    }
  } else {
    state.swingRenderToken += 1;
    state.swingPreparing = false;
    player.setJukeboxAudioMode(nextAudioMode);
    if (
      previousAudioMode !== nextAudioMode &&
      state.playMode === "jukebox" &&
      (state.isRunning || state.isPaused)
    ) {
      engine.syncToPlaybackPosition();
    }
    updatePlayButton();
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(state.tuningParams, true);
  return {
    branchStatsChanged:
      previousBranchStatsEnabled !== state.branchStatsEnabled,
    audioModeChanged: previousAudioMode !== state.jukeboxAudioMode,
  };
}

export function resetExtrasDefaults(context: AppContext): ExtrasApplyResult {
  const { cowbellOverlay, engine, player, state } = context;
  const previousBranchStatsEnabled = state.branchStatsEnabled;
  const previousAudioMode = state.jukeboxAudioMode;
  state.bringItHomeMode = false;
  engine.setBringItHomeMode(false);
  state.branchStatsEnabled = false;
  useAppStore.setState({ branchStats: null });
  storeBranchStatsEnabled(false);
  cowbellOverlay.disable();
  state.swingRenderToken += 1;
  state.swingPreparing = false;
  state.jukeboxAudioMode = "off";
  player.setJukeboxAudioMode("off");
  updatePlayButton();
  if (
    previousAudioMode !== "off" &&
    state.playMode === "jukebox" &&
    (state.isRunning || state.isPaused)
  ) {
    engine.syncToPlaybackPosition();
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(state.tuningParams, true);
  return {
    branchStatsChanged:
      previousBranchStatsEnabled !== state.branchStatsEnabled,
    audioModeChanged: previousAudioMode !== state.jukeboxAudioMode,
  };
}

export type TuningFormValues = {
  threshold: number;
  computedThreshold: number | null;
  minProbPct: number;
  maxProbPct: number;
  rampPct: number;
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
  highlightAnchorBranch: boolean;
};

// Snapshot the engine config for the React tuning form (the read half of
// the old syncTuningUI).

// Snapshot the engine config for the React tuning form (the read half of
// the old syncTuningUI).
export function getTuningFormValues(context: AppContext): TuningFormValues {
  const { engine, state } = context;
  const config = engine.getConfig();
  const graph = engine.getGraphState();
  const thresholdValue =
    config.currentThreshold === 0 && graph
      ? Math.round(graph.currentThreshold)
      : config.currentThreshold;
  const computedValue =
    state.autoComputedThreshold ??
    (graph ? Math.round(graph.currentThreshold) : null);
  return {
    threshold: thresholdValue,
    computedThreshold: computedValue,
    minProbPct: Math.round(config.minRandomBranchChance * 100),
    maxProbPct: Math.round(config.maxRandomBranchChance * 100),
    rampPct:
      Math.round(
        config.randomBranchChanceDelta * RANDOM_BRANCH_DELTA_PERCENT_SCALE * 10,
      ) / 10,
    justBackwards: config.justBackwards,
    justLongBranches: config.justLongBranches,
    removeSequentialBranches: config.removeSequentialBranches,
    highlightAnchorBranch: state.highlightAnchorBranch,
  };
}

export function applyTuningChanges(
  context: AppContext,
  form: TuningFormValues,
): TuningFormValues {
  const { engine, jukebox, state } = context;
  const threshold = form.threshold;
  const computed = form.computedThreshold;
  const useAutoThreshold =
    engine.getConfig().currentThreshold === 0 &&
    computed !== null &&
    Number.isFinite(computed) &&
    threshold === computed;
  let minProb = form.minProbPct / 100;
  let maxProb = form.maxProbPct / 100;
  const ramp = form.rampPct / RANDOM_BRANCH_DELTA_PERCENT_SCALE;
  if (minProb > maxProb) {
    [minProb, maxProb] = [maxProb, minProb];
  }
  engine.updateConfig({
    currentThreshold: useAutoThreshold ? 0 : threshold,
    minRandomBranchChance: minProb,
    maxRandomBranchChance: maxProb,
    randomBranchChanceDelta: ramp,
    justBackwards: form.justBackwards,
    justLongBranches: form.justLongBranches,
    removeSequentialBranches: form.removeSequentialBranches,
  });
  state.highlightAnchorBranch = form.highlightAnchorBranch;
  storeAnchorHighlight(state.highlightAnchorBranch);
  jukebox.setAnchorHighlightEnabled(state.highlightAnchorBranch);
  engine.rebuildGraph();
  state.vizData = engine.getVisualizationData();
  const data = state.vizData;
  if (data) {
    jukebox.setData(data);
  }
  const graph = engine.getGraphState();
  updateTrackInfo(context);
  let nextThreshold = threshold;
  let nextComputed = computed;
  if (graph) {
    const resolved = Math.max(0, Math.round(graph.currentThreshold));
    if (useAutoThreshold) {
      state.autoComputedThreshold = resolved;
      nextThreshold = resolved;
    }
    nextComputed = resolved;
  } else {
    nextComputed = state.autoComputedThreshold;
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(state.tuningParams, true);
  closeTuning();
  return {
    ...form,
    threshold: nextThreshold,
    computedThreshold: nextComputed,
    minProbPct: Math.round(minProb * 100),
    maxProbPct: Math.round(maxProb * 100),
  };
}

export function resetTuningDefaults(context: AppContext) {
  const { autocanonizer, cowbellOverlay, engine, jukebox, state, player } =
    context;
  engine.clearDeletedEdges();
  engine.updateConfig(context.defaultConfig);
  engine.rebuildGraph();
  state.vizData = engine.getVisualizationData();
  const data = state.vizData;
  if (data) {
    jukebox.setData(data);
  }
  syncDeletedEdgeState(context);
  const graph = engine.getGraphState();
  state.autoComputedThreshold = graph
    ? Math.round(graph.currentThreshold)
    : null;
  state.tuningParams =
    state.jukeboxAudioMode === "off"
      ? null
      : new URLSearchParams({ am: state.jukeboxAudioMode }).toString();
  writeTuningParamsToUrl(state.tuningParams, true);
  player.setVolume(DEFAULT_VOLUME);
  autocanonizer.setVolume(DEFAULT_VOLUME);
  cowbellOverlay.setVolume(DEFAULT_VOLUME);
  syncVolumeUI(context);
  updateTrackInfo(context);
}

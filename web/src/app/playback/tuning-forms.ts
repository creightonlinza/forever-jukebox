import type { AppContext } from "../context";
import type { JukeboxAudioMode } from "@forever-jukebox/engine/audio/BufferedAudioPlayer";
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
import { DEFAULT_MIN_LONG_BRANCH_PERCENT } from "@forever-jukebox/engine";
import {
  closeTuning,
  syncVolumeUI,
  updatePlayButton,
  updateTrackInfo,
} from "./status-ui";
import { canPrepareSwingMode, prepareSwingMode } from "./swing";
import i18n from "../i18n";

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
  const fallbackIds = useAppStore.getState().deletedEdgeIds;
  const ids = urlIds.length > 0 ? urlIds : fallbackIds;
  if (applyDeletedEdgesById(context, ids)) {
    const vizData = context.engine.getVisualizationData();
    useAppStore.setState({ vizData });
    if (vizData) {
      context.jukebox?.setData(vizData);
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
  const { engine } = context;
  useAppStore.setState({ deletedEdgeIds: getDeletedEdgeIdsFromGraph(engine.getGraphState()) });
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

export function getExtrasFormValues(): ExtrasFormValues {
  const { playMode, bringItHomeMode, branchStatsEnabled, jukeboxAudioMode } =
    useAppStore.getState();
  const inJukeboxMode = playMode === "jukebox";
  return {
    bringItHomeMode: inJukeboxMode && bringItHomeMode,
    branchStatsEnabled: inJukeboxMode && branchStatsEnabled,
    audioMode: jukeboxAudioMode,
  };
}

export function applyExtrasChanges(
  context: AppContext,
  values: ExtrasFormValues,
): ExtrasApplyResult {
  const { cowbellOverlay, engine, player } = context;
  const previousBranchStatsEnabled = useAppStore.getState().branchStatsEnabled;
  const previousAudioMode = useAppStore.getState().jukeboxAudioMode;
  useAppStore.setState({
    bringItHomeMode:
      useAppStore.getState().playMode === "jukebox" && values.bringItHomeMode,
  });
  if (useAppStore.getState().bringItHomeMode && useAppStore.getState().shiftBranching) {
    useAppStore.setState({ shiftBranching: false });
    engine.setForceBranch(false);
  }
  engine.setBringItHomeMode(useAppStore.getState().bringItHomeMode);
  useAppStore.setState({
    branchStatsEnabled:
      useAppStore.getState().playMode === "jukebox" && values.branchStatsEnabled,
  });
  if (!useAppStore.getState().branchStatsEnabled) {
    useAppStore.setState({ branchStats: null });
  }
  storeBranchStatsEnabled(useAppStore.getState().branchStatsEnabled);
  const nextAudioMode = values.audioMode;
  useAppStore.setState({ jukeboxAudioMode: nextAudioMode });
  if (nextAudioMode === "cowbell") {
    cowbellOverlay.enable();
  } else {
    cowbellOverlay.disable();
  }
  if (nextAudioMode === "swing") {
    if (canPrepareSwingMode(context)) {
      prepareSwingMode(context);
    } else {
      showToast(i18n.t("playback.swingWhenLoaded"), {
        icon: "hourglass_top",
      });
    }
  } else {
    useAppStore.setState({
      swingRenderToken: useAppStore.getState().swingRenderToken + (1),
    });
    useAppStore.setState({ swingPreparing: false });
    player.setJukeboxAudioMode(nextAudioMode);
    if (
      previousAudioMode !== nextAudioMode &&
      useAppStore.getState().playMode === "jukebox" &&
      (useAppStore.getState().isRunning || useAppStore.getState().isPaused)
    ) {
      engine.syncToPlaybackPosition();
    }
    updatePlayButton();
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
  return {
    branchStatsChanged:
      previousBranchStatsEnabled !== useAppStore.getState().branchStatsEnabled,
    audioModeChanged: previousAudioMode !== useAppStore.getState().jukeboxAudioMode,
  };
}

export function resetExtrasDefaults(context: AppContext): ExtrasApplyResult {
  const { cowbellOverlay, engine, player } = context;
  const previousBranchStatsEnabled = useAppStore.getState().branchStatsEnabled;
  const previousAudioMode = useAppStore.getState().jukeboxAudioMode;
  useAppStore.setState({ bringItHomeMode: false });
  engine.setBringItHomeMode(false);
  useAppStore.setState({ branchStatsEnabled: false });
  useAppStore.setState({ branchStats: null });
  storeBranchStatsEnabled(false);
  cowbellOverlay.disable();
  useAppStore.setState({
    swingRenderToken: useAppStore.getState().swingRenderToken + (1),
  });
  useAppStore.setState({ swingPreparing: false });
  useAppStore.setState({ jukeboxAudioMode: "off" });
  player.setJukeboxAudioMode("off");
  updatePlayButton();
  if (
    previousAudioMode !== "off" &&
    useAppStore.getState().playMode === "jukebox" &&
    (useAppStore.getState().isRunning || useAppStore.getState().isPaused)
  ) {
    engine.syncToPlaybackPosition();
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
  return {
    branchStatsChanged:
      previousBranchStatsEnabled !== useAppStore.getState().branchStatsEnabled,
    audioModeChanged: previousAudioMode !== useAppStore.getState().jukeboxAudioMode,
  };
}

export type TuningFormValues = {
  threshold: number;
  computedThreshold: number | null;
  minProbPct: number;
  maxProbPct: number;
  rampPct: number;
  justBackwards: boolean;
  minLongBranchPercent: number;
  removeSequentialBranches: boolean;
  highlightAnchorBranch: boolean;
};

// Snapshot the engine config for the React tuning form (the read half of
// the old syncTuningUI).

// Snapshot the engine config for the React tuning form (the read half of
// the old syncTuningUI).
export function getTuningFormValues(context: AppContext): TuningFormValues {
  const { engine } = context;
  const config = engine.getConfig();
  const graph = engine.getGraphState();
  const thresholdValue =
    config.currentThreshold === 0 && graph
      ? Math.round(graph.currentThreshold)
      : config.currentThreshold;
  const computedValue =
    useAppStore.getState().autoComputedThreshold ??
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
    minLongBranchPercent: config.justLongBranches
      ? (config.minLongBranchPercent ?? DEFAULT_MIN_LONG_BRANCH_PERCENT)
      : 0,
    removeSequentialBranches: config.removeSequentialBranches,
    highlightAnchorBranch: useAppStore.getState().highlightAnchorBranch,
  };
}

export function applyTuningChanges(
  context: AppContext,
  form: TuningFormValues,
): TuningFormValues {
  const { engine, jukebox } = context;
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
    justLongBranches: form.minLongBranchPercent > 0,
    minLongBranchPercent:
      form.minLongBranchPercent > 0
        ? form.minLongBranchPercent
        : DEFAULT_MIN_LONG_BRANCH_PERCENT,
    removeSequentialBranches: form.removeSequentialBranches,
  });
  useAppStore.setState({ highlightAnchorBranch: form.highlightAnchorBranch });
  storeAnchorHighlight(useAppStore.getState().highlightAnchorBranch);
  jukebox?.setAnchorHighlightEnabled(useAppStore.getState().highlightAnchorBranch);
  engine.rebuildGraph();
  useAppStore.setState({ vizData: engine.getVisualizationData() });
  const data = useAppStore.getState().vizData;
  if (data) {
    jukebox?.setData(data);
  }
  const graph = engine.getGraphState();
  updateTrackInfo(context);
  let nextThreshold = threshold;
  let nextComputed: number | null;
  if (graph) {
    const resolved = Math.max(0, Math.round(graph.currentThreshold));
    if (useAutoThreshold) {
      useAppStore.setState({ autoComputedThreshold: resolved });
      nextThreshold = resolved;
    }
    nextComputed = resolved;
  } else {
    nextComputed = useAppStore.getState().autoComputedThreshold;
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
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
  const { autocanonizer, cowbellOverlay, engine, jukebox, player } = context;
  engine.clearDeletedEdges();
  engine.updateConfig(context.defaultConfig);
  engine.rebuildGraph();
  useAppStore.setState({ vizData: engine.getVisualizationData() });
  const data = useAppStore.getState().vizData;
  if (data) {
    jukebox?.setData(data);
  }
  syncDeletedEdgeState(context);
  const graph = engine.getGraphState();
  useAppStore.setState({
    autoComputedThreshold: graph
    ? Math.round(graph.currentThreshold)
    : null
  });
  useAppStore.setState({
    tuningParams:
      useAppStore.getState().jukeboxAudioMode === "off"
        ? null
        : new URLSearchParams({ am: useAppStore.getState().jukeboxAudioMode }).toString(),
  });
  writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
  player.setVolume(DEFAULT_VOLUME);
  autocanonizer?.setVolume(DEFAULT_VOLUME);
  cowbellOverlay.setVolume(DEFAULT_VOLUME);
  syncVolumeUI(context);
  updateTrackInfo(context);
}

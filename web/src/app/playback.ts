import type { AppContext, TabId } from "./context";
import type { JukeboxAudioMode } from "../audio/BufferedAudioPlayer";
import { getOrCreateSwingBuffer } from "../audio/swingBufferCache";
import { renderSwingBuffer } from "../audio/swingRenderer";
import {
  ANALYSIS_POLL_INTERVAL_MS,
  LISTEN_TIMER_INTERVAL_MS,
} from "./constants";
import { formatDuration, formatPlaybackTitle } from "./format";
import {
  fetchAnalysis,
  fetchAudio,
  fetchJobBySource,
  recordPlay,
  type AnalysisComplete,
  type AnalysisResponse,
} from "./api";
import { deleteCachedTrack, readCachedTrack, updateCachedTrack } from "./cache";
import { isLikelyJobId } from "./identity";
import {
  applyTuningParamsFromUrl,
  clearTuningParamsFromUrl,
  getAnchorBranchIdFromUrl,
  getDeletedEdgeIdsFromUrl,
  getTuningParamsStringFromUrl,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "./tuning";
import { storeAnchorHighlight } from "./anchorHighlight";
import { storeBranchStatsEnabled } from "./extrasMode";
import { setAutoMarqueeText } from "./marquee";
import { useAppStore } from "./store";
import { showToast } from "./ui";
import {
  activatePlaylistTrack,
  emptyPlaylist,
  hasInactiveSavedPlaylist,
  isPlaylistActive,
  PLAYLIST_MAX_TRACKS,
  playlistTrackKey,
  replaceActivePlaylistTrack,
  savePlaylist,
  type PlaylistSourceType,
  type PlaylistTrack,
} from "./playlist";
import {
  isAnalysisComplete,
  isAnalysisFailed,
  isAnalysisInProgress,
} from "./analysisStatus";
import { formatErrorForDisplay } from "./errorDisplay";
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "../shared/backgroundTimer";

const DEFAULT_VOLUME = 0.5;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const RANDOM_BRANCH_DELTA_PERCENT_SCALE = 100 / MAX_RANDOM_BRANCH_DELTA;
const GENERIC_LOAD_ERROR_MESSAGE =
  "Something went wrong. Please try again or report an issue on GitHub.";

export type SleepTimerOption = {
  label: string;
  durationMs: number | null;
};

export const SLEEP_TIMER_OPTIONS: SleepTimerOption[] = [
  { label: "Off", durationMs: null },
  { label: "15 minutes", durationMs: 15 * 60 * 1000 },
  { label: "30 minutes", durationMs: 30 * 60 * 1000 },
  { label: "45 minutes", durationMs: 45 * 60 * 1000 },
  { label: "1 hour", durationMs: 60 * 60 * 1000 },
  { label: "2 hours", durationMs: 2 * 60 * 60 * 1000 },
];

const sleepTimerListeners = new WeakMap<AppContext, Set<() => void>>();

export function isSleepTimerActive(state: AppContext["state"]["sleepTimer"]) {
  return state.endTimeMs !== null && state.remainingMs > 0;
}

export function addSleepTimerListener(
  context: AppContext,
  listener: () => void,
) {
  let listeners = sleepTimerListeners.get(context);
  if (!listeners) {
    listeners = new Set();
    sleepTimerListeners.set(context, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
  };
}

function publishSleepTimerState(context: AppContext) {
  sleepTimerListeners.get(context)?.forEach((listener) => listener());
}

function clearSleepTimerTimeout(context: AppContext) {
  const { state } = context;
  if (state.sleepTimerTimeoutId === null) {
    return;
  }
  backgroundClearTimeout(state.sleepTimerTimeoutId);
  state.sleepTimerTimeoutId = null;
}

function publishInactiveSleepTimer(context: AppContext) {
  context.state.sleepTimer = {
    configuredDurationMs: null,
    endTimeMs: null,
    remainingMs: 0,
  };
  publishSleepTimerState(context);
}

function expireSleepTimer(context: AppContext, expectedEndTimeMs: number) {
  if (context.state.sleepTimer.endTimeMs !== expectedEndTimeMs) {
    return;
  }
  clearSleepTimerTimeout(context);
  publishInactiveSleepTimer(context);
  stopPlayback(context);
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {
      console.warn("Failed to exit fullscreen");
    });
  }
}

function scheduleSleepTimerTick(context: AppContext, expectedEndTimeMs: number) {
  clearSleepTimerTimeout(context);
  const remainingMs = Math.max(0, expectedEndTimeMs - performance.now());
  const nextDelayMs = remainingMs > 1000 ? 1000 : remainingMs;
  context.state.sleepTimerTimeoutId = backgroundSetTimeout(() => {
    if (context.state.sleepTimer.endTimeMs !== expectedEndTimeMs) {
      return;
    }
    const nextRemainingMs = Math.max(0, expectedEndTimeMs - performance.now());
    context.state.sleepTimer = {
      configuredDurationMs: context.state.sleepTimer.configuredDurationMs,
      endTimeMs: expectedEndTimeMs,
      remainingMs: nextRemainingMs,
    };
    publishSleepTimerState(context);
    if (nextRemainingMs <= 0) {
      expireSleepTimer(context, expectedEndTimeMs);
      return;
    }
    scheduleSleepTimerTick(context, expectedEndTimeMs);
  }, nextDelayMs);
}

export function setSleepTimer(
  context: AppContext,
  durationMs: number | null,
) {
  clearSleepTimerTimeout(context);
  if (
    durationMs === null ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    publishInactiveSleepTimer(context);
    return;
  }
  const endTimeMs = performance.now() + durationMs;
  context.state.sleepTimer = {
    configuredDurationMs: durationMs,
    endTimeMs,
    remainingMs: durationMs,
  };
  publishSleepTimerState(context);
  scheduleSleepTimerTick(context, endTimeMs);
}

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

function applyDeletedEdgesFromUrl(context: AppContext) {
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

function applyAnchorBranchFromUrl(context: AppContext) {
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

export type PlaybackDeps = {
  setActiveTab: (tabId: TabId) => void;
  navigateToTab: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  updateTrackUrl: (trackId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  setLoadingProgress: (
    progress: number | null,
    message?: string | null,
  ) => void;
  onTrackChange?: (trackId: string | null) => void;
  onAnalysisLoaded?: (response: AnalysisComplete) => void;
  onPlaylistChange?: () => void;
};

export type TrackLoadOptions = {
  preserveUrlTuning?: boolean;
  playlistLoad?: boolean;
  preservePlaylist?: boolean;
  selectedTrack?: PlaylistTrack | null;
};

export function updateListenTimeDisplay(context: AppContext) {
  const { elements, state } = context;
  const now = performance.now();
  const totalMs =
    state.playTimerMs +
    (state.lastPlayStamp !== null ? now - state.lastPlayStamp : 0);
  elements.listenTimeEl.textContent = formatDuration(totalMs / 1000);
}

function maybeUpdateDeleteEligibility(
  context: AppContext,
  response: AnalysisResponse | null,
  jobIdOverride?: string | null,
) {
  if (!response) {
    return;
  }
  const { state } = context;
  const jobId = jobIdOverride ?? ("id" in response ? response.id : undefined);
  if (!jobId || state.deleteEligibilityJobId === jobId) {
    return;
  }
  let eligible = false;
  const createdAt = "created_at" in response ? response.created_at : undefined;
  if (typeof createdAt === "string") {
    const createdMs = Date.parse(createdAt);
    if (!Number.isNaN(createdMs)) {
      const ageMs = Date.now() - createdMs;
      eligible = ageMs <= 30 * 60 * 1000;
    }
  } else {
    state.deleteEligible = false;
    state.deleteEligibilityJobId = null;
    return;
  }
  state.deleteEligibilityJobId = jobId;
  state.deleteEligible = eligible;
}

export function updateTrackInfo(context: AppContext) {
  const { engine, player, state } = context;
  const graph = engine.getGraphState();
  const resolvedDuration =
    typeof state.trackDurationSec === "number" &&
    Number.isFinite(state.trackDurationSec)
      ? state.trackDurationSec
      : player.getDuration();
  const durationText =
    typeof resolvedDuration === "number" && Number.isFinite(resolvedDuration)
      ? formatDuration(resolvedDuration)
      : "00:00:00";
  const branchCount = state.vizData
    ? state.vizData.edges.length
    : graph
      ? graph.allEdges.filter((edge) => !edge.deleted).length
      : 0;
  const deletedCount = graph
    ? graph.allEdges.filter((edge) => edge.deleted).length
    : state.deletedEdgeIds.length;
  // The React info modal renders this store state.
  useAppStore.setState({
    trackInfo: {
      durationText,
      totalBeats: graph ? graph.totalBeats : 0,
      branchCount,
      deletedCount,
    },
  });
}

export function updateVizVisibility(context: AppContext) {
  const { autocanonizer, elements, jukebox, state } = context;
  if (state.swingPreparing) {
    elements.playStatusPanel.classList.remove("hidden");
    elements.vizPanel.classList.add("hidden");
    elements.playButton.classList.add("hidden");
    elements.vizSelect.disabled = true;
    updatePlayButton(context);
    return;
  }
  if (state.audioLoaded && state.analysisLoaded) {
    elements.playStatusPanel.classList.add("hidden");
    elements.vizPanel.classList.remove("hidden");
    elements.playButton.classList.remove("hidden");
    updatePlayButton(context);
    if (state.playMode === "autocanonizer") {
      autocanonizer.resizeNow();
    } else {
      jukebox.resizeActive();
    }
    elements.vizSelect.disabled = state.playMode === "autocanonizer";
  } else {
    elements.playStatusPanel.classList.remove("hidden");
    elements.vizPanel.classList.add("hidden");
    elements.playButton.classList.add("hidden");
    elements.vizSelect.disabled = true;
  }
}

// The React volume panel renders this store value.
export function syncVolumeUI(context: AppContext) {
  const { player } = context;
  useAppStore.setState({ volumePct: Math.round(player.getVolume() * 100) });
}

function openTuningTab(context: AppContext, tab: "tuning" | "extras") {
  syncVolumeUI(context);
  const hasExtrasTab = context.state.playMode === "jukebox";
  useAppStore.setState({
    tuningModalOpen: true,
    tuningModalTab: tab === "extras" && hasExtrasTab ? "extras" : "tuning",
  });
}

export function openTuning(context: AppContext) {
  openTuningTab(context, "tuning");
}

export function openExtras(context: AppContext) {
  openTuningTab(context, "extras");
}

export function closeTuning(context: AppContext) {
  void context;
  useAppStore.setState({ tuningModalOpen: false });
}

export function openInfo(context: AppContext) {
  updateTrackInfo(context);
  useAppStore.setState({ infoModalOpen: true });
}

export function closeInfo(context: AppContext) {
  void context;
  useAppStore.setState({ infoModalOpen: false });
}


function getCurrentSwingSourceIdentity(context: AppContext): string | null {
  const { state } = context;
  return state.lastTrackId ?? state.lastJobId ?? null;
}

function canPrepareSwingMode(context: AppContext) {
  return (
    context.state.playMode === "jukebox" &&
    context.state.audioLoaded &&
    context.state.analysisLoaded &&
    context.player.getSourceBuffer() !== null &&
    context.state.vizData !== null &&
    context.state.vizData.beats.length > 0
  );
}

function isPlaybackBlockedForSwing(context: AppContext) {
  const { state } = context;
  return (
    state.playMode === "jukebox" &&
    state.jukeboxAudioMode === "swing" &&
    state.swingPreparing
  );
}

function prepareSwingMode(context: AppContext) {
  if (context.state.jukeboxAudioMode !== "swing") {
    return;
  }
  const sourceBuffer = context.player.getSourceBuffer();
  const beats = context.state.vizData?.beats;
  if (!sourceBuffer || !beats || beats.length === 0) {
    return;
  }
  const resumeAfterPrepare = context.state.isRunning;
  if (context.state.isRunning) {
    pausePlayback(context);
  }
  const renderToken = context.state.swingRenderToken + 1;
  context.state.swingRenderToken = renderToken;
  context.state.swingPreparing = true;
  context.elements.analysisStatus.textContent = "Adding swing to the track...";
  context.elements.analysisSpinner.classList.remove("hidden");
  context.elements.analysisProgress.textContent = "0%";
  updateVizVisibility(context);
  updatePlayButton(context);

  const sourceIdentity = getCurrentSwingSourceIdentity(context);
  void getOrCreateSwingBuffer(sourceBuffer, sourceIdentity, () =>
    renderSwingBuffer(sourceBuffer, beats, {
      onProgress: (progress) => {
        if (
          context.state.swingRenderToken !== renderToken ||
          context.state.jukeboxAudioMode !== "swing"
        ) {
          return;
        }
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        context.elements.analysisProgress.textContent = `${percent}%`;
      },
    }),
  )
    .then((buffer) => {
      if (
        context.state.swingRenderToken !== renderToken ||
        context.state.jukeboxAudioMode !== "swing"
      ) {
        return;
      }
      context.state.swingPreparing = false;
      context.player.setRenderedJukeboxAudioBuffer("swing", buffer);
      context.player.setJukeboxAudioMode("swing");
      context.elements.analysisStatus.textContent = "Swing mode ready.";
      context.elements.analysisSpinner.classList.add("hidden");
      context.elements.analysisProgress.textContent = "";
      updateVizVisibility(context);
      if (context.state.isRunning || context.state.isPaused) {
        context.engine.syncToPlaybackPosition();
      }
      updatePlayButton(context);
      if (
        resumeAfterPrepare &&
        context.state.playMode === "jukebox" &&
        context.state.jukeboxAudioMode === "swing" &&
        !context.state.isRunning
      ) {
        startJukeboxPlayback(context, false);
      }
    })
    .catch((err: unknown) => {
      if (context.state.swingRenderToken !== renderToken) {
        return;
      }
      console.warn(`Swing render failed: ${String(err)}`);
      context.state.swingPreparing = false;
      context.state.jukeboxAudioMode = "off";
      context.player.setJukeboxAudioMode("off");
      context.elements.analysisStatus.textContent = "Swing mode failed.";
      context.elements.analysisSpinner.classList.add("hidden");
      context.elements.analysisProgress.textContent = "";
      updateVizVisibility(context);
      syncTuningParamsState(context);
      writeTuningParamsToUrl(context.state.tuningParams, true);
      updatePlayButton(context);
      showToast(context, "Swing mode failed. Using Normal mode.", {
        icon: "error",
        tone: "error",
      });
    });
}

function maybePrepareSwingMode(context: AppContext) {
  if (context.state.jukeboxAudioMode !== "swing") {
    return;
  }
  if (!canPrepareSwingMode(context)) {
    return;
  }
  prepareSwingMode(context);
}

// Imperative marquee update for the (still legacy) viz-bottom title; the
// React play-menu title derives reactively from the store.
export function syncVizNowPlayingTitle(context: AppContext) {
  const { elements, state } = context;
  if (!state.trackTitle && !state.trackArtist) {
    return;
  }
  const baseTitle = state.trackTitle ?? "Unknown";
  const title = formatPlaybackTitle(
    baseTitle,
    state.playMode,
    state.jukeboxAudioMode,
  );
  const displayTitle = state.trackArtist
    ? `${title} — ${state.trackArtist}`
    : title;
  setAutoMarqueeText(elements.vizNowPlayingEl, displayTitle);
}

function syncBringItHomeLabels(context: AppContext) {
  const { elements, state } = context;
  const visible = state.playMode === "jukebox" && state.bringItHomeMode;
  elements.bringHomeFullscreenLabel.classList.toggle("is-hidden", !visible);
}


export type TuningModalTab = "tuning" | "extras";

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
  syncBringItHomeLabels(context);
  state.branchStatsEnabled =
    state.playMode === "jukebox" && values.branchStatsEnabled;
  if (!state.branchStatsEnabled) {
    context.elements.branchStatsPopup.classList.add("hidden");
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
    updatePlayButton(context);
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
  const { cowbellOverlay, elements, engine, player, state } = context;
  const previousBranchStatsEnabled = state.branchStatsEnabled;
  const previousAudioMode = state.jukeboxAudioMode;
  state.bringItHomeMode = false;
  engine.setBringItHomeMode(false);
  syncBringItHomeLabels(context);
  state.branchStatsEnabled = false;
  elements.branchStatsPopup.classList.add("hidden");
  storeBranchStatsEnabled(false);
  cowbellOverlay.disable();
  state.swingRenderToken += 1;
  state.swingPreparing = false;
  state.jukeboxAudioMode = "off";
  player.setJukeboxAudioMode("off");
  updatePlayButton(context);
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
  closeTuning(context);
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

export function startListenTimer(context: AppContext) {
  const { state } = context;
  if (state.listenTimerId !== null) {
    return;
  }
  state.listenTimerId = window.setInterval(() => {
    updateListenTimeDisplay(context);
  }, LISTEN_TIMER_INTERVAL_MS);
}

export function stopListenTimer(context: AppContext) {
  const { state } = context;
  if (state.listenTimerId === null) {
    return;
  }
  window.clearInterval(state.listenTimerId);
  state.listenTimerId = null;
}

export function stopPlayback(context: AppContext) {
  const {
    autocanonizer,
    cowbellOverlay,
    elements,
    engine,
    jukebox,
    player,
    state,
  } = context;
  cowbellOverlay.cancelScheduledHits();
  if (state.playMode === "autocanonizer") {
    autocanonizer.stop();
    player.stop();
    autocanonizer.resetVisualization();
  }
  engine.stopJukebox();
  engine.resetStats();
  state.playTimerMs = 0;
  state.lastPlayStamp = null;
  state.lastBeatIndex = null;
  elements.beatsPlayedEl.textContent = "0";
  jukebox.reset();
  state.isRunning = false;
  state.isPaused = false;
  state.shiftBranching = false;
  engine.setForceBranch(false);
  if (state.bringItHomeMode) {
    state.bringItHomeMode = false;
    engine.setBringItHomeMode(false);
    elements.bringHomeFullscreenLabel.classList.add("is-hidden");
  }
  stopListenTimer(context);
  updateListenTimeDisplay(context);
  updatePlayButton(context);
}

function pausePlayback(context: AppContext) {
  const { autocanonizer, cowbellOverlay, engine, player, state } = context;
  if (!state.isRunning) {
    return;
  }
  cowbellOverlay.cancelScheduledHits();
  if (state.playMode === "autocanonizer") {
    autocanonizer.stop();
    player.stop();
  } else {
    engine.pauseJukebox();
    engine.syncToPlaybackPosition();
  }
  if (state.lastPlayStamp !== null) {
    state.playTimerMs += performance.now() - state.lastPlayStamp;
    state.lastPlayStamp = null;
  }
  state.isRunning = false;
  state.isPaused = true;
  state.shiftBranching = false;
  engine.setForceBranch(false);
  stopListenTimer(context);
  updateListenTimeDisplay(context);
  updatePlayButton(context);
}

function startJukeboxPlayback(context: AppContext, resetSession: boolean) {
  const { cowbellOverlay, engine, elements, jukebox, player, state } = context;
  if (isPlaybackBlockedForSwing(context)) {
    showToast(context, "Preparing Swing mode...", { icon: "hourglass_top" });
    updatePlayButton(context);
    return;
  }
  if (player.getDuration() === null) {
    console.warn("Audio not loaded");
    if (!resetSession) {
      stopPlayback(context);
    }
    return;
  }
  if (resetSession) {
    cowbellOverlay.cancelScheduledHits();
    engine.stopJukebox();
    engine.resetStats();
    state.playTimerMs = 0;
    state.lastPlayStamp = null;
    updateListenTimeDisplay(context);
    elements.beatsPlayedEl.textContent = "0";
    state.lastBeatIndex = null;
    jukebox.reset();
    if (elements.vizStats) {
      elements.vizStats.classList.remove("pulse");
      void elements.vizStats.offsetWidth;
      elements.vizStats.classList.add("pulse");
    }
  } else {
    engine.syncToPlaybackPosition();
  }
  engine.play();
  engine.startJukebox(resetSession);
  state.lastPlayStamp = performance.now();
  state.isRunning = true;
  state.isPaused = false;
  startListenTimer(context);
  updatePlayButton(context);
  if (document.fullscreenElement) {
    requestWakeLock(context);
  }
}

export function togglePlayback(context: AppContext) {
  const { state } = context;
  if (state.isRunning) {
    pausePlayback(context);
    return;
  }
  try {
    if (state.playMode === "autocanonizer") {
      const startIndex = state.isPaused ? (state.lastBeatIndex ?? 0) : 0;
      startAutocanonizerPlayback(context, startIndex, {
        resetSession: !state.isPaused,
      });
      return;
    }
    if (state.isPaused) {
      startJukeboxPlayback(context, false);
      return;
    }
    startJukeboxPlayback(context, true);
  } catch (err) {
    console.warn(`Play error: ${String(err)}`);
  }
}

export function startJukeboxFromBeat(context: AppContext, index: number) {
  const { cowbellOverlay, engine, player, state } = context;
  if (state.playMode !== "jukebox") {
    return;
  }
  if (isPlaybackBlockedForSwing(context)) {
    showToast(context, "Preparing Swing mode...", { icon: "hourglass_top" });
    updatePlayButton(context);
    return;
  }
  if (player.getDuration() === null) {
    console.warn("Audio not loaded");
    return;
  }
  const beat = state.vizData?.beats[index];
  if (!beat) {
    return;
  }

  cowbellOverlay.cancelScheduledHits();
  player.seek(beat.start);
  engine.seekToBeat(index);
  state.lastBeatIndex = index;
  if (!state.isRunning) {
    engine.play();
    engine.startJukebox(false);
    state.lastPlayStamp = performance.now();
    state.isRunning = true;
    state.isPaused = false;
    startListenTimer(context);
    updatePlayButton(context);
    if (document.fullscreenElement) {
      requestWakeLock(context);
    }
    return;
  }
  if (!player.isPlaying()) {
    engine.play();
  }
}

export function startAutocanonizerPlayback(
  context: AppContext,
  index: number,
  options?: { resetSession?: boolean },
) {
  const { autocanonizer, cowbellOverlay, engine, elements, player, state } =
    context;
  if (!autocanonizer.isReady()) {
    console.warn("Autocanonizer not ready");
    return false;
  }
  const resetSession = options?.resetSession ?? true;
  player.stop();
  cowbellOverlay.cancelScheduledHits();
  engine.stopJukebox();
  if (resetSession) {
    state.playTimerMs = 0;
    state.lastPlayStamp = null;
    updateListenTimeDisplay(context);
    elements.beatsPlayedEl.textContent = "0";
    state.lastBeatIndex = null;
    if (elements.vizStats) {
      elements.vizStats.classList.remove("pulse");
      void elements.vizStats.offsetWidth;
      elements.vizStats.classList.add("pulse");
    }
    autocanonizer.resetVisualization();
  }
  autocanonizer.startAtIndex(index);
  state.lastPlayStamp = performance.now();
  state.isRunning = true;
  state.isPaused = false;
  startListenTimer(context);
  updatePlayButton(context);
  if (document.fullscreenElement) {
    requestWakeLock(context);
  }
  return true;
}

function updatePlayButton(context: AppContext) {
  const { state } = context;
  const isRunning = state.isRunning;
  const isBlocked = isPlaybackBlockedForSwing(context);
  const label = isBlocked
    ? "Preparing Swing mode"
    : isRunning
      ? "Pause"
      : state.isPaused
        ? "Resume"
        : "Play";
  const updateButton = (button: HTMLButtonElement) => {
    const icon = button.querySelector<HTMLSpanElement>(".play-icon");
    if (icon) {
      icon.textContent = isBlocked
        ? "hourglass_top"
        : isRunning
          ? "pause"
          : "play_arrow";
    }
    button.disabled = isBlocked;
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  updateButton(context.elements.playButton);
  if (context.elements.vizPlayButton !== context.elements.playButton) {
    updateButton(context.elements.vizPlayButton);
  }
  const shouldPulse = isRunning && context.state.activeTabId !== "play";
  useAppStore.getState().setPlayTabPulsing(shouldPulse);
}

export function resetForNewTrack(
  context: AppContext,
  options?: { clearTuning?: boolean },
) {
  const {
    autocanonizer,
    cowbellOverlay,
    elements,
    engine,
    jukebox,
    player,
    state,
    defaultConfig,
  } = context;
  const shouldClearTuning = options?.clearTuning ?? false;
  const shouldPreserveTuning = options?.clearTuning === false;
  const preservedTuningParams = shouldPreserveTuning
    ? (state.tuningParams ?? getTuningParamsStringFromUrl())
    : null;
  const hadTrackLoaded =
    state.audioLoaded ||
    state.analysisLoaded ||
    state.lastJobId !== null ||
    state.lastTrackId !== null ||
    state.trackTitle !== null;
  if (hadTrackLoaded) {
    state.jukeboxAudioMode = "off";
    player.setJukeboxAudioMode("off");
  }
  cowbellOverlay.disable();
  cowbellOverlay.setSectionStartBeatIndices([]);
  state.swingRenderToken += 1;
  state.swingPreparing = false;
  cancelPoll(context);
  state.shiftBranching = false;
  engine.setForceBranch(false);
  state.bringItHomeMode = false;
  engine.setBringItHomeMode(false);
  elements.bringHomeFullscreenLabel.classList.add("is-hidden");
  state.selectedEdge = null;
  jukebox.setSelectedEdge(null);
  elements.branchStatsPopup.classList.add("hidden");
  engine.clearDeletedEdges();
  state.deletedEdgeIds = [];
  state.audioLoaded = false;
  state.analysisLoaded = false;
  state.audioLoadInFlight = false;
  state.lastJobId = null;
  state.lastTrackId = null;
  state.lastSourceId = null;
  state.lastSourceProvider = null;
  state.lastPlayCountedJobId = null;
  updateVizVisibility(context);
  state.playTimerMs = 0;
  state.lastPlayStamp = null;
  state.lastBeatIndex = null;
  updateListenTimeDisplay(context);
  elements.beatsPlayedEl.textContent = "0";
  setAutoMarqueeText(elements.vizNowPlayingEl, "The Forever Jukebox");
  closeTuning(context);
  closeInfo(context);
  if (state.isRunning || state.isPaused) {
    stopPlayback(context);
  }
  autocanonizer.reset();
  state.autoComputedThreshold = null;
  if (shouldClearTuning) {
    state.tuningParams = null;
    clearTuningParamsFromUrl(true);
  }
  engine.updateConfig({ ...defaultConfig });
  syncVolumeUI(context);
  elements.analysisStatus.textContent = "No track selected.";
  elements.analysisSpinner.classList.add("hidden");
  elements.analysisProgress.textContent = "";
  state.trackDurationSec = null;
  state.trackTitle = null;
  state.trackArtist = null;
  state.deleteEligible = false;
  state.deleteEligibilityJobId = null;
  state.vizData = null;
  if (shouldPreserveTuning) {
    state.tuningParams = preservedTuningParams;
  } else {
    syncTuningParamsState(context);
  }
  if (hadTrackLoaded && !shouldClearTuning) {
    writeTuningParamsToUrl(state.tuningParams, true);
  }
  updateTrackInfo(context);
  const emptyVizData = {
    beats: [],
    edges: [],
    lastBranchPoint: -1,
    anchorEdgeId: null,
    userAnchorEdgeId: null,
  };
  jukebox.setData(emptyVizData);
  jukebox.reset();
}

export async function loadAudioFromJob(context: AppContext, jobId: string) {
  const { autocanonizer, player, state } = context;
  try {
    const buffer = await fetchAudio(jobId);
    await player.decode(buffer);
    autocanonizer.setAudio(player.getBuffer(), player.getContext());
    state.audioLoaded = true;
    state.audioLoadInFlight = false;
    updateVizVisibility(context);
    updateTrackInfo(context);
    maybePrepareSwingMode(context);
    const cacheId = state.lastTrackId ?? state.lastJobId;
    if (cacheId) {
      updateCachedTrack(cacheId, { audio: buffer, jobId }).catch((err) => {
        console.warn(`Cache save failed: ${String(err)}`);
      });
    }
    return true;
  } catch (err) {
    state.audioLoadInFlight = false;
    return false;
  }
}

export function applyAnalysisResult(
  context: AppContext,
  response: AnalysisComplete,
  onAnalysisLoaded?: (response: AnalysisComplete) => void,
): boolean {
  if (!response || response.status !== "complete" || !response.result) {
    return false;
  }
  maybeUpdateDeleteEligibility(context, response, response.id);
  const { autocanonizer, cowbellOverlay, elements, engine, jukebox, state } =
    context;
  applyTuningParamsFromUrl(context);
  const useAutoThreshold = engine.getConfig().currentThreshold === 0;
  engine.loadAnalysis(response.result);
  cowbellOverlay.setSectionStartBeatIndices(engine.getSectionStartBeatIndices());
  applyDeletedEdgesFromUrl(context);
  applyAnchorBranchFromUrl(context);
  autocanonizer.setAnalysis(response.result, response.result.track?.duration);
  const graph = engine.getGraphState();
  state.autoComputedThreshold =
    useAutoThreshold && graph ? Math.round(graph.currentThreshold) : null;
  state.vizData = engine.getVisualizationData();
  const data = state.vizData;
  if (data) {
    jukebox.setData(data);
  }
  state.selectedEdge = null;
  jukebox.setSelectedEdge(null);
  elements.branchStatsPopup.classList.add("hidden");
  syncDeletedEdgeState(context);
  state.analysisLoaded = true;
  updateVizVisibility(context);
  maybePrepareSwingMode(context);
  const resultTrack = response.result.track ?? null;
  const track = resultTrack ?? response.track;
  const title = track?.title;
  const artist = track?.artist;
  state.trackTitle = typeof title === "string" ? title : null;
  state.trackArtist = typeof artist === "string" ? artist : null;
  state.trackDurationSec =
    typeof track?.duration === "number" && Number.isFinite(track.duration)
      ? track.duration
      : null;
  if (title || artist) {
    const baseTitle = title ?? "Unknown";
    const withSuffix = formatPlaybackTitle(
      baseTitle,
      state.playMode,
      state.jukeboxAudioMode,
    );
    const displayTitle = artist ? `${withSuffix} — ${artist}` : withSuffix;
    setAutoMarqueeText(elements.vizNowPlayingEl, displayTitle);
  } else {
    setAutoMarqueeText(elements.vizNowPlayingEl, "The Forever Jukebox");
  }
  updateTrackInfo(context);
  syncActivePlaylistTrackFromLoaded(context);
  savePlaylist(state.playlist);
  onAnalysisLoaded?.(response);
  if (state.playMode === "jukebox") {
    writeTuningParamsToUrl(state.tuningParams, true);
  }
  const jobId = response.id || state.lastJobId;
  if (jobId) {
    recordPlayOnce(context, jobId).catch((err) => {
      console.warn(`Failed to record play: ${String(err)}`);
    });
  }
  return true;
}

async function recordPlayOnce(context: AppContext, jobId: string) {
  const { state } = context;
  if (state.lastPlayCountedJobId === jobId) {
    return;
  }
  state.lastPlayCountedJobId = jobId;
  try {
    await recordPlay(jobId);
  } catch (err) {
    state.lastPlayCountedJobId = null;
    throw err;
  }
}

export async function pollAnalysis(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string,
) {
  const { state } = context;
  const controller = new AbortController();
  state.pollController?.abort();
  state.pollController = controller;
  try {
    while (true) {
      if (controller.signal.aborted) {
        return;
      }
      const response = await fetchAnalysis(jobId, controller.signal);
      if (!response) {
        deps.setAnalysisStatus(GENERIC_LOAD_ERROR_MESSAGE, false);
        return;
      }
      const previousTrackId = normalizeTrackIdentityFromResponse(context, deps, response);
      await migrateCachedAudioForResponse(context, response, previousTrackId);
      maybeUpdateDeleteEligibility(context, response, jobId);
      if (isAnalysisInProgress(response)) {
        const progress =
          typeof response.progress === "number" ? response.progress : null;
        deps.setLoadingProgress(progress, response.message);
        if (
          response.status !== "downloading" &&
          !state.audioLoaded &&
          !state.audioLoadInFlight
        ) {
          state.audioLoadInFlight = true;
          await loadAudioFromJob(context, jobId);
        }
      } else if (isAnalysisFailed(response)) {
        deps.setAnalysisStatus(
          formatErrorForDisplay(response.error, {
            sourceProvider: response.source_provider,
            errorCode: response.error_code,
            fallback: "Loading failed.",
          }),
          false,
        );
        return;
      } else if (isAnalysisComplete(response)) {
        if (!state.audioLoaded) {
          const audioLoaded = await loadAudioFromJob(context, jobId);
          if (!audioLoaded) {
            await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
            continue;
          }
        }
        deps.setLoadingProgress(100, "Calculating pathways");
        if (applyAnalysisResult(context, response, deps.onAnalysisLoaded)) {
          deps.setActiveTab("play");
          return;
        }
      }
      await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
    }
  } finally {
    if (state.pollController === controller) {
      state.pollController = null;
    }
  }
}

async function continueTrackLoadWithResponse(
  context: AppContext,
  deps: PlaybackDeps,
  response: AnalysisResponse | null,
): Promise<boolean> {
  if (!response || !response.id) {
    deps.setAnalysisStatus(GENERIC_LOAD_ERROR_MESSAGE, false);
    return false;
  }
  const previousTrackId = normalizeTrackIdentityFromResponse(context, deps, response);
  await migrateCachedAudioForResponse(context, response, previousTrackId);
  maybeUpdateDeleteEligibility(context, response, response.id);
  if (isAnalysisInProgress(response)) {
    await pollAnalysis(context, deps, response.id);
    return true;
  }
  if (isAnalysisFailed(response)) {
    deps.setAnalysisStatus(
      formatErrorForDisplay(response.error, {
        sourceProvider: response.source_provider,
        errorCode: response.error_code,
        fallback: "Loading failed.",
      }),
      false,
    );
    return false;
  }
  if (isAnalysisComplete(response)) {
    if (!context.state.audioLoaded) {
      const audioLoaded = await loadAudioFromJob(context, response.id);
      if (!audioLoaded) {
        await pollAnalysis(context, deps, response.id);
        return true;
      }
    }
    if (!applyAnalysisResult(context, response, deps.onAnalysisLoaded)) {
      return false;
    }
    deps.setActiveTab("play");
    return true;
  }
  return false;
}

function normalizeTrackIdentityFromResponse(
  context: AppContext,
  deps: PlaybackDeps,
  response: AnalysisResponse,
) {
  if (!response.id) {
    return null;
  }
  const { state } = context;
  const previousTrackId = state.lastTrackId;
  state.lastJobId = response.id;
  state.lastTrackId = response.id;
  state.lastSourceId =
    typeof response.source_id === "string" ? response.source_id : null;
  if (typeof response.source_provider === "string") {
    state.lastSourceProvider = response.source_provider;
  }
  if (previousTrackId !== response.id) {
    deps.onTrackChange?.(response.id);
    deps.updateTrackUrl(response.id, true);
  }
  return previousTrackId;
}

async function migrateCachedAudioForResponse(
  context: AppContext,
  response: AnalysisResponse,
  previousTrackId: string | null,
) {
  if (!response.id || context.state.audioLoaded) {
    return;
  }
  if (await tryLoadCachedAudio(context, response.id)) {
    return;
  }
  const legacyKeys = new Set<string>();
  if (previousTrackId && previousTrackId !== response.id) {
    legacyKeys.add(previousTrackId);
  }
  if (
    (response.source_provider === "youtube" || !response.source_provider) &&
    typeof response.source_id === "string" &&
    response.source_id !== response.id
  ) {
    legacyKeys.add(response.source_id);
  }
  for (const legacyKey of legacyKeys) {
    try {
      const cached = await readCachedTrack(legacyKey);
      if (!cached?.audio) {
        continue;
      }
      await updateCachedTrack(response.id, {
        audio: cached.audio,
        jobId: cached.jobId ?? response.id,
      });
      await deleteCachedTrack(legacyKey);
      await tryLoadCachedAudio(context, response.id);
      return;
    } catch (err) {
      console.warn(`Cache migration failed: ${String(err)}`);
    }
  }
}

async function loadTrack(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
  options?: TrackLoadOptions,
): Promise<boolean> {
  const shouldClear = !options?.preserveUrlTuning;
  handlePlaylistForNormalTrackLoad(context, deps, source, options);
  resetForNewTrack(context, { clearTuning: shouldClear });
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  if (source.type === "source") {
    context.state.lastSourceProvider = source.provider;
    context.state.lastSourceId = source.id;
    context.state.lastTrackId = source.trackId;
    deps.onTrackChange?.(source.trackId);
  } else {
    context.state.lastJobId = source.id;
    context.state.lastTrackId = source.id;
    context.state.lastSourceId = null;
    context.state.lastSourceProvider = options?.selectedTrack?.sourceType ?? null;
    deps.onTrackChange?.(source.id);
  }
  const cacheKey =
    source.type === "source" && source.provider !== "youtube"
      ? `${source.provider}:${source.id}`
      : source.id;
  await tryLoadCachedAudio(context, cacheKey);
  try {
    const response =
      source.type === "source"
        ? await fetchJobBySource(source.provider, source.id)
        : await fetchAnalysis(source.id);
    return await continueTrackLoadWithResponse(context, deps, response);
  } catch (err) {
    deps.setAnalysisStatus(`Load failed: ${formatErrorForDisplay(err)}`, false);
    return false;
  }
}

export async function loadTrackById(
  context: AppContext,
  deps: PlaybackDeps,
  trackId: string,
  options?: TrackLoadOptions,
) {
  const parsed = parseTrackId(trackId);
  if (parsed.type === "job") {
    return await loadTrack(context, deps, { type: "job", id: parsed.jobId }, options);
  }
  return await loadTrack(
    context,
    deps,
    {
      type: "source",
      id: parsed.sourceId,
      provider: parsed.provider,
      trackId: parsed.trackId,
    },
    options,
  );
}

export async function loadTrackByJobId(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string,
  options?: TrackLoadOptions,
) {
  return await loadTrack(context, deps, { type: "job", id: jobId }, options);
}

function parseTrackId(trackId: string):
  | { type: "job"; jobId: string }
  | { type: "source"; provider: string; sourceId: string; trackId: string } {
  if (isLikelyJobId(trackId)) {
    return { type: "job", jobId: trackId };
  }
  const prefixed = /^([a-z]+):(.+)$/.exec(trackId);
  if (
    prefixed &&
    (prefixed[1] === "youtube" ||
      prefixed[1] === "soundcloud" ||
      prefixed[1] === "bandcamp")
  ) {
    return {
      type: "source",
      provider: prefixed[1],
      sourceId: prefixed[2],
      trackId,
    };
  }
  return {
    type: "source",
    provider: "youtube",
    sourceId: trackId,
    trackId,
  };
}

function handlePlaylistForNormalTrackLoad(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
  options?: TrackLoadOptions,
) {
  if (options?.playlistLoad) {
    return;
  }
  if (options?.preservePlaylist) {
    reconcilePreservedPlaylistTrack(context, deps, source);
    return;
  }
  const { state } = context;
  const playlist = state.playlist ?? emptyPlaylist();
  state.playlist = playlist;
  if (isPlaylistActive(playlist)) {
    const track =
      options?.selectedTrack ?? playlistTrackFromLoadSource(source, state.tuningParams);
    state.playlist = replaceActivePlaylistTrack(playlist, track);
    savePlaylist(state.playlist);
    deps.onPlaylistChange?.();
    return;
  }
  if (hasInactiveSavedPlaylist(playlist)) {
    state.playlist = emptyPlaylist();
    savePlaylist(state.playlist);
    deps.onPlaylistChange?.();
  }
}

function reconcilePreservedPlaylistTrack(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
) {
  const playlist = context.state.playlist ?? emptyPlaylist();
  context.state.playlist = playlist;
  if (playlist.tracks.length < 2) {
    return;
  }
  const sourceKey = playlistTrackKey(playlistTrackIdentityFromLoadSource(source));
  const matchingIndex = playlist.tracks.findIndex(
    (track) => playlistTrackKey(track) === sourceKey,
  );
  if (matchingIndex >= 0) {
    if (playlist.currentIndex === matchingIndex) {
      return;
    }
    context.state.playlist = activatePlaylistTrack(playlist, matchingIndex);
    deps.onPlaylistChange?.();
    return;
  }

  const nextTracks = playlist.tracks.slice(0, PLAYLIST_MAX_TRACKS);
  const nextTrack = playlistTrackFromLoadSource(source, context.state.tuningParams);
  let nextCurrentIndex = nextTracks.length;
  if (nextTracks.length >= PLAYLIST_MAX_TRACKS) {
    nextCurrentIndex = PLAYLIST_MAX_TRACKS - 1;
    nextTracks[nextCurrentIndex] = nextTrack;
  } else {
    nextTracks.push(nextTrack);
  }
  context.state.playlist = {
    tracks: nextTracks,
    currentIndex: nextCurrentIndex,
  };
  savePlaylist(context.state.playlist);
  deps.onPlaylistChange?.();
}

function playlistTrackFromLoadSource(
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
  tuningParams: string | null,
): PlaylistTrack {
  const identity = playlistTrackIdentityFromLoadSource(source);
  return {
    ...identity,
    title: "Untitled",
    artist: "",
    duration: null,
    tuningParams,
  };
}

function playlistTrackIdentityFromLoadSource(
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
): Pick<PlaylistTrack, "id" | "sourceType"> {
  if (source.type === "job") {
    return { id: source.id, sourceType: "upload" };
  }
  return {
    id: source.id,
    sourceType: playlistSourceTypeFromProvider(source.provider),
  };
}

function playlistSourceTypeFromProvider(provider: string): PlaylistSourceType {
  if (provider === "soundcloud" || provider === "bandcamp") {
    return provider;
  }
  if (provider === "upload") {
    return "upload";
  }
  return "youtube";
}

function syncActivePlaylistTrackFromLoaded(context: AppContext) {
  const { state } = context;
  const playlist = state.playlist ?? emptyPlaylist();
  state.playlist = playlist;
  if (!isPlaylistActive(playlist)) {
    return;
  }
  const track = playlist.tracks[playlist.currentIndex];
  if (!track) {
    return;
  }
  state.playlist = replaceActivePlaylistTrack(state.playlist, {
    ...track,
    id: state.lastTrackId ?? track.id,
    sourceType: playlistSourceTypeFromProvider(state.lastSourceProvider ?? track.sourceType),
    title: state.trackTitle || track.title || "Untitled",
    artist: state.trackArtist || track.artist || "",
    duration: state.trackDurationSec,
    tuningParams: state.playMode === "jukebox" ? state.tuningParams : null,
  });
}

export function requestWakeLock(context: AppContext) {
  if (!("wakeLock" in navigator)) {
    return;
  }
  if (context.state.wakeLock || !document.fullscreenElement) {
    return;
  }
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      context.state.wakeLock = lock;
      function onRelease() {
        if (context.state.wakeLock === lock) {
          handleWakeLockRelease(context);
        }
      }
      lock.addEventListener("release", onRelease);
    })
    .catch(() => {
      console.warn("Wake lock unavailable");
    });
}

function handleWakeLockRelease(context: AppContext) {
  context.state.wakeLock = null;
}

export function releaseWakeLock(context: AppContext) {
  const lock = context.state.wakeLock;
  if (!lock) {
    return;
  }
  context.state.wakeLock = null;
  lock.release().catch(() => {
    console.warn("Failed to release wake lock");
  });
}

export function cancelPoll(context: AppContext) {
  if (!context.state.pollController) {
    return;
  }
  context.state.pollController.abort();
  context.state.pollController = null;
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    if (!signal) {
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function tryLoadCachedAudio(
  context: AppContext,
  trackId: string,
) {
  const { autocanonizer, player, state } = context;
  try {
    const cached = await readCachedTrack(trackId);
    if (!cached?.audio) {
      return false;
    }
    state.lastJobId = cached.jobId ?? null;
    await player.decode(cached.audio);
    autocanonizer.setAudio(player.getBuffer(), player.getContext());
    state.audioLoaded = true;
    state.audioLoadInFlight = false;
    updateVizVisibility(context);
    updateTrackInfo(context);
    maybePrepareSwingMode(context);
    return true;
  } catch (err) {
    console.warn(`Cache lookup failed: ${String(err)}`);
    return false;
  }
}

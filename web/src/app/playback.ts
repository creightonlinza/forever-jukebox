import type { AppContext, TabId } from "./context";
import type { JukeboxAudioMode } from "../audio/BufferedAudioPlayer";
import {
  ANALYSIS_POLL_INTERVAL_MS,
  LISTEN_TIMER_INTERVAL_MS,
} from "./constants";
import { formatDuration } from "./format";
import {
  fetchAnalysis,
  fetchAudio,
  fetchJobBySource,
  recordPlay,
  type AnalysisComplete,
  type AnalysisResponse,
} from "./api";
import { readCachedTrack, updateCachedTrack } from "./cache";
import {
  applyTuningParamsFromUrl,
  clearTuningParamsFromUrl,
  getDeletedEdgeIdsFromUrl,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "./tuning";
import { storeAnchorHighlight } from "./anchorHighlight";
import { storeBranchStatsEnabled } from "./extrasMode";
import { setAutoMarqueeText } from "./marquee";
import {
  isAnalysisComplete,
  isAnalysisFailed,
  isAnalysisInProgress,
} from "./analysisStatus";

const DEFAULT_VOLUME = 0.5;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const RANDOM_BRANCH_DELTA_PERCENT_SCALE = 100 / MAX_RANDOM_BRANCH_DELTA;
const GENERIC_LOAD_ERROR_MESSAGE =
  "ERROR: Something went wrong. Please try again or report an issue on GitHub.";

function formatTrackTitle(
  baseTitle: string,
  playMode: AppContext["state"]["playMode"],
  audioMode: JukeboxAudioMode,
) {
  if (playMode === "autocanonizer") {
    return `${baseTitle} (autocanonized)`;
  }
  if (audioMode !== "off") {
    return `${baseTitle} (${audioMode})`;
  }
  return baseTitle;
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

export function syncDeletedEdgeState(context: AppContext) {
  const { engine, state } = context;
  state.deletedEdgeIds = getDeletedEdgeIdsFromGraph(engine.getGraphState());
  syncTuningParamsState(context);
}

export type PlaybackDeps = {
  setActiveTab: (tabId: TabId) => void;
  navigateToTab: (
    tabId: TabId,
    options?: { replace?: boolean; youtubeId?: string | null },
  ) => void;
  updateTrackUrl: (youtubeId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  setLoadingProgress: (
    progress: number | null,
    message?: string | null,
  ) => void;
  onTrackChange?: (youtubeId: string | null) => void;
  onAnalysisLoaded?: (response: AnalysisComplete) => void;
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
  const { state, elements } = context;
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
    elements.deleteButton.classList.add("hidden");
    state.deleteEligibilityJobId = null;
    return;
  }
  state.deleteEligibilityJobId = jobId;
  state.deleteEligible = eligible;
  elements.deleteButton.classList.toggle("hidden", !eligible);
}

export function updateTrackInfo(context: AppContext) {
  const { elements, engine, player, state } = context;
  const graph = engine.getGraphState();
  const resolvedDuration =
    typeof state.trackDurationSec === "number" &&
    Number.isFinite(state.trackDurationSec)
      ? state.trackDurationSec
      : player.getDuration();
  elements.infoDurationEl.textContent =
    typeof resolvedDuration === "number" && Number.isFinite(resolvedDuration)
      ? formatDuration(resolvedDuration)
      : "00:00:00";
  elements.infoBeatsEl.textContent = `${graph ? graph.totalBeats : 0}`;
  const branchCount = state.vizData
    ? state.vizData.edges.length
    : graph
      ? graph.allEdges.filter((edge) => !edge.deleted).length
      : 0;
  elements.infoBranchesEl.textContent = `${branchCount}`;
  const deletedCount = graph
    ? graph.allEdges.filter((edge) => edge.deleted).length
    : state.deletedEdgeIds.length;
  elements.infoDeletedBranchesEl.textContent = `${deletedCount}`;
}

export function updateVizVisibility(context: AppContext) {
  const { autocanonizer, elements, jukebox, state } = context;
  if (state.audioLoaded && state.analysisLoaded) {
    elements.playStatusPanel.classList.add("hidden");
    elements.playMenu.classList.remove("hidden");
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
    elements.playMenu.classList.add("hidden");
    elements.vizPanel.classList.add("hidden");
    elements.playButton.classList.add("hidden");
    elements.vizSelect.disabled = true;
  }
}

export function openTuning(context: AppContext) {
  syncTuningUI(context);
  syncExtrasUI(context);
  syncTuningTabsUI(context);
  setActiveTuningTab(context, "tuning");
  context.elements.tuningModal.classList.add("open");
}

export function closeTuning(context: AppContext) {
  context.elements.tuningModal.classList.remove("open");
}

export function openInfo(context: AppContext) {
  updateTrackInfo(context);
  context.elements.infoModal.classList.add("open");
}

export function closeInfo(context: AppContext) {
  context.elements.infoModal.classList.remove("open");
}

function getSelectedAudioMode(context: AppContext): JukeboxAudioMode {
  const { elements } = context;
  if (elements.audioModeNightcoreInput.checked) {
    return "nightcore";
  }
  if (elements.audioModeDaycoreInput.checked) {
    return "daycore";
  }
  if (elements.audioModeVaporwaveInput.checked) {
    return "vaporwave";
  }
  if (elements.audioModeEightDInput.checked) {
    return "eight_d";
  }
  if (elements.audioModeLofiInput.checked) {
    return "lofi";
  }
  return "off";
}

export function syncExtrasUI(context: AppContext) {
  const { elements, state } = context;
  const inJukeboxMode = state.playMode === "jukebox";
  elements.extrasEnabledInput.checked =
    inJukeboxMode && state.branchStatsEnabled;
  elements.extrasEnabledInput.disabled = !inJukeboxMode;
  const audioMode = state.jukeboxAudioMode;
  elements.audioModeOffInput.checked = audioMode === "off";
  elements.audioModeNightcoreInput.checked = audioMode === "nightcore";
  elements.audioModeDaycoreInput.checked = audioMode === "daycore";
  elements.audioModeVaporwaveInput.checked = audioMode === "vaporwave";
  elements.audioModeEightDInput.checked = audioMode === "eight_d";
  elements.audioModeLofiInput.checked = audioMode === "lofi";
  elements.audioModeOffInput.disabled = !inJukeboxMode;
  elements.audioModeNightcoreInput.disabled = !inJukeboxMode;
  elements.audioModeDaycoreInput.disabled = !inJukeboxMode;
  elements.audioModeVaporwaveInput.disabled = !inJukeboxMode;
  elements.audioModeEightDInput.disabled = !inJukeboxMode;
  elements.audioModeLofiInput.disabled = !inJukeboxMode;
}

export type TuningModalTab = "tuning" | "extras";

export function syncTuningTabsUI(context: AppContext) {
  const { elements, state } = context;
  const hasExtrasTab = state.playMode === "jukebox";
  elements.tuningTabToggle.classList.toggle("hidden", !hasExtrasTab);
  if (!hasExtrasTab) {
    setActiveTuningTab(context, "tuning");
    return;
  }
  const activeTab = getActiveTuningTab(context);
  setActiveTuningTab(context, activeTab);
}

export function setActiveTuningTab(context: AppContext, tab: TuningModalTab) {
  const { elements, state } = context;
  const hasExtrasTab = state.playMode === "jukebox";
  const nextTab = tab === "extras" && hasExtrasTab ? "extras" : "tuning";
  const tuningActive = nextTab === "tuning";
  elements.tuningTitleText.textContent = tuningActive ? "Tuning" : "Extras";
  elements.tuningBetaTag.classList.toggle("hidden", tuningActive);
  elements.tuningTabToggle.classList.toggle("hidden", !hasExtrasTab || !tuningActive);
  elements.tuningTabToggleIcon.textContent = tuningActive ? "science" : "tune";
  elements.tuningTabToggleLabel.textContent = tuningActive ? "Extras" : "Tuning";
  elements.tuningTabToggle.setAttribute(
    "aria-label",
    tuningActive ? "Switch to Extras" : "Switch to Tuning"
  );
  elements.tuningPanelTuning.classList.toggle("hidden", !tuningActive);
  elements.tuningPanelExtras.classList.toggle("hidden", tuningActive);
}

export function getActiveTuningTab(context: AppContext): TuningModalTab {
  return context.elements.tuningPanelTuning.classList.contains("hidden")
    ? "extras"
    : "tuning";
}

export type ExtrasApplyResult = {
  branchStatsChanged: boolean;
  audioModeChanged: boolean;
};

export function applyExtrasChanges(context: AppContext): ExtrasApplyResult {
  const { elements, engine, player, state } = context;
  const previousBranchStatsEnabled = state.branchStatsEnabled;
  const previousAudioMode = state.jukeboxAudioMode;
  state.branchStatsEnabled =
    state.playMode === "jukebox" && elements.extrasEnabledInput.checked;
  if (!state.branchStatsEnabled) {
    elements.extrasPopup.classList.add("hidden");
  }
  storeBranchStatsEnabled(state.branchStatsEnabled);
  const nextAudioMode = getSelectedAudioMode(context);
  state.jukeboxAudioMode = nextAudioMode;
  player.setJukeboxAudioMode(nextAudioMode);
  if (
    previousAudioMode !== nextAudioMode &&
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

export function resetExtrasDefaults(context: AppContext): ExtrasApplyResult {
  const { elements, engine, player, state } = context;
  const previousBranchStatsEnabled = state.branchStatsEnabled;
  const previousAudioMode = state.jukeboxAudioMode;
  state.branchStatsEnabled = false;
  elements.extrasPopup.classList.add("hidden");
  storeBranchStatsEnabled(false);
  state.jukeboxAudioMode = "off";
  player.setJukeboxAudioMode("off");
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

export function syncTuningUI(context: AppContext) {
  const { elements, engine, player, state } = context;
  const config = engine.getConfig();
  const graph = engine.getGraphState();
  const thresholdValue =
    config.currentThreshold === 0 && graph
      ? Math.round(graph.currentThreshold)
      : config.currentThreshold;
  elements.thresholdInput.value = `${thresholdValue}`;
  elements.thresholdVal.textContent = elements.thresholdInput.value;
  const minProbPct = Math.round(config.minRandomBranchChance * 100);
  const maxProbPct = Math.round(config.maxRandomBranchChance * 100);
  const rampPct =
    Math.round(config.randomBranchChanceDelta * RANDOM_BRANCH_DELTA_PERCENT_SCALE * 10) / 10;
  elements.minProbInput.value = `${minProbPct}`;
  elements.minProbVal.textContent = `${minProbPct}%`;
  elements.maxProbInput.value = `${maxProbPct}`;
  elements.maxProbVal.textContent = `${maxProbPct}%`;
  elements.rampInput.value = `${rampPct}`;
  elements.rampVal.textContent = `${rampPct}%`;
  const volumePct = Math.round(player.getVolume() * 100);
  elements.volumeInput.value = `${volumePct}`;
  elements.volumeVal.textContent = `${volumePct}`;
  elements.justBackwardsInput.checked = config.justBackwards;
  elements.justLongInput.checked = config.justLongBranches;
  elements.removeSeqInput.checked = config.removeSequentialBranches;
  elements.highlightAnchorBranchInput.checked = state.highlightAnchorBranch;
  const computedValue =
    state.autoComputedThreshold ??
    (graph ? Math.round(graph.currentThreshold) : null);
  elements.computedThresholdEl.textContent =
    computedValue === null ? "-" : `${computedValue}`;
}

export function applyTuningChanges(context: AppContext) {
  const { elements, engine, jukebox, state } = context;
  const threshold = Number(elements.thresholdInput.value);
  const computed = Number(elements.computedThresholdEl.textContent);
  const useAutoThreshold =
    engine.getConfig().currentThreshold === 0 &&
    Number.isFinite(computed) &&
    threshold === computed;
  let minProb = Number(elements.minProbInput.value) / 100;
  let maxProb = Number(elements.maxProbInput.value) / 100;
  const ramp = Number(elements.rampInput.value) / RANDOM_BRANCH_DELTA_PERCENT_SCALE;
  if (minProb > maxProb) {
    [minProb, maxProb] = [maxProb, minProb];
    elements.minProbInput.value = `${Math.round(minProb * 100)}`;
    elements.maxProbInput.value = `${Math.round(maxProb * 100)}`;
    elements.minProbVal.textContent = `${elements.minProbInput.value}%`;
    elements.maxProbVal.textContent = `${elements.maxProbInput.value}%`;
  }
  engine.updateConfig({
    currentThreshold: useAutoThreshold ? 0 : threshold,
    minRandomBranchChance: minProb,
    maxRandomBranchChance: maxProb,
    randomBranchChanceDelta: ramp,
    justBackwards: elements.justBackwardsInput.checked,
    justLongBranches: elements.justLongInput.checked,
    removeSequentialBranches: elements.removeSeqInput.checked,
  });
  state.highlightAnchorBranch = elements.highlightAnchorBranchInput.checked;
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
  if (graph) {
    const resolved = Math.max(0, Math.round(graph.currentThreshold));
    if (useAutoThreshold) {
      state.autoComputedThreshold = resolved;
    }
    elements.computedThresholdEl.textContent = `${resolved}`;
    if (useAutoThreshold) {
      elements.thresholdInput.value = `${resolved}`;
      elements.thresholdVal.textContent = elements.thresholdInput.value;
    }
  } else {
    elements.computedThresholdEl.textContent =
      state.autoComputedThreshold === null
        ? "-"
        : `${state.autoComputedThreshold}`;
  }
  syncTuningParamsState(context);
  writeTuningParamsToUrl(state.tuningParams, true);
  closeTuning(context);
}

export function resetTuningDefaults(context: AppContext) {
  const { autocanonizer, engine, jukebox, state, player } = context;
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
  state.tuningParams = null;
  writeTuningParamsToUrl(null, true);
  player.setVolume(DEFAULT_VOLUME);
  autocanonizer.setVolume(DEFAULT_VOLUME);
  syncTuningUI(context);
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
  const { autocanonizer, elements, engine, jukebox, player, state } = context;
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
    elements.bringHomeLabel.classList.add("is-hidden");
    elements.bringHomeFullscreenLabel.classList.add("is-hidden");
  }
  stopListenTimer(context);
  updateListenTimeDisplay(context);
  updatePlayButton(context);
}

function pausePlayback(context: AppContext) {
  const { autocanonizer, engine, player, state } = context;
  if (!state.isRunning) {
    return;
  }
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
  const { engine, elements, jukebox, player, state } = context;
  if (player.getDuration() === null) {
    console.warn("Audio not loaded");
    if (!resetSession) {
      stopPlayback(context);
    }
    return;
  }
  if (resetSession) {
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
  engine.startJukebox(resetSession);
  engine.play();
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
  const { engine, player, state } = context;
  if (state.playMode !== "jukebox") {
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

  player.seek(beat.start);
  engine.seekToBeat(index);
  state.lastBeatIndex = index;
  if (!state.isRunning) {
    engine.startJukebox(false);
    engine.play();
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
  const { autocanonizer, engine, elements, player, state } = context;
  if (!autocanonizer.isReady()) {
    console.warn("Autocanonizer not ready");
    return false;
  }
  const resetSession = options?.resetSession ?? true;
  player.stop();
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
  const label = isRunning ? "Pause" : state.isPaused ? "Resume" : "Play";
  const updateButton = (button: HTMLButtonElement) => {
    const icon = button.querySelector<HTMLSpanElement>(".play-icon");
    if (icon) {
      icon.textContent = isRunning ? "pause" : "play_arrow";
    }
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  updateButton(context.elements.playButton);
  if (context.elements.vizPlayButton !== context.elements.playButton) {
    updateButton(context.elements.vizPlayButton);
  }
  const shouldPulse = isRunning && context.state.activeTabId !== "play";
  context.elements.playTabButton.classList.toggle("is-playing", shouldPulse);
}

export function resetForNewTrack(
  context: AppContext,
  options?: { clearTuning?: boolean },
) {
  const { autocanonizer, elements, engine, jukebox, player, state, defaultConfig } =
    context;
  const shouldClearTuning = options?.clearTuning ?? false;
  const hadTrackLoaded =
    state.audioLoaded ||
    state.analysisLoaded ||
    state.lastJobId !== null ||
    state.lastYouTubeId !== null ||
    state.trackTitle !== null;
  if (hadTrackLoaded) {
    state.jukeboxAudioMode = "off";
    player.setJukeboxAudioMode("off");
  }
  cancelPoll(context);
  state.shiftBranching = false;
  engine.setForceBranch(false);
  state.bringItHomeMode = false;
  engine.setBringItHomeMode(false);
  elements.bringHomeLabel.classList.add("is-hidden");
  elements.bringHomeFullscreenLabel.classList.add("is-hidden");
  state.selectedEdge = null;
  jukebox.setSelectedEdge(null);
  elements.extrasPopup.classList.add("hidden");
  engine.clearDeletedEdges();
  state.deletedEdgeIds = [];
  state.audioLoaded = false;
  state.analysisLoaded = false;
  state.audioLoadInFlight = false;
  state.lastJobId = null;
  state.lastYouTubeId = null;
  state.lastSourceProvider = null;
  state.lastPlayCountedJobId = null;
  updateVizVisibility(context);
  state.playTimerMs = 0;
  state.lastPlayStamp = null;
  state.lastBeatIndex = null;
  updateListenTimeDisplay(context);
  elements.beatsPlayedEl.textContent = "0";
  setAutoMarqueeText(elements.vizNowPlayingEl, "The Forever Jukebox");
  if (elements.tuningModal.classList.contains("open")) {
    elements.tuningModal.classList.remove("open");
  }
  if (elements.infoModal.classList.contains("open")) {
    elements.infoModal.classList.remove("open");
  }
  if (state.isRunning || state.isPaused) {
    stopPlayback(context);
  }
  autocanonizer.reset();
  state.autoComputedThreshold = null;
  if (shouldClearTuning) {
    state.tuningParams = null;
    clearTuningParamsFromUrl(true);
  }
  elements.computedThresholdEl.textContent = "-";
  engine.updateConfig({ ...defaultConfig });
  syncTuningUI(context);
  setAutoMarqueeText(elements.playTitle, "");
  elements.analysisStatus.textContent = "No song selected.";
  elements.analysisSpinner.classList.add("hidden");
  elements.analysisProgress.textContent = "";
  state.trackDurationSec = null;
  state.trackTitle = null;
  state.trackArtist = null;
  state.deleteEligible = false;
  state.deleteEligibilityJobId = null;
  elements.deleteButton.classList.add("hidden");
  state.vizData = null;
  syncTuningParamsState(context);
  if (hadTrackLoaded && !shouldClearTuning) {
    writeTuningParamsToUrl(state.tuningParams, true);
  }
  updateTrackInfo(context);
  const emptyVizData = {
    beats: [],
    edges: [],
    lastBranchPoint: -1,
    anchorEdgeId: null,
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
    const cacheId = state.lastYouTubeId ?? state.lastJobId;
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
  const { autocanonizer, elements, engine, jukebox, state } = context;
  applyTuningParamsFromUrl(context);
  const useAutoThreshold = engine.getConfig().currentThreshold === 0;
  engine.loadAnalysis(response.result);
  applyDeletedEdgesFromUrl(context);
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
  elements.extrasPopup.classList.add("hidden");
  syncDeletedEdgeState(context);
  state.analysisLoaded = true;
  updateVizVisibility(context);
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
    const withSuffix = formatTrackTitle(
      baseTitle,
      state.playMode,
      state.jukeboxAudioMode,
    );
    const displayTitle = artist ? `${withSuffix} — ${artist}` : withSuffix;
    setAutoMarqueeText(elements.playTitle, displayTitle);
    setAutoMarqueeText(elements.vizNowPlayingEl, displayTitle);
  } else {
    setAutoMarqueeText(elements.playTitle, "");
    setAutoMarqueeText(elements.vizNowPlayingEl, "The Forever Jukebox");
  }
  updateTrackInfo(context);
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
        deps.setAnalysisStatus(response.error || "Loading failed.", false);
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
) {
  if (!response || !response.id) {
    deps.setAnalysisStatus(GENERIC_LOAD_ERROR_MESSAGE, false);
    return;
  }
  maybeUpdateDeleteEligibility(context, response, response.id);
  context.state.lastJobId = response.id;
  if (typeof response.source_provider === "string") {
    context.state.lastSourceProvider = response.source_provider;
  }
  if (
    response.source_provider === "youtube" &&
    typeof response.source_id === "string" &&
    response.source_id
  ) {
    context.state.lastYouTubeId = response.source_id;
    deps.onTrackChange?.(response.source_id);
  } else if (response.source_provider && response.source_provider !== "youtube") {
    context.state.lastYouTubeId = null;
    deps.onTrackChange?.(null);
  }
  if (isAnalysisInProgress(response)) {
    await pollAnalysis(context, deps, response.id);
    return;
  }
  if (isAnalysisComplete(response)) {
    if (!context.state.audioLoaded) {
      const audioLoaded = await loadAudioFromJob(context, response.id);
      if (!audioLoaded) {
        await pollAnalysis(context, deps, response.id);
        return;
      }
    }
    applyAnalysisResult(context, response, deps.onAnalysisLoaded);
    deps.setActiveTab("play");
    return;
  }
  await pollAnalysis(context, deps, response.id);
}

async function loadTrack(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string }
    | { type: "job"; id: string },
  options?: { preserveUrlTuning?: boolean },
) {
  const shouldClear = !options?.preserveUrlTuning;
  resetForNewTrack(context, { clearTuning: shouldClear });
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  if (source.type === "source") {
    context.state.lastSourceProvider = source.provider;
    if (source.provider === "youtube") {
      context.state.lastYouTubeId = source.id;
      deps.onTrackChange?.(source.id);
    } else {
      context.state.lastYouTubeId = null;
      deps.onTrackChange?.(null);
    }
  } else {
    context.state.lastJobId = source.id;
    context.state.lastYouTubeId = null;
    context.state.lastSourceProvider = "upload";
    deps.onTrackChange?.(null);
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
    await continueTrackLoadWithResponse(context, deps, response);
  } catch (err) {
    deps.setAnalysisStatus(`Load failed: ${String(err)}`, false);
  }
}

export async function loadTrackByYouTubeId(
  context: AppContext,
  deps: PlaybackDeps,
  youtubeId: string,
  options?: { preserveUrlTuning?: boolean; sourceProvider?: string },
) {
  const provider = options?.sourceProvider ?? "youtube";
  await loadTrack(context, deps, { type: "source", id: youtubeId, provider }, options);
}

export async function loadTrackByJobId(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string,
  options?: { preserveUrlTuning?: boolean },
) {
  await loadTrack(context, deps, { type: "job", id: jobId }, options);
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
  youtubeId: string,
) {
  const { autocanonizer, player, state } = context;
  try {
    const cached = await readCachedTrack(youtubeId);
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
    return true;
  } catch (err) {
    console.warn(`Cache lookup failed: ${String(err)}`);
    return false;
  }
}

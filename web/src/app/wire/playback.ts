import type { AppContext, AppState } from "../context";
import type { Elements } from "../elements";
import type { Edge } from "../../engine/types";
import type { BufferedAudioPlayer } from "../../audio/BufferedAudioPlayer";
import type { JukeboxEngine } from "../../engine";
import type { JukeboxController } from "../../jukebox/JukeboxController";
import type { AutocanonizerController } from "../../autocanonizer/AutocanonizerController";
import { VISUALIZATION_LABELS } from "../constants";

type PlaybackUiDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  player: BufferedAudioPlayer;
  engine: JukeboxEngine;
  jukebox: JukeboxController;
  autocanonizer: AutocanonizerController;
  vizStorageKey: string;
  canonizerFinishKey: string;
  setAnalysisStatus: (
    context: AppContext,
    message: string,
    spinning: boolean,
  ) => void;
  showToast: (
    context: AppContext,
    message: string,
    options?: { icon?: string },
  ) => void;
  stopPlayback: (context: AppContext) => void;
  togglePlayback: (context: AppContext) => void;
  startJukeboxFromBeat: (context: AppContext, index: number) => void;
  startAutocanonizerPlayback: (context: AppContext, index: number) => void;
  updateTrackUrl: (
    youtubeId: string,
    replace?: boolean,
    tuningParams?: string | null,
    playMode?: "jukebox" | "autocanonizer",
  ) => void;
  navigateToTab: (
    tabId: "top" | "search" | "play" | "faq",
    options?: { replace?: boolean; youtubeId?: string | null },
    lastYouTubeId?: string | null,
    tuningParams?: string | null,
    playMode?: "jukebox" | "autocanonizer",
  ) => void;
  updateVizVisibility: (context: AppContext) => void;
  getTuningParamsFromEngine: (context: AppContext) => URLSearchParams;
  writeTuningParamsToUrl: (tuningParams: string | null, replace?: boolean) => void;
  syncDeletedEdgeState: (context: AppContext) => void;
  updateTrackInfo: (context: AppContext) => void;
  isEditableTarget: (target: EventTarget | null) => boolean;
  getCurrentTrackId: () => string | null;
};

export type PlaybackUiHandlers = ReturnType<typeof createPlaybackUiHandlers>;

function getVisualizationLabel(index: number) {
  return VISUALIZATION_LABELS[index] ?? `Visualization ${index + 1}`;
}

export function createPlaybackUiHandlers(deps: PlaybackUiDeps) {
  const {
    context,
    elements,
    state,
    player,
    engine,
    jukebox,
    autocanonizer,
    vizStorageKey,
    canonizerFinishKey,
    setAnalysisStatus,
    showToast,
    stopPlayback,
    togglePlayback,
    startJukeboxFromBeat,
    startAutocanonizerPlayback,
    updateTrackUrl,
    navigateToTab,
    updateVizVisibility,
    getTuningParamsFromEngine,
    writeTuningParamsToUrl,
    syncDeletedEdgeState,
    updateTrackInfo,
    isEditableTarget,
    getCurrentTrackId,
  } = deps;

  function initializePlayback() {
    setPlayMode("jukebox");
    syncVisualizationSelectOptions();

    const storedViz = localStorage.getItem(vizStorageKey);
    if (storedViz) {
      const parsed = Number.parseInt(storedViz, 10);
      if (Number.isFinite(parsed)) {
        setActiveVisualization(parsed);
      }
    }
    const storedCanonizerFinish = localStorage.getItem(canonizerFinishKey);
    const finishOutSong = storedCanonizerFinish === "true";
    elements.canonizerFinish.checked = finishOutSong;
    autocanonizer.setFinishOutSong(finishOutSong);

    player.setOnEnded(() => {
      if (state.isRunning) {
        stopPlayback(context);
      }
    });

    autocanonizer.setOnBeat((index) => {
      elements.beatsPlayedEl.textContent = `${index + 1}`;
      state.lastBeatIndex = index;
    });
    autocanonizer.setOnEnded(() => {
      if (state.isRunning) {
        stopPlayback(context);
      }
    });
    autocanonizer.setOnSelect((index) => {
      if (state.playMode !== "autocanonizer") {
        return;
      }
      startAutocanonizerPlayback(context, index);
    });

    engine.onUpdate((engineState) => {
      elements.beatsPlayedEl.textContent = `${engineState.beatsPlayed}`;
      if (engineState.currentBeatIndex >= 0) {
        const jumpFrom =
          engineState.lastJumped && engineState.lastJumpFromIndex !== null
            ? engineState.lastJumpFromIndex
            : state.lastBeatIndex;
        jukebox.update(
          engineState.currentBeatIndex,
          engineState.lastJumped,
          jumpFrom,
        );
        state.lastBeatIndex = engineState.currentBeatIndex;
      }
    });
  }

  function handlePlayClick() {
    togglePlayback(context);
  }

  function handleShortUrlClick() {
    void copyShortUrl();
  }

  function handleVizSelectChange(event: Event) {
    const select = event.currentTarget as HTMLSelectElement | null;
    const idx = Number(select?.value);
    if (!Number.isFinite(idx)) {
      elements.vizSelect.value = String(state.activeVizIndex);
      return;
    }
    setActiveVisualization(idx);
  }

  function handleModeSelectChange(event: Event) {
    const select = event.currentTarget as HTMLSelectElement | null;
    const mode = select?.value === "autocanonizer" ? "autocanonizer" : "jukebox";
    setPlayMode(mode);
  }

  function handleCanonizerFinish(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    if (!input) {
      return;
    }
    localStorage.setItem(canonizerFinishKey, String(input.checked));
    autocanonizer.setFinishOutSong(input.checked);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (state.activeTabId !== "play") {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback(context);
      return;
    }
    if (state.playMode === "autocanonizer") {
      return;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      state.selectedEdge &&
      !state.selectedEdge.deleted
    ) {
      event.preventDefault();
      engine.deleteEdge(state.selectedEdge);
      engine.rebuildGraph();
      state.vizData = engine.getVisualizationData();
      const data = state.vizData;
      if (data) {
        jukebox.setData(data);
      }
      jukebox.refresh();
      jukebox.resizeActive();
      syncDeletedEdgeState(context);
      updateTrackInfo(context);
      writeTuningParamsToUrl(state.tuningParams, true);
      state.selectedEdge = null;
      jukebox.setSelectedEdge(null);
      return;
    }
    if (event.key === "Shift" && state.isRunning && !state.shiftBranching) {
      state.shiftBranching = true;
      engine.setForceBranch(true);
    }
  }

  function handleKeyup(event: KeyboardEvent) {
    if (state.playMode === "autocanonizer") {
      return;
    }
    if (event.key === "Shift" && state.shiftBranching) {
      state.shiftBranching = false;
      engine.setForceBranch(false);
    }
  }

  function handleBeatSelect(index: number) {
    if (state.playMode === "autocanonizer") {
      return;
    }
    if (!state.vizData) {
      return;
    }
    const beat = state.vizData.beats[index];
    if (!beat) {
      return;
    }
    startJukeboxFromBeat(context, index);
    jukebox.update(index, true, null);
  }

  function handleEdgeSelect(edge: Edge | null) {
    if (state.playMode === "autocanonizer") {
      return;
    }
    state.selectedEdge = edge;
    jukebox.setSelectedEdgeActive(edge);
  }

  async function copyShortUrl() {
    const trackId = state.lastYouTubeId ?? state.lastJobId;
    if (!trackId) {
      setAnalysisStatus(
        context,
        "Select a track to generate a short URL.",
        false,
      );
      return;
    }
    const url = new URL(
      `${window.location.origin}/listen/${encodeURIComponent(trackId)}`,
    );
    if (state.playMode === "jukebox") {
      const tuningParams = getTuningParamsFromEngine(context);
      tuningParams.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
    }
    if (state.playMode === "autocanonizer") {
      url.searchParams.set("mode", "autocanonizer");
    }
    const shortUrl = url.toString();
    try {
      await navigator.clipboard.writeText(shortUrl);
      showToast(context, "Link copied to clipboard");
    } catch (err) {
      setAnalysisStatus(context, `Copy failed: ${String(err)}`, false);
    }
  }

  function setActiveVisualization(index: number) {
    const count = jukebox.getCount();
    if (index < 0 || index >= count) {
      elements.vizSelect.value = String(state.activeVizIndex);
      return;
    }
    if (index === state.activeVizIndex) {
      elements.vizSelect.value = String(index);
      return;
    }
    state.activeVizIndex = index;
    jukebox.setActiveIndex(index);
    elements.vizSelect.value = String(state.activeVizIndex);
    localStorage.setItem(vizStorageKey, String(state.activeVizIndex));
  }

  function syncVisualizationSelectOptions() {
    const count = jukebox.getCount();
    const expectedValues = Array.from({ length: count }, (_, idx) => String(idx));
    const currentValues = Array.from(elements.vizSelect.options, (option) => option.value);
    const needsRebuild =
      currentValues.length !== expectedValues.length ||
      currentValues.some((value, idx) => value !== expectedValues[idx]);

    if (!needsRebuild) {
      return;
    }

    elements.vizSelect.replaceChildren();
    expectedValues.forEach((value, idx) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = getVisualizationLabel(idx);
      elements.vizSelect.append(option);
    });
  }

  function getPlayModeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "autocanonizer" ? "autocanonizer" : "jukebox";
  }

  function applyModeFromUrl() {
    setPlayMode(getPlayModeFromUrl());
  }

  function setPlayMode(mode: "jukebox" | "autocanonizer") {
    if (state.playMode === mode) {
      elements.playModeSelect.value = mode;
      return;
    }
    if (state.isRunning) {
      stopPlayback(context);
    }
    state.playMode = mode;
    elements.playModeSelect.value = mode;
    elements.jukeboxViz.classList.toggle(
      "is-canonizer",
      mode === "autocanonizer",
    );
    elements.tuningButton.disabled = mode === "autocanonizer";
    elements.tuningButton.classList.toggle(
      "is-hidden",
      mode === "autocanonizer",
    );
    elements.infoButton.classList.toggle(
      "is-hidden",
      mode === "autocanonizer",
    );
    elements.beatsLabel.classList.toggle("is-hidden", mode === "autocanonizer");
    elements.beatsPlayedEl.classList.toggle(
      "is-hidden",
      mode === "autocanonizer",
    );
    elements.beatsDivider.classList.toggle(
      "is-hidden",
      mode === "autocanonizer",
    );
    autocanonizer.setVisible(mode === "autocanonizer");
    jukebox.setVisible(mode === "jukebox");
    if (state.trackTitle || state.trackArtist) {
      const baseTitle = state.trackTitle ?? "Unknown";
      const withSuffix =
        mode === "autocanonizer" ? `${baseTitle} (autocanonized)` : baseTitle;
      const displayTitle = state.trackArtist
        ? `${withSuffix} — ${state.trackArtist}`
        : withSuffix;
      elements.playTitle.textContent = displayTitle;
      elements.vizNowPlayingEl.textContent = displayTitle;
    }
    if (state.activeTabId === "play") {
      const currentId = getCurrentTrackId();
      if (currentId) {
        updateTrackUrl(currentId, true, state.tuningParams, state.playMode);
      } else {
        navigateToTab(
          "play",
          { replace: true },
          null,
          state.tuningParams,
          state.playMode,
        );
      }
    }
    updateVizVisibility(context);
  }

  return {
    initializePlayback,
    handlePlayClick,
    handleShortUrlClick,
    handleVizSelectChange,
    handleModeSelectChange,
    handleCanonizerFinish,
    handleKeydown,
    handleKeyup,
    handleBeatSelect,
    handleEdgeSelect,
    setActiveVisualization,
    applyModeFromUrl,
    setPlayMode,
    updateVizVisibility: () => updateVizVisibility(context),
  };
}

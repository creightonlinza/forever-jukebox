import type { Edge } from "@forever-jukebox/engine/types";
import { CANONIZER_FINISH_KEY, VIZ_STORAGE_KEY } from "./constants";
import { formatErrorForDisplay } from "./errorDisplay";
import { formatDuration } from "./format";
import {
  openExtras,
  startAutocanonizerPlayback,
  startJukeboxFromBeat,
  stopPlayback,
  syncDeletedEdgeState,
  togglePlayback,
  updateTrackInfo,
  updateVizVisibility,
} from "./playback";
import {
  advancePlaylistOnAutocanonizerEnded,
  getAttachedAppContext,
} from "./runtime";
import { getCurrentTrackId, useAppStore } from "./store";
import {
  getTuningParamsFromEngine,
  serializeParams,
  writeTuningParamsToUrl,
} from "./tuning";
import { isEditableTarget, setAnalysisStatus, showToast } from "./ui";
import i18n from "./i18n";

let lastCowbellBeatsPlayed = 0;

export function resetPlaybackUiForTest(): void {
  lastCowbellBeatsPlayed = 0;
}

function formatSignedDuration(seconds: number) {
  return `${seconds >= 0 ? "+" : "-"}${formatDuration(Math.abs(seconds))}`;
}

function formatPlayVelocity(velocity: number) {
  return velocity > 0 ? `+${velocity}` : `${velocity}`;
}

function toSimilarityPercent(distance: number, maxDistance: number) {
  if (!Number.isFinite(distance) || maxDistance <= 0) {
    return 0;
  }
  const normalized = 1 - distance / maxDistance;
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

function branchDirection(edge: Edge) {
  if (edge.dest.which < edge.src.which) {
    return i18n.t("playback.backward");
  }
  if (edge.dest.which > edge.src.which) {
    return i18n.t("playback.forward");
  }
  return i18n.t("playback.sameBeat");
}

  function syncExtrasPopup(edge: Edge | null) {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { engine } = context;
    if (
      !useAppStore.getState().branchStatsEnabled ||
      useAppStore.getState().playMode !== "jukebox" ||
      !edge
    ) {
      useAppStore.setState({ branchStats: null });
      return;
    }
    const startSeconds = Math.max(0, edge.src.start);
    const endSeconds = Math.max(0, edge.dest.start);
    const startDisplaySeconds = Math.floor(startSeconds);
    const endDisplaySeconds = Math.floor(endSeconds);
    const maxDistance = Math.max(1, engine.getConfig().maxBranchThreshold);
    useAppStore.setState({
      branchStats: {
        title: i18n.t("playback.branchStatsTitle", { id: edge.id }),
        startText: formatDuration(startDisplaySeconds),
        endText: formatDuration(endDisplaySeconds),
        deltaText: formatSignedDuration(endDisplaySeconds - startDisplaySeconds),
        direction: branchDirection(edge),
        similarityText: `${toSimilarityPercent(edge.distance, maxDistance)}%`,
        deleteDisabled: edge.deleted,
      },
    });
  }


export function deleteSelectedBranch(): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { engine, jukebox } = context;
    const { selectedEdge } = useAppStore.getState();
    if (!selectedEdge || selectedEdge.deleted) {
      return;
    }
    engine.deleteEdge(selectedEdge);
    engine.rebuildGraph();
    useAppStore.setState({ vizData: engine.getVisualizationData() });
    const data = useAppStore.getState().vizData;
    if (data) {
      jukebox.setData(data);
    }
    jukebox.refresh();
    jukebox.resizeActive();
    syncDeletedEdgeState(context);
    updateTrackInfo(context);
    writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
    useAppStore.setState({ selectedEdge: null });
    jukebox.setSelectedEdge(null);
    syncExtrasPopup(null);
  }

export function initializePlayback(): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { autocanonizer, engine, jukebox, player } = context;
    setPlayMode("jukebox");
    setBringItHomeMode(useAppStore.getState().bringItHomeMode);
    syncExtrasPopup(null);

    const storedViz = localStorage.getItem(VIZ_STORAGE_KEY);
    if (storedViz) {
      const parsed = Number.parseInt(storedViz, 10);
      if (Number.isFinite(parsed)) {
        setActiveVisualization(parsed);
      }
    }
    const storedCanonizerFinish = localStorage.getItem(CANONIZER_FINISH_KEY);
    const finishOutSong = storedCanonizerFinish === "true";
    autocanonizer.setFinishOutSong(finishOutSong);

    player.setOnEnded(() => {
      if (!useAppStore.getState().isRunning) {
        return;
      }
      if (useAppStore.getState().playMode === "jukebox" && !useAppStore.getState().bringItHomeMode) {
        // Recover if audio hits buffer end before scheduled wrap executes.
        startJukeboxFromBeat(context, 0);
        if (!player.isPlaying()) {
          engine.play();
        }
        return;
      }
      stopPlayback(context);
    });

    autocanonizer.setOnBeat((index, _beat, cursorTimes) => {
      useAppStore.setState({
        beatsPlayedText: `${index + 1}`,
        lastBeatIndex: index,
        autocanonizerMainSeconds: cursorTimes.mainSeconds,
        autocanonizerOtherSeconds: cursorTimes.otherSeconds,
      });
    });
    autocanonizer.setOnEnded(() => {
      if (!useAppStore.getState().isRunning) {
        return;
      }
      advancePlaylistOnAutocanonizerEnded()
        .then((advanced) => {
          if (!advanced && useAppStore.getState().isRunning) {
            stopPlayback(context);
          }
        })
        .catch((err) => {
          console.warn(`Playlist advance failed: ${String(err)}`);
          if (useAppStore.getState().isRunning) {
            stopPlayback(context);
          }
        });
    });
    autocanonizer.setOnSelect((index) => {
      if (useAppStore.getState().playMode !== "autocanonizer") {
        return;
      }
      startAutocanonizerPlayback(context, index, { resetSession: false });
    });

    engine.onUpdate((engineState) => {
      // onUpdate fires every engine tick (~20Hz); only write when the counter
      // actually advances so we don't churn the store and wake subscribers on
      // every tick.
      const beatsPlayedText = `${engineState.beatsPlayed}`;
      if (useAppStore.getState().beatsPlayedText !== beatsPlayedText) {
        useAppStore.setState({ beatsPlayedText });
      }
      if (engineState.currentBeatIndex >= 0) {
        if (engineState.beatsPlayed !== lastCowbellBeatsPlayed) {
          lastCowbellBeatsPlayed = engineState.beatsPlayed;
          const beat = useAppStore.getState().vizData?.beats[engineState.currentBeatIndex];
          if (beat) {
            context.cowbellOverlay.handleBeatEnter(
              engineState.currentBeatIndex,
              beat,
              useAppStore.getState().vizData?.beats[engineState.currentBeatIndex + 1],
            );
          }
        }
        const lastBeatIndex = useAppStore.getState().lastBeatIndex;
        const highlightJump =
          engineState.lastJumped && engine.getLastJumpWasBranch();
        const jumpFrom =
          highlightJump && engineState.lastJumpFromIndex !== null
            ? engineState.lastJumpFromIndex
            : lastBeatIndex;
        const jumpTo =
          highlightJump && typeof engineState.lastJumpToIndex === "number"
            ? engineState.lastJumpToIndex
            : engineState.currentBeatIndex;
        jukebox.update(jumpTo, highlightJump, jumpFrom);
        if (jumpTo !== engineState.currentBeatIndex) {
          jukebox.update(engineState.currentBeatIndex, false, jumpTo);
        }
        useAppStore.setState({ lastBeatIndex: engineState.currentBeatIndex });
      }
    });
  }

  function setBringItHomeMode(enabled: boolean) {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { engine } = context;
    useAppStore.setState({ bringItHomeMode: enabled });
    engine.setBringItHomeMode(enabled);
    if (enabled && useAppStore.getState().shiftBranching) {
      useAppStore.setState({ shiftBranching: false });
      engine.setForceBranch(false);
    }
  }

export function setCanonizerFinish(checked: boolean): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { autocanonizer } = context;
    localStorage.setItem(CANONIZER_FINISH_KEY, String(checked));
    autocanonizer.setFinishOutSong(checked);
  }

  function selectAdjacentBranch(direction: -1 | 1) {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { jukebox } = context;
    if (!useAppStore.getState().selectedEdge) {
      return;
    }
    const edges = (useAppStore.getState().vizData?.edges ?? []).filter((edge) => !edge.deleted);
    if (edges.length === 0) {
      return;
    }
    const currentIndex = edges.findIndex(
      (edge) => edge.id === useAppStore.getState().selectedEdge?.id,
    );
    let nextIndex: number;
    if (currentIndex >= 0) {
      nextIndex = (currentIndex + direction + edges.length) % edges.length;
    } else {
      nextIndex = direction > 0 ? 0 : edges.length - 1;
    }
    const nextEdge = edges[nextIndex];
    useAppStore.setState({ selectedEdge: nextEdge });
    jukebox.setSelectedEdgeActive(nextEdge);
    syncExtrasPopup(nextEdge);
  }

  function toggleSelectedAnchorBranch() {
    const context = getAttachedAppContext();
    if (!context) {
      return false;
    }
    const { engine, jukebox } = context;
    const edge = useAppStore.getState().selectedEdge;
    if (!edge || edge.deleted || edge.dest.which >= edge.src.which) {
      return false;
    }
    const nextAnchor = engine.getUserAnchorEdgeId() === edge.id ? null : edge;
    engine.setUserAnchorEdge(nextAnchor);
    useAppStore.setState({ vizData: engine.getVisualizationData() });
    const data = useAppStore.getState().vizData;
    if (data) {
      jukebox.setData(data);
    }
    jukebox.setSelectedEdgeActive(edge);
    const tuningParams = getTuningParamsFromEngine(context);
    const result = serializeParams(tuningParams);
    useAppStore.setState({ tuningParams: result.length > 0 ? result : null });
    writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
    showToast(
      nextAnchor ? i18n.t("playback.anchorSet") : i18n.t("playback.anchorReset"),
    );
    return true;
  }

export function handleKeydown(event: KeyboardEvent): void {
    if (useAppStore.getState().activeTabId !== "play") {
      return;
    }
    if (useAppStore.getState().deleteConfirmOpen) {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { engine } = context;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback(context);
      return;
    }
    if (
      useAppStore.getState().playMode === "jukebox" &&
      (event.key === "e" || event.key === "E") &&
      !event.repeat
    ) {
      event.preventDefault();
      openExtras(context);
      return;
    }
    if (useAppStore.getState().playMode === "autocanonizer") {
      return;
    }
    if ((event.key === "h" || event.key === "H") && !event.repeat) {
      event.preventDefault();
      const enabled = !useAppStore.getState().bringItHomeMode;
      setBringItHomeMode(enabled);
      showToast(
        enabled
          ? i18n.t("playback.bringHomeEnabled")
          : i18n.t("playback.bringHomeDisabled"),
      );
      return;
    }
    if ((event.key === "a" || event.key === "A") && !event.repeat) {
      if (toggleSelectedAnchorBranch()) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      const direction = event.key === "]" ? 1 : -1;
      const velocity = engine.getPlayVelocity() + direction;
      engine.setPlayVelocity(velocity);
      showToast(
        `Play velocity: ${formatPlayVelocity(engine.getPlayVelocity())}`,
      );
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      engine.setPlayVelocity(0);
      showToast("Play velocity: 0");
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      engine.setPlayVelocity(1);
      showToast("Play velocity: +1");
      return;
    }
    if (event.key === "Control") {
      event.preventDefault();
      engine.setFreezeCurrentBeat(true);
      return;
    }
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      useAppStore.getState().selectedEdge
    ) {
      event.preventDefault();
      selectAdjacentBranch(event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    const { selectedEdge } = useAppStore.getState();
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedEdge &&
      !selectedEdge.deleted
    ) {
      event.preventDefault();
      deleteSelectedBranch();
      return;
    }
    if (
      event.key === "Shift" &&
      useAppStore.getState().isRunning &&
      !useAppStore.getState().shiftBranching &&
      !useAppStore.getState().bringItHomeMode
    ) {
      useAppStore.setState({ shiftBranching: true });
      engine.setForceBranch(true);
    }
  }

export function handleKeyup(event: KeyboardEvent): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { engine } = context;
    if (event.key === "Control") {
      engine.setFreezeCurrentBeat(false);
    }
    if (useAppStore.getState().playMode === "autocanonizer") {
      return;
    }
    if (event.key === "Shift" && useAppStore.getState().shiftBranching) {
      useAppStore.setState({ shiftBranching: false });
      engine.setForceBranch(false);
    }
  }

export function handleWindowBlur(): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    context.engine.setFreezeCurrentBeat(false);
    if (useAppStore.getState().shiftBranching) {
      useAppStore.setState({ shiftBranching: false });
      context.engine.setForceBranch(false);
    }
  }

export function handleBeatSelect(index: number): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { jukebox } = context;
    if (useAppStore.getState().playMode === "autocanonizer") {
      return;
    }
    const { vizData } = useAppStore.getState();
    if (!vizData) {
      return;
    }
    const beat = vizData.beats[index];
    if (!beat) {
      return;
    }
    startJukeboxFromBeat(context, index);
    jukebox.update(index, true, null);
  }

export function handleEdgeSelect(edge: Edge | null): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { jukebox } = context;
    if (useAppStore.getState().playMode === "autocanonizer") {
      return;
    }
    useAppStore.setState({ selectedEdge: edge });
    jukebox.setSelectedEdgeActive(edge);
    syncExtrasPopup(edge);
  }

export function copyShortUrl(): void {
    void copyShortUrlInternal();
  }

  async function copyShortUrlInternal() {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const trackId = useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId;
    if (!trackId) {
      setAnalysisStatus(
        context,
        i18n.t("playback.selectTrackForUrl"),
        false,
      );
      return;
    }
    const url = new URL(
      `${window.location.origin}/listen/${encodeURIComponent(trackId)}`,
    );
    if (useAppStore.getState().playMode === "jukebox") {
      const tuningParams = getTuningParamsFromEngine(context);
      tuningParams.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
    }
    if (useAppStore.getState().playMode === "autocanonizer") {
      url.searchParams.set("mode", "autocanonizer");
    }
    const shortUrl = url.toString();
    try {
      await navigator.clipboard.writeText(shortUrl);
      showToast(i18n.t("status.linkCopied"));
    } catch (err) {
      setAnalysisStatus(
        context,
        i18n.t("status.copyFailed", { error: formatErrorForDisplay(err) }),
        false,
      );
    }
  }

export function setActiveVisualization(index: number): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { jukebox } = context;
    const count = jukebox.getCount();
    if (index < 0 || index >= count) {
      return;
    }
    if (index === useAppStore.getState().activeVizIndex) {
      return;
    }
    useAppStore.setState({ activeVizIndex: index });
    jukebox.setActiveIndex(index);
    localStorage.setItem(VIZ_STORAGE_KEY, String(useAppStore.getState().activeVizIndex));
  }

  function getPlayModeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "autocanonizer" ? "autocanonizer" : "jukebox";
  }

export function applyModeFromUrl(): void {
    setPlayMode(getPlayModeFromUrl());
  }

export function setPlayMode(mode: "jukebox" | "autocanonizer"): void {
    const context = getAttachedAppContext();
    if (!context) {
      return;
    }
    const { autocanonizer, jukebox } = context;
    if (useAppStore.getState().playMode === mode) {
      return;
    }
    if (useAppStore.getState().isRunning || useAppStore.getState().isPaused) {
      stopPlayback(context);
    }
    context.cowbellOverlay.cancelScheduledHits();
    useAppStore.setState({
      playMode: mode,
      autocanonizerMainSeconds: 0,
      autocanonizerOtherSeconds: 0,
    });
    if (mode !== "jukebox") {
      // The extras tab disappears outside jukebox mode, so force the stored
      // tab back to "tuning".
      useAppStore.setState({ tuningModalTab: "tuning" });
    }
    autocanonizer.setVisible(mode === "autocanonizer");
    jukebox.setVisible(mode === "jukebox");
    syncExtrasPopup(useAppStore.getState().selectedEdge);
    if (useAppStore.getState().activeTabId === "play") {
      const currentId = getCurrentTrackId();
      if (currentId) {
        useAppStore
          .getState()
          .navigateToTrackWithState(currentId, { replace: true });
      } else {
        useAppStore.getState().navigateToTabWithState("play", {
          replace: true,
        });
      }
    }
    updateVizVisibility();
  }

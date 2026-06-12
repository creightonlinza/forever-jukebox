import type { AppContext } from "../context";
import { LISTEN_TIMER_INTERVAL_MS } from "../constants";
import { useAppStore } from "../store";
import { showToast } from "../ui";
import {
  pulseVizStats,
  updateListenTimeDisplay,
  updatePlayButton,
} from "./status-ui";
import { requestWakeLock } from "./wake-lock";

export function isPlaybackBlockedForSwing(context: AppContext) {
  const { state } = context;
  return (
    state.playMode === "jukebox" &&
    state.jukeboxAudioMode === "swing" &&
    state.swingPreparing
  );
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
  useAppStore.setState({ beatsPlayedText: "0" });
  jukebox.reset();
  state.isRunning = false;
  state.isPaused = false;
  state.shiftBranching = false;
  engine.setForceBranch(false);
  if (state.bringItHomeMode) {
    state.bringItHomeMode = false;
    engine.setBringItHomeMode(false);
  }
  stopListenTimer(context);
  updateListenTimeDisplay(context);
  updatePlayButton(context);
}

export function pausePlayback(context: AppContext) {
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

export function startJukeboxPlayback(context: AppContext, resetSession: boolean) {
  const { cowbellOverlay, engine, jukebox, player, state } = context;
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
    useAppStore.setState({ beatsPlayedText: "0" });
    state.lastBeatIndex = null;
    jukebox.reset();
    pulseVizStats();
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
  const { autocanonizer, cowbellOverlay, engine, player, state } = context;
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
    useAppStore.setState({ beatsPlayedText: "0" });
    state.lastBeatIndex = null;
    pulseVizStats();
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

// The React transport buttons derive icon/label/disabled from the store;
// only the play-tab pulse needs an explicit write here.

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

let listenTimerId: number | null = null;

export function isPlaybackBlockedForSwing() {
  const { playMode, jukeboxAudioMode, swingPreparing } =
    useAppStore.getState();
  return (
    playMode === "jukebox" && jukeboxAudioMode === "swing" && swingPreparing
  );
}

export function startListenTimer() {
  if (listenTimerId !== null) {
    return;
  }
  listenTimerId = window.setInterval(() => {
    updateListenTimeDisplay();
  }, LISTEN_TIMER_INTERVAL_MS);
}

export function stopListenTimer() {
  if (listenTimerId === null) {
    return;
  }
  window.clearInterval(listenTimerId);
  listenTimerId = null;
}

export function stopPlayback(context: AppContext) {
  const {
    autocanonizer,
    cowbellOverlay,
    engine,
    jukebox,
    player,
  } = context;
  cowbellOverlay.cancelScheduledHits();
  if (useAppStore.getState().playMode === "autocanonizer") {
    autocanonizer?.stop();
    player.stop();
    autocanonizer?.resetVisualization();
  }
  engine.stopJukebox();
  engine.resetStats();
  useAppStore.setState({ playTimerMs: 0 });
  useAppStore.setState({ lastPlayStamp: null });
  useAppStore.setState({ lastBeatIndex: null });
  useAppStore.setState({ beatsPlayedText: "0" });
  jukebox?.reset();
  useAppStore.setState({ isRunning: false });
  useAppStore.setState({ isPaused: false });
  useAppStore.setState({ shiftBranching: false });
  engine.setForceBranch(false);
  if (useAppStore.getState().bringItHomeMode) {
    useAppStore.setState({ bringItHomeMode: false });
    engine.setBringItHomeMode(false);
  }
  stopListenTimer();
  updateListenTimeDisplay();
  updatePlayButton();
}

export function pausePlayback(context: AppContext) {
  const { autocanonizer, cowbellOverlay, engine, player } = context;
  if (!useAppStore.getState().isRunning) {
    return;
  }
  cowbellOverlay.cancelScheduledHits();
  if (useAppStore.getState().playMode === "autocanonizer") {
    autocanonizer?.stop();
    player.stop();
  } else {
    engine.pauseJukebox();
    engine.syncToPlaybackPosition();
  }
  const { lastPlayStamp, playTimerMs } = useAppStore.getState();
  if (lastPlayStamp !== null) {
    useAppStore.setState({
      playTimerMs: playTimerMs + (performance.now() - lastPlayStamp),
      lastPlayStamp: null,
    });
  }
  useAppStore.setState({ isRunning: false });
  useAppStore.setState({ isPaused: true });
  useAppStore.setState({ shiftBranching: false });
  engine.setForceBranch(false);
  stopListenTimer();
  updateListenTimeDisplay();
  updatePlayButton();
}

export function startJukeboxPlayback(context: AppContext, resetSession: boolean) {
  const { cowbellOverlay, engine, jukebox, player } = context;
  if (!jukebox) {
    return;
  }
  if (isPlaybackBlockedForSwing()) {
    showToast("Preparing Swing mode...", { icon: "hourglass_top" });
    updatePlayButton();
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
    useAppStore.setState({ playTimerMs: 0 });
    useAppStore.setState({ lastPlayStamp: null });
    updateListenTimeDisplay();
    useAppStore.setState({ beatsPlayedText: "0" });
    useAppStore.setState({ lastBeatIndex: null });
    jukebox.reset();
    pulseVizStats();
  } else {
    engine.syncToPlaybackPosition();
  }
  engine.play();
  engine.startJukebox(resetSession);
  useAppStore.setState({ lastPlayStamp: performance.now() });
  useAppStore.setState({ isRunning: true });
  useAppStore.setState({ isPaused: false });
  startListenTimer();
  updatePlayButton();
  if (document.fullscreenElement) {
    requestWakeLock();
  }
}

export function togglePlayback(context: AppContext) {
  if (useAppStore.getState().isRunning) {
    pausePlayback(context);
    return;
  }
  try {
    if (useAppStore.getState().playMode === "autocanonizer") {
      const startIndex = useAppStore.getState().isPaused ? (useAppStore.getState().lastBeatIndex ?? 0) : 0;
      startAutocanonizerPlayback(context, startIndex, {
        resetSession: !useAppStore.getState().isPaused,
      });
      return;
    }
    if (useAppStore.getState().isPaused) {
      startJukeboxPlayback(context, false);
      return;
    }
    startJukeboxPlayback(context, true);
  } catch (err) {
    console.warn(`Play error: ${String(err)}`);
  }
}

export function startJukeboxFromBeat(context: AppContext, index: number) {
  const { cowbellOverlay, engine, player } = context;
  if (useAppStore.getState().playMode !== "jukebox") {
    return;
  }
  if (isPlaybackBlockedForSwing()) {
    showToast("Preparing Swing mode...", { icon: "hourglass_top" });
    updatePlayButton();
    return;
  }
  if (player.getDuration() === null) {
    console.warn("Audio not loaded");
    return;
  }
  const beat = useAppStore.getState().vizData?.beats[index];
  if (!beat) {
    return;
  }

  cowbellOverlay.cancelScheduledHits();
  player.seek(beat.start);
  engine.seekToBeat(index);
  useAppStore.setState({ lastBeatIndex: index });
  if (!useAppStore.getState().isRunning) {
    engine.play();
    engine.startJukebox(false);
    useAppStore.setState({ lastPlayStamp: performance.now() });
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({ isPaused: false });
    startListenTimer();
    updatePlayButton();
    if (document.fullscreenElement) {
      requestWakeLock();
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
  const { autocanonizer, cowbellOverlay, engine, player } = context;
  if (!autocanonizer) {
    return false;
  }
  if (!autocanonizer.isReady()) {
    console.warn("Autocanonizer not ready");
    return false;
  }
  const resetSession = options?.resetSession ?? true;
  player.stop();
  cowbellOverlay.cancelScheduledHits();
  engine.stopJukebox();
  if (resetSession) {
    useAppStore.setState({ playTimerMs: 0 });
    useAppStore.setState({ lastPlayStamp: null });
    updateListenTimeDisplay();
    useAppStore.setState({ beatsPlayedText: "0" });
    useAppStore.setState({ lastBeatIndex: null });
    pulseVizStats();
    autocanonizer.resetVisualization();
  }
  autocanonizer.startAtIndex(index);
  useAppStore.setState({ lastPlayStamp: performance.now() });
  useAppStore.setState({ isRunning: true });
  useAppStore.setState({ isPaused: false });
  startListenTimer();
  updatePlayButton();
  if (document.fullscreenElement) {
    requestWakeLock();
  }
  return true;
}

// The React transport buttons derive icon/label/disabled from the store;
// only the play-tab pulse needs an explicit write here.

import "../cast/style.css";
import {
  BufferedAudioPlayer,
  type JukeboxAudioMode,
} from "../audio/BufferedAudioPlayer";
import { CowbellOverlayService } from "../audio/CowbellOverlayService";
import { JukeboxEngine } from "../engine";
import type { JukeboxConfig } from "../engine/types";
import { JukeboxViz } from "../jukebox/JukeboxViz";
import { fetchAnalysis, fetchAudio, recordPlay } from "../app/api";
import { formatErrorForDisplay } from "../app/errorDisplay";
import { formatDuration } from "../app/format";
import {
  CAST_AUDIO_MODE_CAPABILITIES,
  applyCastTuningToEngine,
  parseCastTuningParams,
  type CastAudioModeCapability,
} from "./tuning";

type CastCustomData = {
  baseUrl?: string;
  jobId?: string;
  tuningParams?: string;
  vizIndex?: number;
};

type CastCommand = {
  type?:
    | "play"
    | "pause"
    | "stop"
    | "reset"
    | "getStatus"
    | "setTuning"
    | "setVisualization";
  tuningParams?: string | null;
  vizIndex?: number;
};

type CastStatus = {
  type: "status";
  jobId: string | null;
  createdAt: string | null;
  title: string | null;
  artist: string | null;
  trackDurationSeconds: number | null;
  totalBeats: number | null;
  totalBranches: number | null;
  isPlaying: boolean;
  isLoading: boolean;
  activeVizIndex: number;
  supportedAudioModes: readonly CastAudioModeCapability[];
  tuning: CastTuningStatus | null;
  error?: string | null;
  errorCode?: string | null;
  playbackState: "idle" | "loading" | "playing" | "paused" | "error";
};

type CastTuningStatus = {
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
  threshold: number | null;
  computedThreshold: number | null;
  branchProbability: {
    minPercent: number;
    maxPercent: number;
    deltaPercent: number;
  };
  deletedEdgeIds: number[];
  anchorBranchId: number | null;
  highlightAnchorBranch: boolean;
  audioMode: JukeboxAudioMode;
};

type CastLoadRequest = {
  customData?: CastCustomData;
  media?: {
    customData?: CastCustomData;
  };
};

type CastReceiverContextType = NonNullable<
  NonNullable<NonNullable<Window["cast"]>["framework"]>["CastReceiverContext"]
>;

declare global {
  interface Window {
    cast?: {
      framework?: {
        system?: {
          MessageType?: {
            JSON?: unknown;
          };
        };
        CastReceiverContext?: {
          getInstance(): {
            getPlayerManager(): {
              setMessageInterceptor(
                type: unknown,
                handler: (loadRequestData: CastLoadRequest) => unknown,
              ): void;
            };
            addCustomMessageListener(
              namespace: string,
              handler: (event: { data?: unknown; senderId?: string }) => void,
            ): void;
            sendCustomMessage(
              namespace: string,
              senderId: string | undefined,
              message: unknown,
            ): void;
            start(options?: {
              disableIdleTimeout?: boolean;
              maxInactivity?: number;
              customNamespaces?: Record<string, unknown>;
            }): void;
            stop?(): void;
          };
        };
        messages?: {
          MessageType?: {
            LOAD?: unknown;
          };
        };
      };
    };
  }
}

type CastElements = {
  logo: HTMLElement;
  bottomBar: HTMLElement;
  vizLayer: HTMLElement;
  vizPanel: HTMLElement;
  title: HTMLElement;
  listenTime: HTMLElement;
  beatsPlayed: HTMLElement;
  status: HTMLElement;
};

type CastState = {
  lastBeatIndex: number | null;
  vizData: ReturnType<JukeboxEngine["getVisualizationData"]> | null;
  loadToken: number;
  currentJobId: string | null;
  currentJobCreatedAt: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackDurationSeconds: number | null;
  activeVizIndex: number;
  tuningParams: string | null;
  audioMode: JukeboxAudioMode;
};

type CastTrackMeta = {
  title?: string;
  artist?: string;
  duration?: unknown;
};

function getElements(): CastElements {
  const require = <T extends HTMLElement>(el: T | null, name: string) => {
    if (!el) {
      throw new Error(`Missing element ${name}`);
    }
    return el;
  };
  return {
    logo: require(document.querySelector("#cast-logo"), "#cast-logo"),
    bottomBar: require(document.querySelector("#cast-bottom"), "#cast-bottom"),
    vizLayer: require(document.querySelector("#viz-layer"), "#viz-layer"),
    vizPanel: require(document.querySelector("#viz-panel"), "#viz-panel"),
    title: require(document.querySelector("#cast-title"), "#cast-title"),
    listenTime: require(document.querySelector(
      "#cast-listen-time",
    ), "#cast-listen-time"),
    beatsPlayed: require(document.querySelector(
      "#cast-beats-played",
    ), "#cast-beats-played"),
    status: require(document.querySelector("#cast-status"), "#cast-status"),
  };
}

function isValidJobId(value: string) {
  return /^[a-f0-9]{32}$/.test(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

const CAST_MAX_TRACK_DURATION_SECONDS = 7 * 60;
const CAST_TRACK_TOO_LONG_ERROR_CODE = "cast_track_too_long";
const CAST_TRACK_DURATION_UNKNOWN_ERROR_CODE = "cast_track_duration_unknown";
const MIN_RANDOM_BRANCH_DELTA = 0;
const MAX_RANDOM_BRANCH_DELTA = 0.2;

type CastErrorInfo = {
  message: string;
  code?: string;
};

function buildCastTrackTooLongError(): CastErrorInfo {
  return {
    message:
      "Sorry, tracks longer than 7 minutes cannot be cast due to Chromecast memory limitations.",
    code: CAST_TRACK_TOO_LONG_ERROR_CODE,
  };
}

function buildCastTrackDurationUnknownError(): CastErrorInfo {
  return {
    message:
      "Sorry, this track cannot be cast because its duration could not be verified before loading.",
    code: CAST_TRACK_DURATION_UNKNOWN_ERROR_CODE,
  };
}

function getInitialJobId(): string | null {
  let candidate: string | null = null;
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "cast" && parts[1]) {
    try {
      candidate = decodeURIComponent(parts[1]);
    } catch {
      candidate = parts[1];
    }
  }
  if (!candidate) {
    candidate = new URLSearchParams(window.location.search).get("id");
  }
  if (!candidate || !isValidJobId(candidate)) {
    return null;
  }
  return candidate;
}

function setStatus(el: HTMLElement, message: string) {
  el.textContent = message;
}

function mapValueToPercent(value: number, min: number, max: number) {
  const safeValue = clamp(value, min, max);
  return Math.round((100 * (safeValue - min)) / (max - min));
}

function setLoadingState(elements: CastElements, isLoading: boolean) {
  elements.status.classList.toggle("hidden", !isLoading);
  elements.title.classList.toggle("hidden", isLoading);
  const meta = elements.status.parentElement?.querySelector(".cast-meta");
  if (meta instanceof HTMLElement) {
    meta.classList.toggle("hidden", isLoading);
  }
}

function setLogoVisible(elements: CastElements, isVisible: boolean) {
  elements.logo.classList.toggle("hidden", !isVisible);
  elements.bottomBar.classList.toggle("hidden", isVisible);
  elements.vizPanel.classList.toggle("hidden", isVisible);
}

function setIdleState(elements: CastElements) {
  elements.status.classList.add("hidden");
  elements.title.classList.add("hidden");
  const meta = elements.status.parentElement?.querySelector(".cast-meta");
  if (meta instanceof HTMLElement) {
    meta.classList.add("hidden");
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pollAnalysis(
  jobId: string,
  statusEl: HTMLElement,
  token: number,
  state: CastState,
) {
  const intervalMs = 3000;
  while (true) {
    if (token !== state.loadToken) {
      throw new Error("Load cancelled");
    }
    const response = await fetchAnalysis(jobId);
    if (!response) {
      throw new Error("Analysis not found");
    }
    if (response.status === "failed") {
      throw Object.assign(
        new Error(
          formatErrorForDisplay(response.error, {
            sourceProvider: response.source_provider,
            errorCode: response.error_code,
            fallback: "Analysis failed.",
          }),
        ),
        { code: response.error_code },
      );
    }
    if (response.status === "complete") {
      return response;
    }
    const progress =
      typeof response.progress === "number"
        ? Math.round(response.progress)
        : null;
    const message = response.message || "Processing";
    setStatus(
      statusEl,
      progress === null ? message : `${message} (${progress}%)`,
    );
    await sleep(intervalMs);
  }
}

async function loadAnalysis(
  jobId: string,
  statusEl: HTMLElement,
  token: number,
  state: CastState,
): Promise<Awaited<ReturnType<typeof fetchAnalysis>>> {
  setStatus(statusEl, "Loading analysis");
  const analysis = await pollAnalysis(jobId, statusEl, token, state);
  if (!analysis || analysis.status !== "complete" || !analysis.id) {
    throw new Error("Analysis lookup failed");
  }
  return analysis;
}

async function loadAudio(
  jobId: string,
  statusEl: HTMLElement,
  player: BufferedAudioPlayer,
  token: number,
  state: CastState,
) {
  if (token !== state.loadToken) {
    throw new Error("Load cancelled");
  }
  setStatus(statusEl, "Loading audio");
  const buffer = await fetchAudio(jobId);
  if (token !== state.loadToken) {
    throw new Error("Load cancelled");
  }
  await player.decode(buffer);
}

async function bootstrap() {
  const elements = getElements();
  const POST_LOAD_PLAY_DELAY_MS = 2000;
  const IDLE_TIMEOUT_SECONDS = 600;
  const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_SECONDS * 1000;
  const IDLE_KEEPALIVE_MS = 25_000;
  let player: BufferedAudioPlayer | null = null;
  let cowbellOverlay: CowbellOverlayService | null = null;
  let engine: JukeboxEngine | null = null;
  let defaultConfig: JukeboxConfig | null = null;
  let castContext: ReturnType<CastReceiverContextType["getInstance"]> | null =
    null;
  let idleStopTimer: number | null = null;
  let idleKeepaliveTimer: number | null = null;
  // Clamp DPR to reduce fill-rate on Chromecast hardware.
  Object.defineProperty(window, "devicePixelRatio", {
    value: 1.5,
    configurable: true,
  });
  let viz: JukeboxViz | null = null;
  const castNamespace = "urn:x-cast:com.foreverjukebox.app";
  const MAX_VIZ_INDEX = 5;
  let anchorHighlightEnabled = false;
  const destroyViz = () => {
    if (viz) {
      viz.destroy();
      viz = null;
    }
  };

  const createViz = (activeVizIndex: number) => {
    destroyViz();
    viz = new JukeboxViz(elements.vizLayer, {
      enableInteraction: false,
    });
    viz.setActiveIndex(activeVizIndex);
    viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
    viz.setVisible(false);
  };

  setIdleState(elements);
  setLogoVisible(elements, true);
  scheduleIdleStop();

  const state: CastState = {
    lastBeatIndex: null,
    vizData: null,
    loadToken: 0,
    currentJobId: null,
    currentJobCreatedAt: null,
    trackTitle: null,
    trackArtist: null,
    trackDurationSeconds: null,
    activeVizIndex: 0,
    tuningParams: null,
    audioMode: "off",
  };
  let isTrackPaused = false;

  function getDisplayTitle() {
    if (!state.trackTitle) {
      return "The Forever Jukebox";
    }
    return state.audioMode === "off"
      ? state.trackTitle
      : `${state.trackTitle} (${state.audioMode})`;
  }

  function updateDisplayedTitle() {
    const title = getDisplayTitle();
    const artist = state.trackArtist || "";
    elements.title.textContent = artist ? `${title} — ${artist}` : title;
  }

  function setAudioMode(mode: JukeboxAudioMode) {
    state.audioMode = mode;
    if (mode === "cowbell") {
      cowbellOverlay?.enable();
    } else {
      cowbellOverlay?.disable();
    }
    player?.setJukeboxAudioMode(mode);
    updateDisplayedTitle();
  }

  function applyVisualizationIndex(nextIndex: number) {
    const normalized = clamp(Math.trunc(nextIndex), 0, MAX_VIZ_INDEX);
    state.activeVizIndex = normalized;
    if (viz) {
      viz.setActiveIndex(normalized);
    }
  }

  function getTuningStatus(
    threshold: number | null,
    graphState: ReturnType<JukeboxEngine["getGraphState"]>,
  ): CastTuningStatus | null {
    if (!engine || !state.currentJobId) {
      return null;
    }
    const config = engine.getConfig();
    const computedThreshold =
      typeof graphState?.computedThreshold === "number" &&
      Number.isFinite(graphState.computedThreshold)
        ? Math.trunc(graphState.computedThreshold)
        : null;
    const deletedEdgeIds =
      graphState?.allEdges
        .filter((edge) => edge.deleted)
        .map((edge) => edge.id) ?? [];
    return {
      justBackwards: config.justBackwards,
      justLongBranches: config.justLongBranches,
      removeSequentialBranches: config.removeSequentialBranches,
      threshold,
      computedThreshold,
      branchProbability: {
        minPercent: mapValueToPercent(config.minRandomBranchChance, 0, 1),
        maxPercent: mapValueToPercent(config.maxRandomBranchChance, 0, 1),
        deltaPercent: mapValueToPercent(
          config.randomBranchChanceDelta,
          MIN_RANDOM_BRANCH_DELTA,
          MAX_RANDOM_BRANCH_DELTA,
        ),
      },
      deletedEdgeIds,
      anchorBranchId: engine.getUserAnchorEdgeId(),
      highlightAnchorBranch: anchorHighlightEnabled,
      audioMode: state.audioMode,
    };
  }

  function sendStatusUpdate(error?: string | null, errorCode?: string | null) {
    if (!castContext) {
      return;
    }
    const isLoading =
      state.loadToken > 0 && !!state.currentJobId && !state.vizData;
    const hasTrack = !!state.currentJobId;
    const isPlaying = isLoading ? false : player?.isPlaying() ?? false;
    const graphState = isLoading ? null : engine?.getGraphState?.() ?? null;
    const trackDurationSeconds = (() => {
      if (isLoading) {
        return null;
      }
      if (
        typeof state.trackDurationSeconds === "number" &&
        Number.isFinite(state.trackDurationSeconds) &&
        state.trackDurationSeconds > 0
      ) {
        return state.trackDurationSeconds;
      }
      const decodedDuration = player?.getDuration();
      if (
        typeof decodedDuration === "number" &&
        Number.isFinite(decodedDuration) &&
        decodedDuration > 0
      ) {
        return decodedDuration;
      }
      return null;
    })();
    const totalBeats = isLoading
      ? null
      : state.vizData?.beats?.length ?? graphState?.totalBeats ?? null;
    const totalBranches =
      isLoading
        ? null
        : state.vizData?.edges?.length ?? graphState?.allEdges?.length ?? null;
    const threshold = (() => {
      if (isLoading || !engine) {
        return null;
      }
      const configThreshold = engine.getConfig().currentThreshold;
      if (Number.isFinite(configThreshold) && configThreshold > 0) {
        return Math.trunc(configThreshold);
      }
      const graphThreshold = graphState?.currentThreshold;
      if (
        typeof graphThreshold === "number" &&
        Number.isFinite(graphThreshold) &&
        graphThreshold > 0
      ) {
        return Math.trunc(graphThreshold);
      }
      return null;
    })();
    const playbackState = error
      ? "error"
      : !hasTrack
        ? "idle"
        : isLoading
          ? "loading"
          : isPlaying
            ? "playing"
            : "paused";
    const tuning =
      playbackState === "loading" || playbackState === "error"
        ? null
        : getTuningStatus(threshold, graphState);
    const status: CastStatus = {
      type: "status",
      jobId: state.currentJobId,
      createdAt: state.currentJobCreatedAt,
      title: state.trackTitle,
      artist: state.trackArtist,
      trackDurationSeconds,
      totalBeats,
      totalBranches,
      isPlaying,
      isLoading,
      activeVizIndex: state.activeVizIndex,
      supportedAudioModes: CAST_AUDIO_MODE_CAPABILITIES,
      tuning,
      error: error ?? null,
      errorCode: errorCode ?? null,
      playbackState,
    };
    // Broadcast status to active senders.
    castContext.sendCustomMessage(
      castNamespace,
      undefined,
      status,
    );
  }

  function clearIdleStopTimer() {
    if (idleStopTimer !== null) {
      window.clearTimeout(idleStopTimer);
      idleStopTimer = null;
    }
  }

  function scheduleIdleStop() {
    clearIdleStopTimer();
    idleStopTimer = window.setTimeout(() => {
      if (state.currentJobId || (player && player.isPlaying())) {
        return;
      }
      castContext?.stop?.();
    }, IDLE_TIMEOUT_MS);
  }

  function stopIdleKeepAlive() {
    if (idleKeepaliveTimer !== null) {
      window.clearInterval(idleKeepaliveTimer);
      idleKeepaliveTimer = null;
    }
  }

  function startIdleKeepAlive() {
    stopIdleKeepAlive();
    // Chromecast can reboot on long idle unless we keep the JS event loop active.
    idleKeepaliveTimer = window.setInterval(() => {
      void 0;
    }, IDLE_KEEPALIVE_MS);
  }

  const attachEngineListeners = (nextEngine: JukeboxEngine) => {
    nextEngine.onUpdate((engineState) => {
      if (!viz) {
        return;
      }
      elements.beatsPlayed.textContent = `${engineState.beatsPlayed}`;
      if (engineState.currentBeatIndex < 0) {
        return;
      }
      const beatChanged = engineState.currentBeatIndex !== state.lastBeatIndex;
      // Only repaint the viz on beat changes/jumps to keep Cast lightweight.
      if (!beatChanged && !engineState.lastJumped) {
        return;
      }
      if (beatChanged && state.audioMode === "cowbell") {
        const beat = state.vizData?.beats[engineState.currentBeatIndex];
        if (beat) {
          cowbellOverlay?.handleBeatEnter(
            engineState.currentBeatIndex,
            beat,
            state.vizData?.beats[engineState.currentBeatIndex + 1],
          );
        }
      }
      const jumpFrom =
        engineState.lastJumped && engineState.lastJumpFromIndex !== null
          ? engineState.lastJumpFromIndex
          : state.lastBeatIndex;
      viz.update(
        engineState.currentBeatIndex,
        engineState.lastJumped,
        jumpFrom,
      );
      state.lastBeatIndex = engineState.currentBeatIndex;
    });
  };

  const disposeCowbellOverlaySafely = () => {
    if (!cowbellOverlay) {
      return;
    }
    try {
      cowbellOverlay.dispose();
    } catch (err) {
      console.warn("Failed to dispose cast cowbell overlay cleanly", err);
    }
    cowbellOverlay = null;
  };

  const disposePlayerSafely = async (options?: { stop?: boolean }) => {
    const currentPlayer = player;
    disposeCowbellOverlaySafely();
    // Clear shared reference first so concurrent teardown paths cannot double-dispose.
    player = null;
    if (!currentPlayer) {
      return;
    }
    if (options?.stop) {
      try {
        currentPlayer.stop();
      } catch (err) {
        console.warn("Failed to stop cast player cleanly", err);
      }
    }
    try {
      await currentPlayer.dispose();
    } catch (err) {
      console.warn("Failed to dispose cast player cleanly", err);
    }
  };

  const resetEngine = async () => {
    if (engine) {
      engine.stopJukebox();
      engine.resetStats();
    }
    await disposePlayerSafely();
    destroyViz();
    player = new BufferedAudioPlayer();
    cowbellOverlay = new CowbellOverlayService(player.getContext(), {
      getPlaybackRate: () => player?.getPlaybackRate() ?? 1,
    });
    player.setOnEnded(() => {
      if (engine) {
        engine.stopJukebox();
      }
      cowbellOverlay?.cancelScheduledHits();
      isTrackPaused = false;
      playStartAtMs = null;
      setIdleState(elements);
      setLogoVisible(elements, true);
      startIdleKeepAlive();
      scheduleIdleStop();
    });
    engine = new JukeboxEngine(player, { randomMode: "random" });
    defaultConfig = engine.getConfig();
    attachEngineListeners(engine);
  };

  let playStartAtMs: number | null = null;
  let listenAccumulatedMs = 0;
  window.setInterval(() => {
    const runningElapsed =
      playStartAtMs === null ? 0 : Math.max(0, performance.now() - playStartAtMs);
    const elapsed = listenAccumulatedMs + runningElapsed;
    elements.listenTime.textContent = formatDuration(elapsed / 1000);
  }, 500);

  function setReceiverIdle() {
    setIdleState(elements);
    setLogoVisible(elements, true);
    if (viz) {
      viz.setVisible(false);
    }
    startIdleKeepAlive();
    scheduleIdleStop();
  }

  async function resetReceiverToSplash() {
    // Invalidate any active load/poll operations so stale async work bails out.
    state.loadToken += 1;
    if (engine) {
      engine.stopJukebox();
      engine.resetStats();
    }
    await disposePlayerSafely({ stop: true });
    destroyViz();
    engine = null;
    defaultConfig = null;
    anchorHighlightEnabled = false;
    state.lastBeatIndex = null;
    state.vizData = null;
    state.currentJobId = null;
    state.currentJobCreatedAt = null;
    state.trackTitle = null;
    state.trackArtist = null;
    state.trackDurationSeconds = null;
    state.tuningParams = null;
    state.audioMode = "off";
    isTrackPaused = false;
    playStartAtMs = null;
    listenAccumulatedMs = 0;
    elements.listenTime.textContent = "00:00:00";
    elements.beatsPlayed.textContent = "0";
    elements.title.textContent = "The Forever Jukebox";
    setReceiverIdle();
    sendStatusUpdate();
  }

  function syncVizFromEngine() {
    if (!engine) {
      state.vizData = null;
      if (viz) {
        viz.reset();
      }
      return;
    }
    state.vizData = engine.getVisualizationData();
    if (!state.vizData) {
      if (viz) {
        viz.reset();
      }
      return;
    }
    if (!viz) {
      createViz(state.activeVizIndex);
    }
    if (viz) {
      viz.setActiveIndex(state.activeVizIndex);
      viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
      viz.setData(state.vizData);
    }
  }

  function beginTrackLoad(jobId: string) {
    setLogoVisible(elements, false);
    cowbellOverlay?.disable();
    if (viz) {
      viz.setVisible(false);
      viz.reset();
    }
    state.currentJobId = jobId;
    state.currentJobCreatedAt = null;
    state.loadToken += 1;
    const token = state.loadToken;
    state.trackTitle = null;
    state.trackArtist = null;
    state.trackDurationSeconds = null;
    state.tuningParams = null;
    state.audioMode = "off";
    state.lastBeatIndex = null;
    state.vizData = null;
    isTrackPaused = false;
    listenAccumulatedMs = 0;
    setLoadingState(elements, true);
    setStatus(elements.status, "Loading…");
    elements.listenTime.textContent = "00:00:00";
    elements.beatsPlayed.textContent = "0";
    elements.title.textContent = "The Forever Jukebox";
    sendStatusUpdate();
    return token;
  }

  function applyTrackMetadata(trackMeta: CastTrackMeta, durationSeconds: number) {
    const title = trackMeta.title || "Unknown";
    const artist = trackMeta.artist || "";
    state.trackTitle = title;
    state.trackArtist = artist || null;
    state.trackDurationSeconds = durationSeconds;
    updateDisplayedTitle();
  }

  async function finalizeTrackStart(jobId: string, token: number) {
    if (!engine) {
      throw new Error("Audio engine not ready");
    }
    setLoadingState(elements, false);
    if (viz) {
      viz.setVisible(true);
    }
    // Report "ready" as a paused-like non-loading status before autoplay so sender UIs update metadata immediately.
    sendStatusUpdate();
    await sleep(POST_LOAD_PLAY_DELAY_MS);
    if (token !== state.loadToken) {
      return;
    }
    void recordPlay(jobId).catch((err) => {
      console.warn(`Failed to record cast play: ${String(err)}`);
    });
    engine.play();
    engine.startJukebox();
    isTrackPaused = false;
    listenAccumulatedMs = 0;
    playStartAtMs = performance.now();
    clearIdleStopTimer();
    sendStatusUpdate();
  }

  async function resetTrackAfterLoadError(errorMessage: string, errorCode: string | null) {
    state.currentJobId = null;
    state.currentJobCreatedAt = null;
    state.lastBeatIndex = null;
    state.vizData = null;
    state.trackTitle = null;
    state.trackArtist = null;
    state.trackDurationSeconds = null;
    state.tuningParams = null;
    if (viz) {
      viz.reset();
      viz.setVisible(false);
    }
    if (engine) {
      engine.stopJukebox();
      engine.resetStats();
    }
    await disposePlayerSafely();
    engine = null;
    playStartAtMs = null;
    listenAccumulatedMs = 0;
    setReceiverIdle();
    sendStatusUpdate(errorMessage, errorCode);
  }

  async function startTrack(
    jobId: string,
    tuningParams: string | null = null,
    vizIndex: number | null = null,
  ) {
    if (vizIndex !== null) {
      applyVisualizationIndex(vizIndex);
    }
    clearIdleStopTimer();
    stopIdleKeepAlive();
    if (!jobId) {
      setReceiverIdle();
      return;
    }
    if (jobId === state.currentJobId) {
      let tuningApplied = true;
      if (tuningParams !== null) {
        tuningApplied = applyTuningUpdate(tuningParams);
      }
      if (!tuningApplied) {
        return;
      }
      if (vizIndex !== null) {
        applyVisualizationIndex(vizIndex);
      }
      setLoadingState(elements, false);
      if (viz) {
        viz.setVisible(true);
      }
      sendStatusUpdate();
      return;
    }
    const token = beginTrackLoad(jobId);
    await resetEngine();
    if (token !== state.loadToken) {
      return;
    }
    playStartAtMs = null;

    try {
      const analysis = await loadAnalysis(jobId, elements.status, token, state);
      if (token !== state.loadToken) {
        return;
      }
      if (!analysis || analysis.status !== "complete") {
        throw new Error("Analysis unavailable");
      }
      state.currentJobId = analysis.id;
      state.currentJobCreatedAt =
        typeof analysis.created_at === "string" ? analysis.created_at : null;
      if (!player || !engine) {
        throw new Error("Audio engine not ready");
      }
      const parsedTuning = defaultConfig
        ? parseCastTuningParams(tuningParams, defaultConfig)
        : null;
      anchorHighlightEnabled = parsedTuning?.highlightAnchorBranch ?? false;
      const trackMeta = analysis.result?.track || analysis.track;
      const durationSeconds = parseDurationSeconds(trackMeta?.duration);
      if (durationSeconds === null) {
        const unknownDurationError = buildCastTrackDurationUnknownError();
        throw Object.assign(new Error(unknownDurationError.message), {
          code: unknownDurationError.code,
        });
      }
      if (
        durationSeconds > CAST_MAX_TRACK_DURATION_SECONDS
      ) {
        const longTrackError = buildCastTrackTooLongError();
        throw Object.assign(new Error(longTrackError.message), {
          code: longTrackError.code,
        });
      }
      await loadAudio(jobId, elements.status, player, token, state);
      if (token !== state.loadToken) {
        return;
      }
      engine.loadAnalysis(analysis.result);
      cowbellOverlay?.setSectionStartBeatIndices(
        engine.getSectionStartBeatIndices(),
      );
      if (defaultConfig) {
        applyTuningToEngine(tuningParams, {
          resetAudioModeWhenMissing: true,
          storeTuningParams: true,
        });
      }
      syncVizFromEngine();
      if (trackMeta) {
        applyTrackMetadata(trackMeta, durationSeconds);
      }
      await finalizeTrackStart(jobId, token);
    } catch (err) {
      if (token !== state.loadToken) {
        return;
      }
      const errorMessage = formatErrorForDisplay(err, {
        fallback: "Load failed.",
      });
      const errorCode =
        err &&
        typeof err === "object" &&
        "code" in err &&
        typeof (err as { code?: unknown }).code === "string"
          ? (err as { code: string }).code
          : null;
      await resetTrackAfterLoadError(errorMessage, errorCode);
    }
  }

  function applyTuningToEngine(
    tuningParams: string | null,
    options: {
      resetAudioModeWhenMissing?: boolean;
      storeTuningParams?: boolean;
    } = {},
  ) {
    if (!engine || !defaultConfig || !state.currentJobId) {
      return { parsed: null, highlightOnly: false };
    }
    const result = applyCastTuningToEngine(engine, defaultConfig, tuningParams);
    if (result.parsed?.audioMode) {
      setAudioMode(result.parsed.audioMode);
    } else if (
      !result.parsed?.hasAudioModeParam &&
      (tuningParams === null ||
        options.resetAudioModeWhenMissing ||
        !!result.parsed)
    ) {
      setAudioMode("off");
    }
    anchorHighlightEnabled = result.highlightAnchorBranch;
    if (options.storeTuningParams) {
      state.tuningParams = tuningParams;
    }
    return { parsed: result.parsed, highlightOnly: result.highlightOnly };
  }

  function buildLiveGraphTuningParams(tuningParams: string) {
    const params = new URLSearchParams(tuningParams);
    if (!params.has("d")) {
      const deletedEdgeIds =
        engine
          ?.getGraphState()
          ?.allEdges.filter((edge) => edge.deleted)
          .map((edge) => edge.id) ?? [];
      if (deletedEdgeIds.length > 0) {
        params.set("d", deletedEdgeIds.join(","));
      }
    }
    if (!params.has("ab")) {
      const anchorBranchId = engine?.getUserAnchorEdgeId?.() ?? null;
      if (anchorBranchId !== null) {
        params.set("ab", `${anchorBranchId}`);
      }
    }
    if (!params.has("ah")) {
      params.set("ah", anchorHighlightEnabled ? "1" : "0");
    }
    if (!params.has("am") && state.audioMode !== "off") {
      params.set("am", state.audioMode);
    }
    return params.toString();
  }

  function applyTuningUpdate(tuningParams: string | null): boolean {
    if (!engine || !defaultConfig || !state.currentJobId) {
      return false;
    }
    try {
      const parsed = parseCastTuningParams(tuningParams, defaultConfig);
      if (parsed && !parsed.hasGraphTuning) {
        if (parsed.audioMode) {
          setAudioMode(parsed.audioMode);
          if (engine.isRunning() && player?.isPlaying()) {
            engine.syncToPlaybackPosition();
          }
        }
        if (new URLSearchParams(tuningParams ?? "").has("ah")) {
          anchorHighlightEnabled = parsed.highlightAnchorBranch;
        }
        state.tuningParams = tuningParams;
        if (viz) {
          viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
          viz.setVisible(true);
        }
        return true;
      }
      if (parsed && tuningParams !== null) {
        const liveTuningParams = buildLiveGraphTuningParams(tuningParams);
        const result = applyCastTuningToEngine(
          engine,
          engine.getConfig(),
          liveTuningParams,
        );
        if (result.parsed?.audioMode) {
          setAudioMode(result.parsed.audioMode);
        }
        anchorHighlightEnabled = result.highlightAnchorBranch;
        state.tuningParams = liveTuningParams;
        if (engine.isRunning() && player?.isPlaying()) {
          engine.syncToPlaybackPosition();
        }
        syncVizFromEngine();
        if (viz) {
          viz.setVisible(true);
        }
        return true;
      }
      const result = applyTuningToEngine(tuningParams, {
        storeTuningParams: true,
      });
      if (result.highlightOnly) {
        if (viz) {
          viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
          viz.setVisible(true);
        }
        return true;
      }
      if (engine.isRunning() && player?.isPlaying()) {
        engine.syncToPlaybackPosition();
      }
      syncVizFromEngine();
      if (viz) {
        viz.setVisible(true);
      }
      return true;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to apply tuning";
      console.error("Failed to apply cast tuning", err);
      sendStatusUpdate(errorMessage);
      return false;
    }
  }

  function handleCastCommand(command: CastCommand) {
    if (command.type === "reset") {
      void resetReceiverToSplash().catch((err) => {
        console.error("Failed to reset cast receiver", err);
      });
      return;
    }
    if (!engine || !player) {
      return;
    }
    if (command.type === "setTuning") {
      if (applyTuningUpdate(command.tuningParams ?? null)) {
        sendStatusUpdate();
      }
      return;
    }
    if (command.type === "setVisualization") {
      if (typeof command.vizIndex === "number" && Number.isFinite(command.vizIndex)) {
        applyVisualizationIndex(command.vizIndex);
        sendStatusUpdate();
      }
      return;
    }
    if (command.type === "play") {
      if (!state.vizData) {
        return;
      }
      stopIdleKeepAlive();
      setLogoVisible(elements, false);
      setLoadingState(elements, false);
      if (viz) {
        viz.setVisible(true);
        viz.reset();
      }
      if (!engine.isRunning()) {
        if (isTrackPaused) {
          engine.syncToPlaybackPosition();
        }
        engine.play();
        engine.startJukebox(!isTrackPaused);
      }
      if (!player.isPlaying()) {
        engine.play();
      }
      if (playStartAtMs === null) {
        playStartAtMs = performance.now();
      }
      isTrackPaused = false;
      clearIdleStopTimer();
      sendStatusUpdate();
      return;
    }
    if (command.type === "pause") {
      if (!state.vizData) {
        return;
      }
      engine.pauseJukebox();
      cowbellOverlay?.cancelScheduledHits();
      if (playStartAtMs !== null) {
        listenAccumulatedMs += Math.max(0, performance.now() - playStartAtMs);
        playStartAtMs = null;
      }
      isTrackPaused = true;
      sendStatusUpdate();
      return;
    }
    if (command.type === "stop") {
      engine.stopJukebox();
      player.stop();
      cowbellOverlay?.cancelScheduledHits();
      isTrackPaused = false;
      playStartAtMs = null;
      listenAccumulatedMs = 0;
      elements.listenTime.textContent = "00:00:00";
      elements.beatsPlayed.textContent = "0";
      if (viz) {
        viz.reset();
        viz.setVisible(true);
      }
      setLoadingState(elements, false);
      setLogoVisible(elements, false);
      startIdleKeepAlive();
      scheduleIdleStop();
      sendStatusUpdate();
      return;
    }
    if (command.type === "getStatus" && castContext) {
      sendStatusUpdate();
    }
  }

  function initCastReceiver(): boolean {
    const framework = window.cast && window.cast.framework;
    const ctx = framework && framework.CastReceiverContext;
    const messages = framework && framework.messages;
    if (!framework || !ctx || !messages?.MessageType) {
      return false;
    }
    const context = ctx.getInstance();
    castContext = context;
    const playerManager = context.getPlayerManager();
    playerManager.setMessageInterceptor(
      messages.MessageType.LOAD,
      (loadRequestData: CastLoadRequest) => {
        const customData =
          loadRequestData.customData ?? loadRequestData.media?.customData ?? {};
        const baseUrl =
          typeof customData.baseUrl === "string" ? customData.baseUrl : null;
        const jobId =
          typeof customData.jobId === "string" ? customData.jobId : null;
        const tuningParams =
          typeof customData.tuningParams === "string"
            ? customData.tuningParams
            : null;
        const vizIndex =
          typeof customData.vizIndex === "number" &&
          Number.isFinite(customData.vizIndex)
            ? customData.vizIndex
            : null;
        if (jobId && isValidJobId(jobId)) {
          const nextUrl = baseUrl
            ? `${baseUrl.replace(/\/+$/, "")}/cast/${encodeURIComponent(jobId)}`
            : null;
          if (nextUrl) {
            window.history.replaceState({}, "", nextUrl);
          }
          void startTrack(jobId, tuningParams, vizIndex);
        }
        return loadRequestData;
      },
    );
    context.addCustomMessageListener(castNamespace, (event) => {
      const payload = event?.data;
      if (!payload) {
        return;
      }
      try {
        const command =
          typeof payload === "string"
            ? (JSON.parse(payload) as CastCommand)
            : (payload as CastCommand);
        handleCastCommand(command);
      } catch {
        return;
      }
    });
    const startOptions: {
      disableIdleTimeout: boolean;
      maxInactivity: number;
      customNamespaces?: Record<string, unknown>;
    } = {
      disableIdleTimeout: true,
      maxInactivity: IDLE_TIMEOUT_SECONDS,
    };
    const messageTypeJson = framework.system?.MessageType?.JSON;
    if (messageTypeJson) {
      startOptions.customNamespaces = {
        [castNamespace]: messageTypeJson,
      };
    }
    context.start(startOptions);
    return true;
  }

  const maxAttempts = 40;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (initCastReceiver() || attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, 250);
  const initialJobId = getInitialJobId();
  if (initialJobId) {
    void startTrack(initialJobId, null);
  } else {
    setIdleState(elements);
    startIdleKeepAlive();
    scheduleIdleStop();
  }
}

bootstrap();

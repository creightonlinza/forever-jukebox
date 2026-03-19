import "../cast/style.css";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import { JukeboxEngine } from "../engine";
import type { JukeboxConfig } from "../engine/types";
import { JukeboxViz } from "../jukebox/JukeboxViz";
import { fetchAnalysis, fetchAudio, fetchJobByYoutube, recordPlay } from "../app/api";
import { formatDuration } from "../app/format";
import { applyCastTuningToEngine, parseCastTuningParams } from "./tuning";

type CastCustomData = {
  baseUrl?: string;
  songId?: string;
  tuningParams?: string;
  vizIndex?: number;
};

type CastCommand = {
  type?:
    | "play"
    | "pause"
    | "stop"
    | "getStatus"
    | "setTuning"
    | "setVisualization";
  tuningParams?: string | null;
  vizIndex?: number;
};

type CastStatus = {
  type: "status";
  songId: string | null;
  title: string | null;
  artist: string | null;
  trackDurationSeconds: number | null;
  totalBeats: number | null;
  totalBranches: number | null;
  isPlaying: boolean;
  isLoading: boolean;
  activeVizIndex: number;
  resolvedThreshold: number | null;
  error?: string | null;
  errorCode?: string | null;
  playbackState: "idle" | "loading" | "playing" | "paused" | "error";
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
  currentTrackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackDurationSeconds: number | null;
  activeVizIndex: number;
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

function isLikelyYoutubeId(value: string) {
  return /^[a-zA-Z0-9_-]{11}$/.test(value);
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

function getTrackId(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "cast" && parts[1]) {
    return parts[1];
  }
  const param = new URLSearchParams(window.location.search).get("id");
  return param || null;
}

function setStatus(el: HTMLElement, message: string) {
  el.textContent = message;
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
      throw new Error(response.error || "Analysis failed");
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function loadAnalysis(
  trackId: string,
  statusEl: HTMLElement,
  token: number,
  state: CastState,
): Promise<{
  analysis: Awaited<ReturnType<typeof fetchAnalysis>>;
  jobId: string;
}> {
  if (isLikelyYoutubeId(trackId)) {
    setStatus(statusEl, "Loading analysis");
    const response = await fetchJobByYoutube(trackId);
    if (!response || !response.id) {
      throw new Error("Analysis lookup failed");
    }
    if (response.status === "failed") {
      throw new Error(response.error || "Analysis failed");
    }
    if (response.status === "complete") {
      return { analysis: response, jobId: response.id };
    }
    const analysis = await pollAnalysis(response.id, statusEl, token, state);
    return { analysis, jobId: response.id };
  }
  setStatus(statusEl, "Loading analysis");
  const analysis = await pollAnalysis(trackId, statusEl, token, state);
  if (!analysis || analysis.status !== "complete" || !analysis.id) {
    throw new Error("Analysis lookup failed");
  }
  return { analysis, jobId: analysis.id };
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
  const IDLE_TIMEOUT_MS = 300_000;
  const IDLE_KEEPALIVE_MS = 25_000;
  let player: BufferedAudioPlayer | null = null;
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
    currentTrackId: null,
    trackTitle: null,
    trackArtist: null,
    trackDurationSeconds: null,
    activeVizIndex: 0,
  };
  let isTrackPaused = false;
  function applyVisualizationIndex(nextIndex: number) {
    const normalized = clamp(Math.trunc(nextIndex), 0, MAX_VIZ_INDEX);
    state.activeVizIndex = normalized;
    if (viz) {
      viz.setActiveIndex(normalized);
    }
  }

  function sendStatusUpdate(error?: string | null, errorCode?: string | null) {
    if (!castContext) {
      return;
    }
    const isLoading =
      state.loadToken > 0 && !!state.currentTrackId && !state.vizData;
    const hasTrack = !!state.currentTrackId;
    const isPlaying = player?.isPlaying() ?? false;
    const graphState = engine?.getGraphState?.() ?? null;
    const trackDurationSeconds = (() => {
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
    const totalBeats = state.vizData?.beats?.length ?? graphState?.totalBeats ?? null;
    const totalBranches =
      state.vizData?.edges?.length ?? graphState?.allEdges?.length ?? null;
    const resolvedThreshold = (() => {
      if (!engine) {
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
    const status: CastStatus = {
      type: "status",
      songId: state.currentTrackId,
      title: state.trackTitle,
      artist: state.trackArtist,
      trackDurationSeconds,
      totalBeats,
      totalBranches,
      isPlaying,
      isLoading,
      activeVizIndex: state.activeVizIndex,
      resolvedThreshold,
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
      if (player && player.isPlaying()) {
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

  const resetEngine = async () => {
    if (engine) {
      engine.stopJukebox();
      engine.resetStats();
    }
    if (player) {
      await player.dispose();
    }
    destroyViz();
    player = new BufferedAudioPlayer();
    player.setOnEnded(() => {
      if (engine) {
        engine.stopJukebox();
      }
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

  async function startTrack(
    trackId: string,
    tuningParams: string | null = null,
    vizIndex: number | null = null,
  ) {
    if (vizIndex !== null) {
      applyVisualizationIndex(vizIndex);
    }
    clearIdleStopTimer();
    stopIdleKeepAlive();
    if (!trackId) {
      setIdleState(elements);
      setLogoVisible(elements, true);
      if (viz) {
        viz.setVisible(false);
      }
      startIdleKeepAlive();
      scheduleIdleStop();
      return;
    }
    if (trackId === state.currentTrackId) {
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
    setLogoVisible(elements, false);
    if (viz) {
      viz.setVisible(false);
    }
    state.currentTrackId = trackId;
    state.loadToken += 1;
    const token = state.loadToken;
    sendStatusUpdate();
    setLoadingState(elements, true);
    setStatus(elements.status, "Loading…");
    elements.listenTime.textContent = "00:00:00";
    elements.beatsPlayed.textContent = "0";
    elements.title.textContent = "The Forever Jukebox";
    state.trackTitle = null;
    state.trackArtist = null;
    state.trackDurationSeconds = null;
    state.lastBeatIndex = null;
    state.vizData = null;
    isTrackPaused = false;
    listenAccumulatedMs = 0;
    if (viz) {
      viz.reset();
      viz.setVisible(false);
    }
    await resetEngine();
    if (token !== state.loadToken) {
      return;
    }
    playStartAtMs = null;

    try {
      const { analysis, jobId } = await loadAnalysis(
        trackId,
        elements.status,
        token,
        state,
      );
      if (token !== state.loadToken) {
        return;
      }
      if (!analysis || analysis.status !== "complete") {
        throw new Error("Analysis unavailable");
      }
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
      if (defaultConfig) {
        applyTuningToEngine(tuningParams);
      }
      state.vizData = engine.getVisualizationData();
      if (state.vizData) {
        if (!viz) {
          createViz(state.activeVizIndex);
        }
        if (viz) {
          viz.setActiveIndex(state.activeVizIndex);
          viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
          viz.setData(state.vizData);
        }
      }
      if (trackMeta) {
        const title = trackMeta.title || "Unknown";
        const artist = trackMeta.artist || "";
        elements.title.textContent = artist ? `${title} — ${artist}` : title;
        state.trackTitle = title;
        state.trackArtist = artist || null;
        state.trackDurationSeconds = durationSeconds;
      }
      setLoadingState(elements, false);
      if (viz) {
        viz.setVisible(true);
      }
      // Report "ready" as a paused-like non-loading status before the
      // autoplay delay so sender UIs can update metadata immediately.
      sendStatusUpdate();
      await new Promise((resolve) => setTimeout(resolve, POST_LOAD_PLAY_DELAY_MS));
      if (token !== state.loadToken) {
        return;
      }
      void recordPlay(jobId).catch((err) => {
        console.warn(`Failed to record cast play: ${String(err)}`);
      });
      engine.startJukebox();
      engine.play();
      isTrackPaused = false;
      listenAccumulatedMs = 0;
      playStartAtMs = performance.now();
      clearIdleStopTimer();
      sendStatusUpdate();
    } catch (err) {
      if (token !== state.loadToken) {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Load failed";
      const errorCode =
        err &&
        typeof err === "object" &&
        "code" in err &&
        typeof (err as { code?: unknown }).code === "string"
          ? (err as { code: string }).code
          : null;
      state.currentTrackId = null;
      state.lastBeatIndex = null;
      state.vizData = null;
      state.trackTitle = null;
      state.trackArtist = null;
      state.trackDurationSeconds = null;
      if (viz) {
        viz.reset();
        viz.setVisible(false);
      }
      if (engine) {
        engine.stopJukebox();
        engine.resetStats();
      }
      if (player) {
        await player.dispose();
      }
      player = null;
      engine = null;
      playStartAtMs = null;
      listenAccumulatedMs = 0;
      setIdleState(elements);
      setLogoVisible(elements, true);
      startIdleKeepAlive();
      scheduleIdleStop();
      sendStatusUpdate(errorMessage, errorCode);
    }
  }

  function applyTuningToEngine(tuningParams: string | null) {
    if (!engine || !defaultConfig || !state.currentTrackId) {
      return { parsed: null, highlightOnly: false };
    }
    const result = applyCastTuningToEngine(engine, defaultConfig, tuningParams);
    anchorHighlightEnabled = result.highlightAnchorBranch;
    return { parsed: result.parsed, highlightOnly: result.highlightOnly };
  }

  function applyTuningUpdate(tuningParams: string | null): boolean {
    if (!engine || !defaultConfig || !state.currentTrackId) {
      return false;
    }
    try {
      const result = applyTuningToEngine(tuningParams);
      if (result.highlightOnly) {
        if (viz) {
          viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
          viz.setVisible(true);
        }
        return true;
      }
      state.vizData = engine.getVisualizationData();
      if (state.vizData) {
        if (!viz) {
          createViz(state.activeVizIndex);
        }
        if (viz) {
          viz.setActiveIndex(state.activeVizIndex);
          viz.setAnchorHighlightEnabled(anchorHighlightEnabled);
          viz.setData(state.vizData);
          viz.setVisible(true);
        }
      } else if (viz) {
        viz.reset();
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
        engine.startJukebox(!isTrackPaused);
      }
      engine.play();
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
        const songId =
          typeof customData.songId === "string" ? customData.songId : null;
        const tuningParams =
          typeof customData.tuningParams === "string"
            ? customData.tuningParams
            : null;
        const vizIndex =
          typeof customData.vizIndex === "number" &&
          Number.isFinite(customData.vizIndex)
            ? customData.vizIndex
            : null;
        if (songId) {
          const nextUrl = baseUrl
            ? `${baseUrl.replace(/\/+$/, "")}/cast/${encodeURIComponent(songId)}`
            : null;
          if (nextUrl) {
            window.history.replaceState({}, "", nextUrl);
          }
          void startTrack(songId, tuningParams, vizIndex);
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
    const startOptions: { disableIdleTimeout: boolean; customNamespaces?: Record<string, unknown> } = {
      disableIdleTimeout: true,
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
  const initialTrackId = getTrackId();
  if (initialTrackId) {
    void startTrack(initialTrackId, null);
  } else {
    setIdleState(elements);
    startIdleKeepAlive();
    scheduleIdleStop();
  }
}

bootstrap();

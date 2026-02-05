import "../cast/style.css";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import { JukeboxEngine } from "../engine";
import type { JukeboxConfig } from "../engine/types";
import { JukeboxViz } from "../jukebox/JukeboxViz";
import { fetchAnalysis, fetchAudio, fetchJobByYoutube } from "../app/api";
import { formatDuration } from "../app/format";

type CastCustomData = {
  baseUrl?: string;
  songId?: string;
  tuningParams?: string;
};

type CastCommand = {
  type?: "play" | "stop" | "getStatus" | "setTuning";
  tuningParams?: string | null;
};

type CastStatus = {
  type: "status";
  songId: string | null;
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  error?: string | null;
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
              senderId: string,
              message: unknown,
            ): void;
            start(options?: { disableIdleTimeout?: boolean }): void;
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

const MIN_RANDOM_BRANCH_DELTA = 0;
const MAX_RANDOM_BRANCH_DELTA = 1;
const TUNING_PARAM_KEYS = ["lb", "jb", "lg", "sq", "thresh", "bp", "d"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mapPercentToRange(percent: number, min: number, max: number) {
  const safePercent = clamp(percent, 0, 100);
  return ((max - min) * safePercent) / 100 + min;
}

function parseDeletedEdgeIds(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function parseTuningParams(
  raw: string | null,
  defaults: JukeboxConfig,
): { config: JukeboxConfig; deletedEdgeIds: number[] } | null {
  if (!raw) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const hasTuningParam = TUNING_PARAM_KEYS.some((key) => params.has(key));
  if (!hasTuningParam) {
    return null;
  }
  const nextConfig: JukeboxConfig = { ...defaults };
  if (params.has("lb")) {
    nextConfig.addLastEdge = params.get("lb") !== "0";
  }
  if (params.get("jb") === "1") {
    nextConfig.justBackwards = true;
  }
  if (params.get("lg") === "1") {
    nextConfig.justLongBranches = true;
  }
  if (params.get("sq") === "0") {
    nextConfig.removeSequentialBranches = true;
  }
  if (params.has("thresh")) {
    const rawThresh = Number.parseInt(params.get("thresh") ?? "", 10);
    if (Number.isFinite(rawThresh) && rawThresh >= 0) {
      nextConfig.currentThreshold = rawThresh;
    }
  }
  if (params.has("bp")) {
    const fields = (params.get("bp") ?? "").split(",");
    if (fields.length === 3) {
      const minPct = Number.parseInt(fields[0] ?? "", 10);
      const maxPct = Number.parseInt(fields[1] ?? "", 10);
      const deltaPct = Number.parseInt(fields[2] ?? "", 10);
      if (Number.isFinite(minPct)) {
        nextConfig.minRandomBranchChance = mapPercentToRange(minPct, 0, 1);
      }
      if (Number.isFinite(maxPct)) {
        nextConfig.maxRandomBranchChance = mapPercentToRange(maxPct, 0, 1);
      }
      if (Number.isFinite(deltaPct)) {
        nextConfig.randomBranchChanceDelta = mapPercentToRange(
          deltaPct,
          MIN_RANDOM_BRANCH_DELTA,
          MAX_RANDOM_BRANCH_DELTA,
        );
      }
    }
  }
  const deletedEdgeIds = parseDeletedEdgeIds(params.get("d"));
  return { config: nextConfig, deletedEdgeIds };
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
  const intervalMs = 2000;
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
  const IDLE_TIMEOUT_MS = 300_000;
  const IDLE_KEEPALIVE_MS = 25_000;
  let player: BufferedAudioPlayer | null = null;
  let engine: JukeboxEngine | null = null;
  let defaultConfig: JukeboxConfig | null = null;
  let castContext: ReturnType<CastReceiverContextType["getInstance"]> | null =
    null;
  let idleStopTimer: number | null = null;
  let idleKeepaliveTimer: number | null = null;
  Object.defineProperty(window, "devicePixelRatio", {
    value: 1,
    configurable: true,
  });
  let viz: JukeboxViz | null = null;
  const castNamespace = "urn:x-cast:com.foreverjukebox.app";
  const destroyViz = () => {
    if (viz) {
      viz.destroy();
      viz = null;
    }
  };

  const createViz = () => {
    destroyViz();
    viz = new JukeboxViz(elements.vizLayer, {
      positioners: [JukeboxViz.createClassicPositioner()],
      enableInteraction: false,
    });
    viz.setActiveIndex(0);
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
  };
  let lastCastSenderId: string | null = null;

  function sendStatusUpdate(senderId?: string, error?: string | null) {
    if (!castContext || !player) {
      return;
    }
    const target = senderId || lastCastSenderId || "*";
    const isLoading =
      state.loadToken > 0 && !!state.currentTrackId && !state.vizData;
    const hasTrack = !!state.currentTrackId;
    const isPlaying = player.isPlaying();
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
      isPlaying,
      isLoading,
      error: error ?? null,
      playbackState,
    };
    castContext.sendCustomMessage(castNamespace, target, status);
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
  window.setInterval(() => {
    if (playStartAtMs === null) {
      return;
    }
    const elapsed = Math.max(0, performance.now() - playStartAtMs);
    elements.listenTime.textContent = formatDuration(elapsed / 1000);
  }, 500);

  async function startTrack(
    trackId: string,
    tuningParams: string | null = null,
  ) {
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
    state.lastBeatIndex = null;
    state.vizData = null;
    state.trackTitle = null;
    state.trackArtist = null;
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
      if (defaultConfig) {
        engine.updateConfig(defaultConfig);
        engine.clearDeletedEdges();
      }
      const parsedTuning = defaultConfig
        ? parseTuningParams(tuningParams, defaultConfig)
        : null;
      if (parsedTuning) {
        engine.updateConfig(parsedTuning.config);
      }
      await loadAudio(jobId, elements.status, player, token, state);
      if (token !== state.loadToken) {
        return;
      }
      engine.loadAnalysis(analysis.result);
      if (parsedTuning?.deletedEdgeIds?.length) {
        const graph = engine.getGraphState();
        if (graph) {
          const edgeById = new Map(
            graph.allEdges.map((edge) => [edge.id, edge]),
          );
          for (const id of parsedTuning.deletedEdgeIds) {
            const edge = edgeById.get(id);
            if (edge) {
              engine.deleteEdge(edge);
            }
          }
          engine.rebuildGraph();
        }
      }
      state.vizData = engine.getVisualizationData();
      if (state.vizData) {
        if (!viz) {
          createViz();
        }
        if (viz) {
          viz.setData(state.vizData);
        }
      }
      const trackMeta = analysis.result?.track || analysis.track;
      if (trackMeta) {
        const title = trackMeta.title || "Unknown";
        const artist = trackMeta.artist || "";
        elements.title.textContent = artist ? `${title} — ${artist}` : title;
        state.trackTitle = title;
        state.trackArtist = artist || null;
      }
      setLoadingState(elements, false);
      if (viz) {
        viz.setVisible(true);
      }
      engine.startJukebox();
      engine.play();
      playStartAtMs = performance.now();
      clearIdleStopTimer();
      sendStatusUpdate();
    } catch (err) {
      if (token !== state.loadToken) {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Load failed";
      state.currentTrackId = null;
      state.lastBeatIndex = null;
      state.vizData = null;
      state.trackTitle = null;
      state.trackArtist = null;
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
      setIdleState(elements);
      setLogoVisible(elements, true);
      startIdleKeepAlive();
      scheduleIdleStop();
      sendStatusUpdate(undefined, errorMessage);
    }
  }

  function applyTuningUpdate(tuningParams: string | null) {
    if (!engine || !defaultConfig || !state.currentTrackId) {
      return;
    }
    engine.updateConfig(defaultConfig);
    engine.clearDeletedEdges();
    const parsedTuning = parseTuningParams(tuningParams, defaultConfig);
    if (parsedTuning) {
      engine.updateConfig(parsedTuning.config);
    }
    engine.rebuildGraph();
    if (parsedTuning?.deletedEdgeIds?.length) {
      const graph = engine.getGraphState();
      if (graph) {
        const edgeById = new Map(graph.allEdges.map((edge) => [edge.id, edge]));
        for (const id of parsedTuning.deletedEdgeIds) {
          const edge = edgeById.get(id);
          if (edge) {
            engine.deleteEdge(edge);
          }
        }
        engine.rebuildGraph();
      }
    }
    state.vizData = engine.getVisualizationData();
    if (state.vizData) {
      if (!viz) {
        createViz();
      }
      if (viz) {
        viz.setData(state.vizData);
        viz.setVisible(true);
      }
    } else if (viz) {
      viz.reset();
    }
  }

  function handleCastCommand(command: CastCommand, senderId?: string) {
    if (senderId) {
      lastCastSenderId = senderId;
    }
    if (!engine || !player) {
      return;
    }
    if (command.type === "setTuning") {
      applyTuningUpdate(command.tuningParams ?? null);
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
        engine.startJukebox();
      }
      engine.play();
      playStartAtMs = performance.now();
      clearIdleStopTimer();
      sendStatusUpdate(senderId);
      return;
    }
    if (command.type === "stop") {
      engine.stopJukebox();
      player.stop();
      playStartAtMs = null;
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
      sendStatusUpdate(senderId);
      return;
    }
    if (command.type === "getStatus" && castContext) {
      sendStatusUpdate(senderId);
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
        if (songId) {
          const nextUrl = baseUrl
            ? `${baseUrl.replace(/\/+$/, "")}/cast/${encodeURIComponent(songId)}`
            : null;
          if (nextUrl) {
            window.history.replaceState({}, "", nextUrl);
          }
          void startTrack(songId, tuningParams);
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
        if (event?.senderId) {
          lastCastSenderId = event.senderId;
        }
        const command =
          typeof payload === "string"
            ? (JSON.parse(payload) as CastCommand)
            : (payload as CastCommand);
        handleCastCommand(command, event?.senderId);
      } catch {
        return;
      }
    });
    context.start({ disableIdleTimeout: true });
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

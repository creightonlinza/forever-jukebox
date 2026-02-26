import React from "react";
import { Link } from "react-router-dom";
import { AnalysisWorkerClient } from "@/core/infrastructure/analysis/AnalysisWorkerClient";
import { AudioDecoder } from "@/core/infrastructure/audio/AudioDecoder";
import { createAnalysisCache } from "@/core/infrastructure/cache/analysisCache";
import { AnalyzeAudioUseCase, AnalyzeStage } from "@/core/application/usecases/analyzeAudio";
import { AnalysisOutput } from "@/shared/analysis-schema";
import { formatDuration } from "@/shared/utils/format";
import {
  pickBinaryExportFile,
  saveExportBinary,
} from "@/shared/utils/exportJson";
import { BufferedAudioPlayer } from "@/shared/jukebox/audio/BufferedAudioPlayer";
import { Edge, JukeboxConfig, JukeboxEngine } from "@/shared/jukebox/engine";
import {
  DEFAULT_VISUALIZATION_INDEX,
  VISUALIZATION_LABELS,
} from "@/shared/jukebox/constants/visualization";
import {
  exportJukeboxAudio,
  type JukeboxExportProgress,
} from "@/shared/jukebox/export";
import { AutocanonizerController } from "@/shared/jukebox/autocanonizer/AutocanonizerController";
import { JukeboxController } from "@/shared/jukebox/viz/JukeboxController";
import { useAppState } from "../state/AppState";
import { ProgressSteps, ProgressStep } from "@/ui/components/ProgressSteps";
import { SymbolIcon } from "@/ui/components/SymbolIcon";

const STEP_ORDER: Array<{ id: AnalyzeStage; label: string }> = [
  { id: "loading", label: "Loading file" },
  { id: "decoding", label: "Decoding audio" },
  { id: "beats", label: "Detecting beats" },
  { id: "features", label: "Extracting features" },
  { id: "building", label: "Building analysis" },
  { id: "ready", label: "Ready" },
];

const DEFAULT_CONFIG: JukeboxConfig = {
  maxBranches: 4,
  maxBranchThreshold: 80,
  currentThreshold: 0,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  minRandomBranchChance: 0.18,
  maxRandomBranchChance: 0.5,
  randomBranchChanceDelta: 0.1,
  minLongBranch: 0,
};

const CANONIZER_FINISH_STORAGE_KEY = "fj-canonizer-finish";
const VISUALIZATION_STORAGE_KEY = "fj-viz";
const ANCHOR_HIGHLIGHT_STORAGE_KEY = "fj-highlight-anchor-branch";
const MAX_EXPORT_DURATION_SECONDS = 60 * 60 * 2;

type PlayMode = "jukebox" | "autocanonizer";
type AudioExportFormat = "mp3" | "wav";

function getVisualizationLabel(index: number) {
  return VISUALIZATION_LABELS[index] ?? `Visualization ${index + 1}`;
}

function coerceVisualizationIndex(index: number) {
  if (
    Number.isFinite(index) &&
    index >= 0 &&
    index < VISUALIZATION_LABELS.length
  ) {
    return index;
  }
  return DEFAULT_VISUALIZATION_INDEX;
}

function buildAudioExportName(fileName: string, extension: string) {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return `${base || "jukebox"}_forever.${extension}`;
}

function resolveStoredAnchorHighlight(): boolean {
  try {
    const stored = window.localStorage.getItem(ANCHOR_HIGHLIGHT_STORAGE_KEY);
    return stored === "1" || stored === "true";
  } catch {
    return false;
  }
}

function storeAnchorHighlight(enabled: boolean) {
  try {
    window.localStorage.setItem(
      ANCHOR_HIGHLIGHT_STORAGE_KEY,
      enabled ? "1" : "0",
    );
  } catch {
    // ignore storage failures
  }
}

type TuneFormState = {
  threshold: number;
  computedThreshold: number;
  minProb: number;
  maxProb: number;
  ramp: number;
  volume: number;
  highlightAnchorBranch: boolean;
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
};

type ExportFormState = {
  durationSeconds: number;
  format: AudioExportFormat;
  bitrateKbps: number;
};

function createSessionSeed(): number {
  if ("crypto" in globalThis && "getRandomValues" in globalThis.crypto) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function waitForNextPaint(): Promise<void> {
  if ("requestAnimationFrame" in window) {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  return Promise.resolve();
}

export function Listen({ isActive = true }: { isActive?: boolean }) {
  const { file, setIsListenLoading } = useAppState();
  const [analysis, setAnalysis] = React.useState<AnalysisOutput | null>(null);
  const [readyFileKey, setReadyFileKey] = React.useState<string | null>(null);
  const [progressStage, setProgressStage] = React.useState<AnalyzeStage>("loading");
  const [progressMessage, setProgressMessage] = React.useState<string | null>(null);
  const [progressPercent, setProgressPercent] = React.useState<number | null>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const [isRunning, setIsRunning] = React.useState(false);
  const [beatsPlayed, setBeatsPlayed] = React.useState(0);
  const [listenSeconds, setListenSeconds] = React.useState(0);
  const [selectedEdge, setSelectedEdge] = React.useState<Edge | null>(null);
  const [isTuningOpen, setIsTuningOpen] = React.useState(false);
  const [isInfoOpen, setIsInfoOpen] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [activeVizIndex, setActiveVizIndex] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem(VISUALIZATION_STORAGE_KEY);
      if (raw !== null) {
        const parsed = Number.parseInt(raw, 10);
        return coerceVisualizationIndex(parsed);
      }
    } catch {
      // ignore storage failures
    }
    return DEFAULT_VISUALIZATION_INDEX;
  });
  const [playMode, setPlayMode] = React.useState<PlayMode>("jukebox");
  const [highlightAnchorBranch, setHighlightAnchorBranch] = React.useState<boolean>(
    () => resolveStoredAnchorHighlight(),
  );
  const [finishOutSong, setFinishOutSong] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CANONIZER_FINISH_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [tuneForm, setTuneForm] = React.useState<TuneFormState>({
    threshold: 0,
    computedThreshold: 0,
    minProb: Math.round(DEFAULT_CONFIG.minRandomBranchChance * 100),
    maxProb: Math.round(DEFAULT_CONFIG.maxRandomBranchChance * 100),
    ramp: Math.round(DEFAULT_CONFIG.randomBranchChanceDelta * 1000) / 10,
    volume: 50,
    highlightAnchorBranch,
    justBackwards: DEFAULT_CONFIG.justBackwards,
    justLongBranches: DEFAULT_CONFIG.justLongBranches,
    removeSequentialBranches: DEFAULT_CONFIG.removeSequentialBranches,
  });
  const [isExportOpen, setIsExportOpen] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exportProgress, setExportProgress] =
    React.useState<JukeboxExportProgress | null>(null);
  const [exportForm, setExportForm] = React.useState<ExportFormState>({
    durationSeconds: 60,
    format: "mp3",
    bitrateKbps: 192,
  });

  const vizPanelRef = React.useRef<HTMLDivElement | null>(null);
  const vizLayerRef = React.useRef<HTMLDivElement | null>(null);
  const canonizerLayerRef = React.useRef<HTMLDivElement | null>(null);
  const vizControllerRef = React.useRef<JukeboxController | null>(null);
  const autocanonizerRef = React.useRef<AutocanonizerController | null>(null);
  const engineRef = React.useRef<JukeboxEngine | null>(null);
  const playerRef = React.useRef<BufferedAudioPlayer | null>(null);
  const isRunningRef = React.useRef(false);
  const playModeRef = React.useRef<PlayMode>("jukebox");
  const lastBeatRef = React.useRef<number | null>(null);
  const playTimerMsRef = React.useRef(0);
  const lastPlayStampRef = React.useRef<number | null>(null);
  const wakeLockRef = React.useRef<{ release: () => Promise<void> } | null>(null);
  const analysisRef = React.useRef<AnalysisOutput | null>(null);

  React.useEffect(() => {
    playerRef.current = new BufferedAudioPlayer();
    return () => {
      void playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    vizControllerRef.current?.setActiveIndex(activeVizIndex);
  }, [activeVizIndex]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        VISUALIZATION_STORAGE_KEY,
        String(activeVizIndex)
      );
    } catch {
      // ignore storage failures
    }
  }, [activeVizIndex]);

  React.useEffect(() => {
    if (!vizLayerRef.current || !canonizerLayerRef.current) {
      return;
    }
    const controller = new JukeboxController(vizLayerRef.current);
    const autocanonizer = new AutocanonizerController(canonizerLayerRef.current);
    vizControllerRef.current = controller;
    autocanonizerRef.current = autocanonizer;

    controller.setActiveIndex(activeVizIndex);
    controller.setVisible(playModeRef.current === "jukebox");
    controller.setAnchorHighlightEnabled(highlightAnchorBranch);
    autocanonizer.setVisible(playModeRef.current === "autocanonizer");
    autocanonizer.setFinishOutSong(finishOutSong);
    autocanonizer.setOnBeat((index) => {
      setBeatsPlayed(index + 1);
      lastBeatRef.current = index;
    });
    autocanonizer.setOnEnded(() => {
      if (!isRunningRef.current) {
        return;
      }
      stopPlayback();
    });
    autocanonizer.setOnSelect((index) => {
      if (playModeRef.current !== "autocanonizer") {
        return;
      }
      startAutocanonizerPlayback(index);
    });

    const resizeObserver = new ResizeObserver(() => {
      controller.resizeActive();
      autocanonizer.resizeNow();
    });
    resizeObserver.observe(vizPanelRef.current ?? vizLayerRef.current);

    return () => {
      resizeObserver.disconnect();
      controller.destroy();
      autocanonizer.destroy();
      vizControllerRef.current = null;
      autocanonizerRef.current = null;
    };
  }, [file]);

  React.useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  React.useEffect(() => {
    playModeRef.current = playMode;
    vizControllerRef.current?.setVisible(playMode === "jukebox");
    autocanonizerRef.current?.setVisible(playMode === "autocanonizer");
    if (playMode === "autocanonizer") {
      autocanonizerRef.current?.resizeNow();
    } else {
      vizControllerRef.current?.resizeActive();
    }
  }, [playMode]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        CANONIZER_FINISH_STORAGE_KEY,
        String(finishOutSong)
      );
    } catch {
      // ignore storage failures
    }
    autocanonizerRef.current?.setFinishOutSong(finishOutSong);
  }, [finishOutSong]);

  React.useEffect(() => {
    setIsListenLoading(isAnalyzing);
    return () => {
      setIsListenLoading(false);
    };
  }, [isAnalyzing, setIsListenLoading]);

  React.useEffect(() => {
    const duration = analysis?.track?.duration;
    if (!duration || !Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const rounded = Math.max(5, Math.round(duration));
    setExportForm((prev) => ({
      ...prev,
      durationSeconds: Math.min(MAX_EXPORT_DURATION_SECONDS, rounded),
    }));
  }, [analysis]);

  React.useEffect(() => {
    if (!file || !playerRef.current) {
      return;
    }
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    let cancelled = false;

    const analysisPort = new AnalysisWorkerClient();
    const cache = createAnalysisCache();
    const decoder = new AudioDecoder(playerRef.current.getContext());
    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);

    engineRef.current?.stopJukebox();
    autocanonizerRef.current?.stop();
    playTimerMsRef.current = 0;
    lastPlayStampRef.current = null;
    lastBeatRef.current = null;
    setIsRunning(false);
    setBeatsPlayed(0);
    setListenSeconds(0);

    setIsAnalyzing(true);
    setError(null);
    setProgressPercent(0);
    setAnalysis(null);
    setReadyFileKey(null);
    analysisRef.current = null;
    setSelectedEdge(null);
    setIsExportOpen(false);
    setIsExporting(false);
    setExportError(null);
    setExportProgress(null);

    usecase
      .execute({
        file,
        onProgress: (progress) => {
          if (cancelled) {
            return;
          }
          if (progress.stage === "segments") {
            setProgressStage("features");
          } else if (progress.stage === "cached") {
            setProgressStage("ready");
          } else {
            setProgressStage(progress.stage);
          }
          setProgressPercent(progress.progress);
          if (progress.message) {
            setProgressMessage(progress.message);
          }
        },
      })
      .then(async (result) => {
        if (cancelled) {
          return;
        }
        analysisRef.current = result.analysis;
        setAnalysis(result.analysis);
        setReadyFileKey(fileKey);
        await playerRef.current?.loadBuffer(result.audioBuffer);
        autocanonizerRef.current?.setAudio(
          playerRef.current?.getBuffer() ?? null,
          playerRef.current?.getContext() ?? null
        );
        initializeEngine(result.analysis);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) {
          setIsAnalyzing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      const totalMs =
        playTimerMsRef.current +
        (lastPlayStampRef.current !== null ? now - lastPlayStampRef.current : 0);
      setListenSeconds(totalMs / 1000);
    }, 200);

    return () => {
      window.clearInterval(id);
    };
  }, []);

  React.useEffect(() => {
    if (!isActive) {
      engineRef.current?.setForceBranch(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTuningOpen || isInfoOpen || isExportOpen) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedEdge &&
        !selectedEdge.deleted
      ) {
        event.preventDefault();
        deleteSelectedBranch();
        return;
      }
      if (playMode === "jukebox" && event.key === "Shift" && isRunning) {
        engineRef.current?.setForceBranch(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (playMode === "jukebox" && event.key === "Shift") {
        engineRef.current?.setForceBranch(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [selectedEdge, isRunning, isTuningOpen, isInfoOpen, isExportOpen, playMode, isActive]);

  React.useEffect(() => {
    const onFullscreen = () => {
      const active = document.fullscreenElement === vizPanelRef.current;
      setIsFullscreen(active);
      if (playModeRef.current === "autocanonizer") {
        autocanonizerRef.current?.resizeNow();
      } else {
        vizControllerRef.current?.resizeActive();
      }
      if (active) {
        void requestWakeLock();
      } else {
        void releaseWakeLock();
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        void releaseWakeLock();
        return;
      }
      if (document.fullscreenElement === vizPanelRef.current) {
        void requestWakeLock();
      }
    };

    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const requestWakeLock = async () => {
    if (!("wakeLock" in navigator) || wakeLockRef.current) {
      return;
    }
    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  };

  const releaseWakeLock = async () => {
    if (!wakeLockRef.current) {
      return;
    }
    try {
      await wakeLockRef.current.release();
    } catch {
      // ignore
    }
    wakeLockRef.current = null;
  };

  function stopPlayback() {
    if (playModeRef.current === "autocanonizer") {
      autocanonizerRef.current?.stop();
      playerRef.current?.stop();
    }
    engineRef.current?.stopJukebox();
    if (lastPlayStampRef.current !== null) {
      playTimerMsRef.current += performance.now() - lastPlayStampRef.current;
      lastPlayStampRef.current = null;
    }
    setIsRunning(false);
  }

  const onSetPlayMode = (mode: PlayMode) => {
    if (playMode === mode) {
      return;
    }
    if (isRunningRef.current) {
      stopPlayback();
    }
    playModeRef.current = mode;
    setPlayMode(mode);
    if (mode === "autocanonizer") {
      setIsTuningOpen(false);
      setIsInfoOpen(false);
      setSelectedEdge(null);
      vizControllerRef.current?.setSelectedEdge(null);
    }
  };

  const initializeEngine = (analysisData: AnalysisOutput) => {
    if (!playerRef.current) {
      return;
    }
    const engine = new JukeboxEngine(playerRef.current, {
      randomMode: "seeded",
      seed: createSessionSeed(),
    });
    engine.loadAnalysis(analysisData);
    engine.onUpdate((state) => {
      setBeatsPlayed(state.beatsPlayed);
      if (state.currentBeatIndex >= 0) {
        const jumpFrom =
          state.lastJumped && state.lastJumpFromIndex !== null
            ? state.lastJumpFromIndex
            : lastBeatRef.current;
        vizControllerRef.current?.update(state.currentBeatIndex, state.lastJumped, jumpFrom);
        lastBeatRef.current = state.currentBeatIndex;
      }
    });
    engineRef.current = engine;
    autocanonizerRef.current?.setAnalysis(analysisData, analysisData.track?.duration);

    const vizData = engine.getVisualizationData();
    if (vizData) {
      vizControllerRef.current?.setData(vizData);
    }
    vizControllerRef.current?.setOnSelect((index) => {
      if (playModeRef.current !== "jukebox") {
        return;
      }
      startFromBeat(index, analysisData);
    });
    vizControllerRef.current?.setOnEdgeSelect((edge) => {
      if (playModeRef.current !== "jukebox") {
        return;
      }
      setSelectedEdge(edge);
      vizControllerRef.current?.setSelectedEdgeActive(edge);
    });
    const count = vizControllerRef.current?.getCount() ?? 1;
    setActiveVizIndex((prev) => Math.max(0, Math.min(prev, count - 1)));

    syncTuneFormFromEngine();
  };

  const syncTuneFormFromEngine = (nextHighlightAnchorBranch = highlightAnchorBranch) => {
    const engine = engineRef.current;
    const player = playerRef.current;
    if (!engine || !player) {
      return;
    }
    const config = engine.getConfig();
    const graph = engine.getGraphState();
    const computedThreshold = Math.round(graph?.computedThreshold ?? 0);
    const currentThreshold = config.currentThreshold === 0
      ? Math.round(graph?.currentThreshold ?? computedThreshold)
      : config.currentThreshold;
    setTuneForm({
      threshold: currentThreshold,
      computedThreshold,
      minProb: Math.round(config.minRandomBranchChance * 100),
      maxProb: Math.round(config.maxRandomBranchChance * 100),
      ramp: Math.round(config.randomBranchChanceDelta * 1000) / 10,
      volume: Math.round(player.getVolume() * 100),
      highlightAnchorBranch: nextHighlightAnchorBranch,
      justBackwards: config.justBackwards,
      justLongBranches: config.justLongBranches,
      removeSequentialBranches: config.removeSequentialBranches,
    });
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    const engine = engineRef.current;
    if (!player || !engine || !analysisRef.current) {
      return;
    }
    if (!isRunning) {
      if (playMode === "autocanonizer") {
        startAutocanonizerPlayback(0);
        return;
      }
      engine.stopJukebox();
      engine.resetStats();
      playTimerMsRef.current = 0;
      lastPlayStampRef.current = null;
      setListenSeconds(0);
      setBeatsPlayed(0);
      lastBeatRef.current = null;
      vizControllerRef.current?.reset();

      engine.startJukebox();
      engine.play();
      lastPlayStampRef.current = performance.now();
      setIsRunning(true);
      if (document.fullscreenElement === vizPanelRef.current) {
        void requestWakeLock();
      }
      return;
    }
    stopPlayback();
  };

  const startFromBeat = (index: number, analysisData?: AnalysisOutput | null) => {
    if (playMode === "autocanonizer") {
      startAutocanonizerPlayback(index);
      return;
    }
    const player = playerRef.current;
    const engine = engineRef.current;
    const activeAnalysis = analysisData ?? analysisRef.current;
    if (!activeAnalysis || !player || !engine) {
      return;
    }
    const beat = activeAnalysis.beats[index];
    if (!beat) {
      return;
    }

    player.seek(beat.start);
    engine.seekToBeat(index);
    lastBeatRef.current = index;
    vizControllerRef.current?.update(index, true, null);

    if (!player.isPlaying()) {
      engine.startJukebox(false);
      engine.play();
      lastPlayStampRef.current = performance.now();
      setIsRunning(true);
      if (document.fullscreenElement === vizPanelRef.current) {
        void requestWakeLock();
      }
    }
  };

  const startAutocanonizerPlayback = (index: number) => {
    const autocanonizer = autocanonizerRef.current;
    const engine = engineRef.current;
    const player = playerRef.current;
    if (!autocanonizer || !engine || !player || !autocanonizer.isReady()) {
      return false;
    }
    player.stop();
    engine.stopJukebox();
    playTimerMsRef.current = 0;
    lastPlayStampRef.current = null;
    setListenSeconds(0);
    setBeatsPlayed(0);
    lastBeatRef.current = null;
    autocanonizer.resetVisualization();
    autocanonizer.startAtIndex(index);
    lastPlayStampRef.current = performance.now();
    setIsRunning(true);
    if (document.fullscreenElement === vizPanelRef.current) {
      void requestWakeLock();
    }
    return true;
  };

  const deleteSelectedBranch = () => {
    const engine = engineRef.current;
    const edge = selectedEdge;
    if (!engine || !edge || edge.deleted) {
      return;
    }
    engine.deleteEdge(edge);
    engine.rebuildGraph();
    const data = engine.getVisualizationData();
    if (data) {
      vizControllerRef.current?.setData(data);
    }
    vizControllerRef.current?.setSelectedEdge(null);
    setSelectedEdge(null);
    syncTuneFormFromEngine();
  };

  const onApplyTuning = () => {
    const engine = engineRef.current;
    const player = playerRef.current;
    if (!engine || !player) {
      return;
    }

    let minProb = tuneForm.minProb;
    let maxProb = tuneForm.maxProb;
    if (minProb > maxProb) {
      [minProb, maxProb] = [maxProb, minProb];
    }
    const useAutoThreshold = tuneForm.threshold === tuneForm.computedThreshold;

    engine.updateConfig({
      currentThreshold: useAutoThreshold ? 0 : tuneForm.threshold,
      minRandomBranchChance: minProb / 100,
      maxRandomBranchChance: maxProb / 100,
      randomBranchChanceDelta: tuneForm.ramp / 100,
      justBackwards: tuneForm.justBackwards,
      justLongBranches: tuneForm.justLongBranches,
      removeSequentialBranches: tuneForm.removeSequentialBranches,
    });
    setHighlightAnchorBranch(tuneForm.highlightAnchorBranch);
    storeAnchorHighlight(tuneForm.highlightAnchorBranch);
    vizControllerRef.current?.setAnchorHighlightEnabled(
      tuneForm.highlightAnchorBranch,
    );
    engine.rebuildGraph();
    const data = engine.getVisualizationData();
    if (data) {
      vizControllerRef.current?.setData(data);
    }
    const volume = tuneForm.volume / 100;
    player.setVolume(volume);
    autocanonizerRef.current?.setVolume(volume);
    syncTuneFormFromEngine(tuneForm.highlightAnchorBranch);
    setIsTuningOpen(false);
  };

  const onResetTuning = () => {
    const engine = engineRef.current;
    const player = playerRef.current;
    if (!engine || !player) {
      return;
    }
    engine.clearDeletedEdges();
    engine.updateConfig(DEFAULT_CONFIG);
    engine.rebuildGraph();
    const data = engine.getVisualizationData();
    if (data) {
      vizControllerRef.current?.setData(data);
    }
    vizControllerRef.current?.setSelectedEdge(null);
    setSelectedEdge(null);
    player.setVolume(0.5);
    autocanonizerRef.current?.setVolume(0.5);
    syncTuneFormFromEngine();
    setIsTuningOpen(false);
  };

  const onExportJukeboxAudio = async () => {
    const activeAnalysis = analysisRef.current ?? analysis;
    const player = playerRef.current;
    const engine = engineRef.current;
    if (!activeAnalysis || !player || !engine || !file) {
      return;
    }

    const sourceBuffer = player.getBuffer();
    if (!sourceBuffer) {
      setExportError("Playback buffer is not ready yet.");
      return;
    }

    const durationSeconds = Number(exportForm.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      setExportError("Export duration must be a positive number of seconds.");
      return;
    }
    if (durationSeconds > MAX_EXPORT_DURATION_SECONDS) {
      setExportError(
        `Export duration is capped at ${MAX_EXPORT_DURATION_SECONDS / 60} minutes.`,
      );
      return;
    }

    const requestedExtension = exportForm.format;
    const requestedFilename = buildAudioExportName(file.name, requestedExtension);
    const requestedDescription =
      requestedExtension === "mp3" ? "MP3 Audio" : "WAV Audio";
    const requestedMimeType =
      requestedExtension === "mp3" ? "audio/mpeg" : "audio/wav";

    let pickedHandle: Awaited<ReturnType<typeof pickBinaryExportFile>> = null;
    try {
      pickedHandle = await pickBinaryExportFile(requestedFilename, {
        mimeType: requestedMimeType,
        description: requestedDescription,
        extension: `.${requestedExtension}`,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") {
        return;
      }
      setExportError("Unable to open the file save dialog.");
      return;
    }

    setExportError(null);
    setExportProgress({
      stage: "planning",
      message: "Initializing export",
      percent: 0,
    });
    setIsExporting(true);
    await waitForNextPaint();

    try {
      const deletedEdges =
        engine
          .getGraphState()
          ?.allEdges.filter((edge) => edge.deleted)
          .map((edge) => ({ src: edge.src.which, dest: edge.dest.which })) ?? [];

      const result = await exportJukeboxAudio({
        analysis: activeAnalysis,
        sourceBuffer,
        config: engine.getConfig(),
        deletedEdges,
        durationSeconds,
        format: exportForm.format,
        bitrateKbps: exportForm.format === "mp3" ? exportForm.bitrateKbps : undefined,
        gain: player.getVolume(),
        randomMode: "seeded",
        seed: createSessionSeed(),
        onProgress: (progress) => setExportProgress(progress),
      });

      const extension = result.extension;
      const filename = buildAudioExportName(file.name, extension);
      const description =
        extension === "mp3" ? "MP3 Audio" : "WAV Audio";
      await saveExportBinary(
        filename,
        result.bytes,
        {
          mimeType: result.mimeType,
          description,
          extension: `.${extension}`,
        },
        extension === requestedExtension ? pickedHandle : null,
      );
      setIsExportOpen(false);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message || "Audio export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const onToggleFullscreen = async () => {
    if (!vizPanelRef.current) {
      return;
    }
    if (document.fullscreenElement !== vizPanelRef.current) {
      try {
        await vizPanelRef.current.requestFullscreen();
      } catch {
        // ignore
      }
      return;
    }
    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    }
  };

  const onSetActiveViz = (index: number) => {
    if (playMode === "autocanonizer") {
      return;
    }
    const count = vizControllerRef.current?.getCount() ?? 1;
    if (!Number.isFinite(index) || index < 0 || index >= count) {
      return;
    }
    vizControllerRef.current?.setActiveIndex(index);
    setActiveVizIndex(index);
  };

  const steps = React.useMemo<ProgressStep[]>(() => {
    const stageIndex = STEP_ORDER.findIndex((step) => step.id === progressStage);
    return STEP_ORDER.map((step, idx) => ({
      id: step.id,
      label: step.label,
      status: idx < stageIndex ? "done" : idx === stageIndex ? "active" : "pending",
    }));
  }, [progressStage]);

  const graph = engineRef.current?.getGraphState();
  const totalBeats = graph?.totalBeats ?? analysis?.beats.length ?? 0;
  const totalBranches = engineRef.current?.getVisualizationData()?.edges.length ?? 0;
  const deletedBranches = graph?.allEdges.filter((edge) => edge.deleted).length ?? 0;
  const vizCount = vizControllerRef.current?.getCount() ?? 1;
  const currentFileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : null;
  const showPlaybackUi = Boolean(analysis) && !isAnalyzing && readyFileKey === currentFileKey;

  if (!file) {
    return (
      <section className="panel panel--center">
        <p>No file selected.</p>
        <Link className="tab-btn" to="/">Go back</Link>
      </section>
    );
  }
  const displayTitle =
    playMode === "autocanonizer" ? `${file.name} (autocanonized)` : file.name;

  return (
    <section className="listen-page">
      {isAnalyzing ? (
        <div className="panel" id="play-status">
          <ProgressSteps
            steps={steps}
            currentMessage={progressMessage}
            currentProgress={progressPercent}
          />
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <div className="play-title">{displayTitle}</div>

      {showPlaybackUi ? (
        <div className="menu-bar">
          <div className="menu-left">
            <button
              id="play"
              className="play-toggle"
              type="button"
              onClick={togglePlayback}
              disabled={!analysis}
              title={isRunning ? "Stop" : "Play"}
              aria-label={isRunning ? "Stop" : "Play"}
            >
              <SymbolIcon className="play-icon" name={isRunning ? "stop" : "play_arrow"} />
              <span className="play-text">{isRunning ? "Stop" : "Play"}</span>
            </button>
          </div>
          <div className="menu-right">
            <button
              id="tuning"
              className={`tune-toggle ${playMode === "autocanonizer" ? "is-hidden" : ""}`}
              type="button"
              onClick={() => {
                syncTuneFormFromEngine();
                setIsTuningOpen(true);
              }}
              disabled={!analysis || playMode === "autocanonizer"}
              title="Tune"
              aria-label="Tune"
            >
              <SymbolIcon className="tune-icon" name="tune" />
            </button>
            <button
              id="track-info"
              className={`info-toggle ${playMode === "autocanonizer" ? "is-hidden" : ""}`}
              type="button"
              onClick={() => setIsInfoOpen(true)}
              disabled={!analysis || playMode === "autocanonizer"}
              title="Info"
              aria-label="Info"
            >
              <SymbolIcon className="info-icon" name="info" />
            </button>
            <button
              id="track-audio-export"
              className={`copy-toggle ${playMode === "autocanonizer" ? "is-hidden" : ""}`}
              type="button"
              onClick={() => {
                setExportError(null);
                setExportProgress(null);
                setIsExportOpen(true);
              }}
              disabled={!analysis || isExporting || playMode === "autocanonizer"}
              title="Export jukebox audio"
              aria-label="Export jukebox audio"
            >
              <SymbolIcon className="copy-icon" name="download" />
            </button>
          </div>
        </div>
      ) : null}

      <div id="viz-panel" ref={vizPanelRef} hidden={!showPlaybackUi}>
        <div id="jukebox-viz" className={`viz ${playMode === "autocanonizer" ? "is-canonizer" : ""}`}>
          <div id="viz-layer" className="viz-layer" ref={vizLayerRef} />
          <div id="canonizer-layer" className="canonizer-layer" ref={canonizerLayerRef} />
          <div className="viz-top">
            <div className="viz-actions">
              <label className="viz-select-group" htmlFor="play-mode-select">
                <span className="viz-select-wrap">
                  <select
                    id="play-mode-select"
                    className="viz-select"
                    aria-label="Mode"
                    value={playMode}
                    onChange={(event) =>
                      onSetPlayMode(
                        event.target.value === "autocanonizer"
                          ? "autocanonizer"
                          : "jukebox"
                      )
                    }
                  >
                    <option value="autocanonizer">Autocanonizer</option>
                    <option value="jukebox">Jukebox</option>
                  </select>
                  <SymbolIcon className="viz-select-arrow" name="arrow_drop_down" />
                </span>
              </label>
            </div>
            <div className="viz-controls">
              <label className="viz-select-group" htmlFor="viz-select">
                <span className="viz-select-wrap">
                  <select
                    id="viz-select"
                    className="viz-select"
                    aria-label="Visualization"
                    value={String(activeVizIndex)}
                    onChange={(event) => onSetActiveViz(Number(event.target.value))}
                    disabled={playMode === "autocanonizer"}
                  >
                    {Array.from({ length: vizCount }, (_, index) => (
                      <option key={index} value={index}>
                        {getVisualizationLabel(index)}
                      </option>
                    ))}
                  </select>
                  <SymbolIcon className="viz-select-arrow" name="arrow_drop_down" />
                </span>
              </label>
            </div>
            <div className="canonizer-finish">
              <input
                id="canonizer-finish"
                type="checkbox"
                checked={finishOutSong}
                onChange={(event) => setFinishOutSong(event.target.checked)}
              />
              <span>Finish out the song</span>
            </div>
          </div>
          <div className="viz-bottom" id="viz-stats">
            <div className="viz-bottom-left">
              <button
                id="viz-play"
                className="play-toggle viz-play-toggle"
                type="button"
                onClick={togglePlayback}
                disabled={!analysis}
                title={isRunning ? "Stop" : "Play"}
                aria-label={isRunning ? "Stop" : "Play"}
              >
                <SymbolIcon className="play-icon" name={isRunning ? "stop" : "play_arrow"} />
              </button>
              <div className="viz-info">
                <div className="viz-title" id="viz-now-playing">{displayTitle}</div>
                <div className="viz-meta">
                  <span>Listen Time:</span>
                  <span>{formatDuration(listenSeconds)}</span>
                  <span className={`viz-divider ${playMode === "autocanonizer" ? "is-hidden" : ""}`}>·</span>
                  <span className={playMode === "autocanonizer" ? "is-hidden" : ""}>Total Beats:</span>
                  <span className={playMode === "autocanonizer" ? "is-hidden" : ""}>{beatsPlayed}</span>
                </div>
              </div>
            </div>
            <button
              id="fullscreen"
              className="fullscreen-toggle"
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <SymbolIcon className="fullscreen-icon" name={isFullscreen ? "fullscreen_exit" : "fullscreen"} />
            </button>
          </div>
        </div>
      </div>

      {isExportOpen ? (
        <div
          className="modal open"
          onClick={(event) =>
            event.target === event.currentTarget && !isExporting && setIsExportOpen(false)
          }
        >
          <div className="modal-panel">
            <div className="modal-header">
              <h2>Export Jukebox Audio</h2>
              <button
                className="modal-close"
                type="button"
                onClick={() => setIsExportOpen(false)}
                aria-label="Close"
                disabled={isExporting}
              >
                <SymbolIcon className="modal-close-icon" name="close" />
              </button>
            </div>
            <div className="modal-body export-body">
              <p className="export-note">
                Exports using current tuning and deleted branches.
              </p>
              <label>
                <div className="label-line">
                  Export Duration:
                  <span>{formatDuration(exportForm.durationSeconds)}</span>
                </div>
                <input
                  className="field-input"
                  type="number"
                  min={5}
                  max={MAX_EXPORT_DURATION_SECONDS}
                  step={5}
                  value={exportForm.durationSeconds}
                  disabled={isExporting}
                  onChange={(event) =>
                    setExportForm((prev) => ({
                      ...prev,
                      durationSeconds: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <div className="label-line">Format:</div>
                <select
                  className="field-input"
                  value={exportForm.format}
                  disabled={isExporting}
                  onChange={(event) =>
                    setExportForm((prev) => ({
                      ...prev,
                      format: event.target.value as AudioExportFormat,
                    }))
                  }
                >
                  <option value="mp3">MP3 (compressed)</option>
                  <option value="wav">WAV (lossless)</option>
                </select>
              </label>
              {exportForm.format === "mp3" ? (
                <label>
                  <div className="label-line">
                    MP3 Bitrate:
                    <span>{exportForm.bitrateKbps} kbps</span>
                  </div>
                  <input
                    type="range"
                    min={64}
                    max={320}
                    step={32}
                    value={exportForm.bitrateKbps}
                    disabled={isExporting}
                    onChange={(event) =>
                      setExportForm((prev) => ({
                        ...prev,
                        bitrateKbps: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              ) : null}
              {exportProgress ? (
                <div className="export-status">
                  {exportProgress.message} ({Math.round(exportProgress.percent)}%)
                </div>
              ) : null}
              {exportError ? <div className="error">{exportError}</div> : null}
            </div>
            <div className="modal-footer">
              <button
                className="tab-btn"
                type="button"
                onClick={() => setIsExportOpen(false)}
                disabled={isExporting}
              >
                Cancel
              </button>
              <button
                className="tab-btn"
                type="button"
                onClick={() => void onExportJukeboxAudio()}
                disabled={isExporting}
              >
                {isExporting ? "Exporting..." : "Export Audio"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isTuningOpen ? (
        <div className="modal open" onClick={(event) => event.target === event.currentTarget && setIsTuningOpen(false)}>
          <div className="modal-panel">
            <div className="modal-header">
              <h2>Tuning</h2>
              <button className="modal-close" type="button" onClick={() => setIsTuningOpen(false)} aria-label="Close">
                <SymbolIcon className="modal-close-icon" name="close" />
              </button>
            </div>
            <div className="modal-body">
              <label>
                <div className="label-line">
                  Branch Similarity Threshold:
                  <span>{tuneForm.threshold}</span>
                </div>
                <div className="hint">
                  Computed default threshold:
                  <span>{tuneForm.computedThreshold}</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={80}
                  step={2}
                  value={tuneForm.threshold}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, threshold: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <div className="label-line">
                  Branch Probability Min:
                  <span>{tuneForm.minProb}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={2}
                  value={tuneForm.minProb}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, minProb: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <div className="label-line">
                  Branch Probability Max:
                  <span>{tuneForm.maxProb}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={2}
                  value={tuneForm.maxProb}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, maxProb: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <div className="label-line">
                  Branch Ramp Speed:
                  <span>{tuneForm.ramp}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={2}
                  value={tuneForm.ramp}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, ramp: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <div className="label-line">
                  Volume:
                  <span>{tuneForm.volume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={2}
                  value={tuneForm.volume}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, volume: Number(event.target.value) }))
                  }
                />
              </label>
              <div className="checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={tuneForm.justBackwards}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, justBackwards: event.target.checked }))
                    }
                  />
                  Allow only reverse branches
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={tuneForm.justLongBranches}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, justLongBranches: event.target.checked }))
                    }
                  />
                  Allow only long branches
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={tuneForm.removeSequentialBranches}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, removeSequentialBranches: event.target.checked }))
                    }
                  />
                  Remove sequential branches
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={tuneForm.highlightAnchorBranch}
                    onChange={(event) =>
                      setTuneForm((prev) => ({
                        ...prev,
                        highlightAnchorBranch: event.target.checked,
                      }))
                    }
                  />
                  Highlight forced anchor jump
                </label>
              </div>
            </div>
            <div className="modal-footer tuning-footer">
              <button className="tab-btn" type="button" onClick={onResetTuning}>Reset</button>
              <button className="tab-btn" type="button" onClick={onApplyTuning}>Apply</button>
            </div>
          </div>
        </div>
      ) : null}

      {isInfoOpen ? (
        <div className="modal open" onClick={(event) => event.target === event.currentTarget && setIsInfoOpen(false)}>
          <div className="modal-panel">
            <div className="modal-header">
              <h2>Track Info</h2>
              <button className="modal-close" type="button" onClick={() => setIsInfoOpen(false)} aria-label="Close">
                <SymbolIcon className="modal-close-icon" name="close" />
              </button>
            </div>
            <div className="modal-body info-body">
              <div className="info-row">
                <span className="info-label">Song length:</span>
                <span>{formatDuration(analysis?.track?.duration ?? 0)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Total beats:</span>
                <span>{totalBeats}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Total branches:</span>
                <span>{totalBranches}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Deleted branches:</span>
                <span>{deletedBranches}</span>
              </div>
              <h4>Keyboard commands</h4>
              <div className="info-row">
                <span className="info-label">Space:</span>
                <span>Start/stop playback</span>
              </div>
              <div className="info-row">
                <span className="info-label">Shift (hold):</span>
                <span>Force branching while playing</span>
              </div>
              <div className="info-row">
                <span className="info-label">Delete:</span>
                <span>Remove selected branch</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

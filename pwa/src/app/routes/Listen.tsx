import React from "react";
import { Link } from "react-router-dom";
import { AnalysisWorkerClient } from "@/core/infrastructure/analysis/AnalysisWorkerClient";
import { AudioDecoder } from "@/core/infrastructure/audio/AudioDecoder";
import { createAnalysisCache } from "@/core/infrastructure/cache/analysisCache";
import { AnalyzeAudioUseCase, AnalyzeStage } from "@/core/application/usecases/analyzeAudio";
import { AnalysisOutput } from "@/shared/analysis-schema";
import { formatDuration } from "@/shared/utils/format";
import { APP_VERSION } from "@/shared/utils/appVersion";
import { formatExportJson, saveExportJson } from "@/shared/utils/exportJson";
import { BufferedAudioPlayer } from "@/shared/jukebox/audio/BufferedAudioPlayer";
import { Edge, JukeboxConfig, JukeboxEngine } from "@/shared/jukebox/engine";
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
  addLastEdge: true,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  minRandomBranchChance: 0.18,
  maxRandomBranchChance: 0.5,
  randomBranchChanceDelta: 0.1,
  minLongBranch: 0,
};

function buildAnalysisExportName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return `${base || "analysis"}.analysis.json`;
}

type TuneFormState = {
  threshold: number;
  computedThreshold: number;
  minProb: number;
  maxProb: number;
  ramp: number;
  volume: number;
  addLastEdge: boolean;
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
};

export function Listen() {
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
  const [activeVizIndex, setActiveVizIndex] = React.useState(0);
  const [tuneForm, setTuneForm] = React.useState<TuneFormState>({
    threshold: 0,
    computedThreshold: 0,
    minProb: Math.round(DEFAULT_CONFIG.minRandomBranchChance * 100),
    maxProb: Math.round(DEFAULT_CONFIG.maxRandomBranchChance * 100),
    ramp: Math.round(DEFAULT_CONFIG.randomBranchChanceDelta * 1000) / 10,
    volume: 50,
    addLastEdge: DEFAULT_CONFIG.addLastEdge,
    justBackwards: DEFAULT_CONFIG.justBackwards,
    justLongBranches: DEFAULT_CONFIG.justLongBranches,
    removeSequentialBranches: DEFAULT_CONFIG.removeSequentialBranches,
  });

  const vizPanelRef = React.useRef<HTMLDivElement | null>(null);
  const vizLayerRef = React.useRef<HTMLDivElement | null>(null);
  const vizControllerRef = React.useRef<JukeboxController | null>(null);
  const engineRef = React.useRef<JukeboxEngine | null>(null);
  const playerRef = React.useRef<BufferedAudioPlayer | null>(null);
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
    if (!vizLayerRef.current) {
      return;
    }
    const controller = new JukeboxController(vizLayerRef.current);
    vizControllerRef.current = controller;

    const resizeObserver = new ResizeObserver(() => {
      controller.resizeActive();
    });
    resizeObserver.observe(vizLayerRef.current);

    return () => {
      resizeObserver.disconnect();
      controller.reset();
      vizControllerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    setIsListenLoading(isAnalyzing);
    return () => {
      setIsListenLoading(false);
    };
  }, [isAnalyzing, setIsListenLoading]);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTuningOpen || isInfoOpen) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEdge && !selectedEdge.deleted) {
        event.preventDefault();
        deleteSelectedBranch();
        return;
      }
      if (event.key === "Shift" && isRunning) {
        engineRef.current?.setForceBranch(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        engineRef.current?.setForceBranch(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [selectedEdge, isRunning, isTuningOpen, isInfoOpen]);

  React.useEffect(() => {
    const onFullscreen = () => {
      const active = document.fullscreenElement === vizPanelRef.current;
      setIsFullscreen(active);
      vizControllerRef.current?.resizeActive();
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

  const initializeEngine = (analysisData: AnalysisOutput) => {
    if (!playerRef.current) {
      return;
    }
    const engine = new JukeboxEngine(playerRef.current);
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

    const vizData = engine.getVisualizationData();
    if (vizData) {
      vizControllerRef.current?.setData(vizData);
    }
    vizControllerRef.current?.setOnSelect((index) => {
      startFromBeat(index, analysisData);
    });
    vizControllerRef.current?.setOnEdgeSelect((edge) => {
      setSelectedEdge(edge);
      vizControllerRef.current?.setSelectedEdgeActive(edge);
    });
    const count = vizControllerRef.current?.getCount() ?? 1;
    setActiveVizIndex((prev) => Math.max(0, Math.min(prev, count - 1)));

    syncTuneFormFromEngine();
  };

  const syncTuneFormFromEngine = () => {
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
      addLastEdge: config.addLastEdge,
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

    engine.stopJukebox();
    if (lastPlayStampRef.current !== null) {
      playTimerMsRef.current += performance.now() - lastPlayStampRef.current;
      lastPlayStampRef.current = null;
    }
    setIsRunning(false);
  };

  const startFromBeat = (index: number, analysisData?: AnalysisOutput | null) => {
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
      addLastEdge: tuneForm.addLastEdge,
      justBackwards: tuneForm.justBackwards,
      justLongBranches: tuneForm.justLongBranches,
      removeSequentialBranches: tuneForm.removeSequentialBranches,
    });
    engine.rebuildGraph();
    const data = engine.getVisualizationData();
    if (data) {
      vizControllerRef.current?.setData(data);
    }
    player.setVolume(tuneForm.volume / 100);
    syncTuneFormFromEngine();
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
    syncTuneFormFromEngine();
    setIsTuningOpen(false);
  };

  const onDownloadAnalysis = async () => {
    const activeAnalysis = analysisRef.current ?? analysis;
    if (!activeAnalysis || !file) {
      return;
    }
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    const filename = buildAnalysisExportName(file.name);
    const metadata = {
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      fingerprint,
    };
    try {
      const json = formatExportJson(activeAnalysis, metadata);
      await saveExportJson(filename, json);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") {
        return;
      }
      console.warn(`Failed to export analysis JSON: ${String(err)}`);
      setError("Unable to download analysis JSON.");
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

      <div className="play-title">{file.name}</div>

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
              className="tune-toggle"
              type="button"
              onClick={() => {
                syncTuneFormFromEngine();
                setIsTuningOpen(true);
              }}
              disabled={!analysis}
              title="Tune"
              aria-label="Tune"
            >
              <SymbolIcon className="tune-icon" name="tune" />
            </button>
            <button
              id="track-info"
              className="info-toggle"
              type="button"
              onClick={() => setIsInfoOpen(true)}
              disabled={!analysis}
              title="Info"
              aria-label="Info"
            >
              <SymbolIcon className="info-icon" name="info" />
            </button>
            <button
              id="track-analysis"
              className="copy-toggle"
              type="button"
              onClick={() => void onDownloadAnalysis()}
              disabled={!analysis}
              title="Download analysis JSON"
              aria-label="Download analysis JSON"
            >
              <SymbolIcon className="copy-icon" name="download" />
            </button>
          </div>
        </div>
      ) : null}

      <div id="viz-panel" ref={vizPanelRef} hidden={!showPlaybackUi}>
        <div id="jukebox-viz" className="viz">
          <div id="viz-layer" className="viz-layer" ref={vizLayerRef} />
          <div className="viz-top">
            <div className="viz-controls">
              <span className="viz-label">Visualization:</span>
              {Array.from({ length: vizCount }, (_, index) => (
                <button
                  key={index}
                  className={`viz-btn ${index === activeVizIndex ? "active" : ""}`}
                  type="button"
                  onClick={() => onSetActiveViz(index)}
                >
                  {index + 1}
                </button>
              ))}
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
                <span className="play-text">{isRunning ? "Stop" : "Play"}</span>
              </button>
              <div className="viz-info">
                <div className="viz-title" id="viz-now-playing">{file.name}</div>
                <div className="viz-meta">
                  <span>Listen Time:</span>
                  <span>{formatDuration(listenSeconds)}</span>
                  <span className="viz-divider">·</span>
                  <span>Total Beats:</span>
                  <span>{beatsPlayed}</span>
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
                    checked={tuneForm.addLastEdge}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, addLastEdge: event.target.checked }))
                    }
                  />
                  Loop extension optimization
                </label>
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

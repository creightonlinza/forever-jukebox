import React from "react";
import "@/app/i18n";
import { Link } from "react-router-dom";
import { AnalysisWorkerClient } from "@/core/infrastructure/analysis/AnalysisWorkerClient";
import { AudioDecoder } from "@/core/infrastructure/audio/AudioDecoder";
import {
  createAnalysisCache,
  trimRenderedTracks,
} from "@/core/infrastructure/cache/analysisCache";
import {
  loadTuning,
  removeTuning,
  saveTuning,
} from "@/core/infrastructure/cache/tuningStore";
import { AnalyzeAudioUseCase, AnalyzeStage } from "@/core/application/usecases/analyzeAudio";
import { AnalysisOutput } from "@/shared/analysis-schema";
import {
  BufferedAudioPlayer,
  type JukeboxAudioMode,
} from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import { CowbellOverlayService } from "@forever-jukebox/shared/audio/CowbellOverlayService";
import {
  DEFAULT_AUDIO_MODE_INTENSITY,
  audioModeChangeAffectsPlayback,
  clampAudioModeIntensity,
} from "@forever-jukebox/shared/audio/audioModes";
import { getOrCreateSwingBuffer } from "@forever-jukebox/shared/audio/swingBufferCache";
import { renderSwingBuffer } from "@forever-jukebox/shared/audio/swingRenderer";
import {
  cancelInstrumentalRender,
  renderInstrumentalBuffer,
} from "@forever-jukebox/shared/audio/instrumentalRenderer";
import {
  DEFAULT_JUKEBOX_CONFIG,
  DEFAULT_MIN_LONG_BRANCH_PERCENT,
  Edge,
  findBackwardTwin,
  JukeboxEngine,
} from "@forever-jukebox/shared";
import {
  visualizationSeparatesPairedEdges,
} from "@forever-jukebox/shared/constants/visualization";
import {
  createToastQueue,
} from "@forever-jukebox/shared/ui/toastQueue";
import { AutocanonizerController } from "@forever-jukebox/shared/autocanonizer/AutocanonizerController";
import { WubMachineController } from "@forever-jukebox/shared/wubmachine/WubMachineController";
import {
  renderWubMachineBuffer,
  type WubMachineRender,
} from "@forever-jukebox/shared/wubmachine/wubMachineRender";
import { JukeboxController } from "@forever-jukebox/shared/viz/JukeboxController";
import { useAppState } from "../state/AppState";
import type { ProgressStep } from "@/ui/components/ProgressSteps";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { useMarquee } from "./listen/useMarquee";
import { useTranslation } from "react-i18next";
import { applyTheme, resolveStoredTheme, type ThemeName } from "../theme";
import type { PlayMode, TuningModalTab } from "./listen/types";
import {
  resolveAudioIntensityFromUrl,
  resolveAudioModeFromUrl,
  writeAudioModeToUrl,
} from "./listen/audioMode";
import {
  resolveStoredAnchorHighlight,
  resolveStoredBranchStatsEnabled,
  resolveStoredFinishOutSong,
  resolveStoredVisualizationIndex,
  resolveStoredWubMachineLoop,
  storeAnchorHighlight,
  storeBranchStatsEnabled,
  storeFinishOutSong,
  storeVisualizationIndex,
  storeWubMachineLoop,
} from "./listen/preferences";
import {
  STEP_ORDER,
  analysisStageLabel,
  formatTrackTitle,
  playControlIcon,
  playControlText,
  progressStepStatus,
  type PreparingAudioMode,
} from "./listen/labels";
import {
  RANDOM_BRANCH_DELTA_PERCENT_SCALE,
  type ExtrasFormState,
  type TuneFormState,
} from "./listen/tuning";
import { deriveBranchStats, nextEdgeIndex } from "./listen/branches";
import { createSessionSeed } from "./listen/browser";
import {
  ShortcutToastStack,
  type ShortcutToastQueue,
} from "./listen/ShortcutToastStack";
import { BranchStatsPopup } from "./listen/BranchStatsPopup";
import { ExportModal } from "./listen/ExportModal";
import { InfoModal } from "./listen/InfoModal";
import { PanPopover } from "./listen/PanPopover";
import { PlayMenu } from "./listen/PlayMenu";
import { SettingsModal } from "./listen/SettingsModal";
import { StatusPanel, type PreparingPhase } from "./listen/StatusPanel";
import { TuningModal } from "./listen/TuningModal";
import { VizInfo } from "./listen/VizInfo";
import { VizTop } from "./listen/VizTop";
import { VolumePopover } from "./listen/VolumePopover";
import { useAudioExport } from "./listen/useAudioExport";
import { useFullscreenSession } from "./listen/useFullscreenSession";
import { useListenHotkeys } from "./listen/useListenHotkeys";
import { useSleepTimer } from "./listen/useSleepTimer";
import { useVizPopovers } from "./listen/useVizPopovers";

const VIZ_CLASS_NAMES: Record<PlayMode, string> = {
  jukebox: "",
  autocanonizer: "is-canonizer",
  wubmachine: "is-wubmachine",
};

export function Listen({ isActive = true }: { isActive?: boolean }) {
  const { t } = useTranslation();
  const {
    file,
    setIsListenLoading,
    isSettingsOpen,
    setIsSettingsOpen,
  } = useAppState();
  const initialAudioMode = React.useMemo(() => resolveAudioModeFromUrl(), []);
  const initialAudioIntensity = React.useMemo(
    () => resolveAudioIntensityFromUrl(),
    [],
  );
  const [analysis, setAnalysis] = React.useState<AnalysisOutput | null>(null);
  const [readyFileKey, setReadyFileKey] = React.useState<string | null>(null);
  const [progressStage, setProgressStage] = React.useState<AnalyzeStage>("loading");
  const [progressMessage, setProgressMessage] = React.useState<string | null>(null);
  const [progressPercent, setProgressPercent] = React.useState<number | null>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const [isRunning, setIsRunning] = React.useState(false);
  const [isPaused, setIsPaused] = React.useState(false);
  const [beatsPlayed, setBeatsPlayed] = React.useState(0);
  const [listenSeconds, setListenSeconds] = React.useState(0);
  const [autocanonizerMainSeconds, setAutocanonizerMainSeconds] =
    React.useState(0);
  const [autocanonizerOtherSeconds, setAutocanonizerOtherSeconds] =
    React.useState(0);
  const [autocanonizerMainPan, setAutocanonizerMainPan] = React.useState(0);
  const [autocanonizerOtherPan, setAutocanonizerOtherPan] = React.useState(0);
  const [wubMachineSeconds, setWubMachineSeconds] = React.useState(0);
  const [wubMachineDurationSeconds, setWubMachineDurationSeconds] =
    React.useState(0);
  const [loopTrack, setLoopTrack] = React.useState<boolean>(() =>
    resolveStoredWubMachineLoop(),
  );
  const [selectedEdge, setSelectedEdge] = React.useState<Edge | null>(null);
  const [isTuningOpen, setIsTuningOpen] = React.useState(false);
  const [isInfoOpen, setIsInfoOpen] = React.useState(false);
  const {
    sleepTimer,
    pendingSleepTimerDurationMs,
    setPendingSleepTimerDurationMs,
    setSleepTimer,
  } = useSleepTimer({ isSettingsOpen, onExpire: stopPlayback });
  const [theme, setTheme] = React.useState<ThemeName>(() =>
    resolveStoredTheme(),
  );
  const [bringItHomeMode, setBringItHomeMode] = React.useState(false);
  const [branchStatsEnabled, setBranchStatsEnabled] = React.useState<boolean>(
    () => resolveStoredBranchStatsEnabled(),
  );
  const [jukeboxAudioMode, setJukeboxAudioMode] =
    React.useState<JukeboxAudioMode>(initialAudioMode);
  const [audioIntensity, setAudioIntensity] = React.useState(
    initialAudioIntensity,
  );
  // Swing and Instrumental pre-render their buffers; one render at a time.
  const [preparingMode, setPreparingMode] =
    React.useState<PreparingAudioMode>(null);
  const [preparingPhase, setPreparingPhase] =
    React.useState<PreparingPhase>(null);
  const [preparingProgress, setPreparingProgress] = React.useState(0);
  const [tuningActiveTab, setTuningActiveTab] =
    React.useState<TuningModalTab>("tuning");
  const [activeVizIndex, setActiveVizIndex] = React.useState(() =>
    resolveStoredVisualizationIndex(),
  );
  const [playMode, setPlayMode] = React.useState<PlayMode>("jukebox");
  const [highlightAnchorBranch, setHighlightAnchorBranch] = React.useState<boolean>(
    () => resolveStoredAnchorHighlight(),
  );
  const [finishOutSong, setFinishOutSong] = React.useState<boolean>(() =>
    resolveStoredFinishOutSong(),
  );
  const [tuneForm, setTuneForm] = React.useState<TuneFormState>({
    threshold: 0,
    computedThreshold: 0,
    minProb: Math.round(DEFAULT_JUKEBOX_CONFIG.minRandomBranchChance * 100),
    maxProb: Math.round(DEFAULT_JUKEBOX_CONFIG.maxRandomBranchChance * 100),
    ramp:
      Math.round(
        DEFAULT_JUKEBOX_CONFIG.randomBranchChanceDelta *
          RANDOM_BRANCH_DELTA_PERCENT_SCALE *
          10,
      ) / 10,
    volume: 100,
    highlightAnchorBranch,
    justBackwards: DEFAULT_JUKEBOX_CONFIG.justBackwards,
    minLongBranchPercent: 0,
    removeSequentialBranches: DEFAULT_JUKEBOX_CONFIG.removeSequentialBranches,
  });
  const [extrasForm, setExtrasForm] = React.useState<ExtrasFormState>({
    branchStatsEnabled: resolveStoredBranchStatsEnabled(),
    bringItHomeMode: false,
    audioMode: initialAudioMode,
    audioIntensity: initialAudioIntensity,
  });

  const vizPanelRef = React.useRef<HTMLDivElement | null>(null);
  const vizLayerRef = React.useRef<HTMLDivElement | null>(null);
  const canonizerLayerRef = React.useRef<HTMLDivElement | null>(null);
  const wubMachineLayerRef = React.useRef<HTMLDivElement | null>(null);
  const vizControllerRef = React.useRef<JukeboxController | null>(null);
  const autocanonizerRef = React.useRef<AutocanonizerController | null>(null);
  const wubmachineRef = React.useRef<WubMachineController | null>(null);
  // The loaded track's remix, kept across mode switches until the track changes.
  const wubMachineRenderRef = React.useRef<WubMachineRender | null>(null);
  const wubMachineAbortRef = React.useRef<AbortController | null>(null);
  const engineRef = React.useRef<JukeboxEngine | null>(null);
  const playerRef = React.useRef<BufferedAudioPlayer | null>(null);
  const cowbellOverlayRef = React.useRef<CowbellOverlayService | null>(null);
  const isRunningRef = React.useRef(false);
  const isPausedRef = React.useRef(false);
  const playModeRef = React.useRef<PlayMode>("jukebox");
  const bringItHomeModeRef = React.useRef(false);
  // Read by the hotkey handlers, which are registered by an effect that does
  // not re-run when the visualization changes.
  const activeVizIndexRef = React.useRef(activeVizIndex);
  // Last data pushed to the viz controller; every edge mutation funnels
  // through syncVizDataFromEngine, so this is as fresh as the viz itself.
  const vizDataRef = React.useRef<ReturnType<
    JukeboxEngine["getVisualizationData"]
  > | null>(null);
  const lastBeatRef = React.useRef<number | null>(null);
  const lastCowbellBeatsPlayedRef = React.useRef<number | null>(null);
  const autocanonizerMainPanRef = React.useRef(0);
  const autocanonizerOtherPanRef = React.useRef(0);
  const renderTokenRef = React.useRef(0);
  const preparingModeRef = React.useRef<PreparingAudioMode>(null);
  const playTimerMsRef = React.useRef(0);
  const lastPlayStampRef = React.useRef<number | null>(null);
  const analysisRef = React.useRef<AnalysisOutput | null>(null);
  const fingerprintRef = React.useRef<string | null>(null);
  const previousFileKeyRef = React.useRef<string | null>(null);
  const {
    isVolumeOpen,
    isPanOpen,
    toggleVolume,
    togglePan,
    volumeButtonRef,
    volumePanelRef,
    panButtonRef,
    panPanelRef,
  } = useVizPopovers({ playMode });
  const { isFullscreen, onToggleFullscreen, requestWakeLockIfFullscreen } =
    useFullscreenSession({
      vizPanelRef,
      vizControllerRef,
      autocanonizerRef,
      wubmachineRef,
      playModeRef,
    });
  const {
    isExportOpen,
    isExporting,
    exportError,
    exportProgress,
    exportForm,
    setExportForm,
    openExport,
    closeExport,
    resetExport,
    handleExportJukeboxAudio,
  } = useAudioExport({
    file,
    analysis,
    analysisRef,
    playerRef,
    engineRef,
    playMode,
    jukeboxAudioMode,
    audioIntensity,
    getSourceIdentity: getCurrentSourceIdentity,
    getRenderedTrackId: () => fingerprintRef.current,
    getWubMachineRender: () => wubMachineRenderRef.current,
    renderWubMachine: renderWubMachineForExport,
    t,
  });

  // The queue owns stacking/dedupe/timers; ShortcutToastStack subscribes to
  // it directly so toast churn does not re-render this route.
  const shortcutToastQueueRef = React.useRef<ShortcutToastQueue | null>(null);
  if (shortcutToastQueueRef.current === null) {
    shortcutToastQueueRef.current = createToastQueue<{ message: string }>();
  }
  const shortcutToastQueue = shortcutToastQueueRef.current;

  const showShortcutToast = React.useCallback(
    (message: string, key?: string) => {
      shortcutToastQueue.show({ message }, key);
    },
    [shortcutToastQueue],
  );

  function setPreparingState(mode: PreparingAudioMode) {
    preparingModeRef.current = mode;
    setPreparingMode(mode);
    setPreparingPhase(null);
    setPreparingProgress(0);
  }

  // Invalidates any render in flight; its completion is then ignored.
  function stopPreparing() {
    renderTokenRef.current += 1;
    cancelInstrumentalRender();
    wubMachineAbortRef.current?.abort();
    wubMachineAbortRef.current = null;
    setPreparingState(null);
  }

  // The audio-mode reset shared by track changes and the extras reset:
  // player, mode/intensity state, extras form, and URL all return to "off"
  // at default intensity.
  function resetAudioModeToOff(player: BufferedAudioPlayer) {
    cowbellOverlayRef.current?.disable();
    stopPreparing();
    setJukeboxAudioMode("off");
    setAudioIntensity(DEFAULT_AUDIO_MODE_INTENSITY);
    setExtrasForm((prev) =>
      prev.audioMode === "off" &&
      prev.audioIntensity === DEFAULT_AUDIO_MODE_INTENSITY
        ? prev
        : {
            ...prev,
            audioMode: "off",
            audioIntensity: DEFAULT_AUDIO_MODE_INTENSITY,
          },
    );
    player.setJukeboxAudioMode("off", DEFAULT_AUDIO_MODE_INTENSITY);
    writeAudioModeToUrl("off", DEFAULT_AUDIO_MODE_INTENSITY, true);
  }

  function resetPlaybackSessionMetrics() {
    playTimerMsRef.current = 0;
    lastPlayStampRef.current = null;
    lastBeatRef.current = null;
    lastCowbellBeatsPlayedRef.current = null;
    setListenSeconds(0);
    setBeatsPlayed(0);
    setAutocanonizerMainSeconds(0);
    setAutocanonizerOtherSeconds(0);
    setWubMachineSeconds(0);
  }

  function clearSelectedBranch() {
    setSelectedEdge(null);
    vizControllerRef.current?.setSelectedEdge(null);
  }

  function syncVizDataFromEngine() {
    const data = engineRef.current?.getVisualizationData();
    if (data) {
      vizControllerRef.current?.setData(data);
    }
    vizDataRef.current = data ?? null;
    return data ?? null;
  }

  function rebuildGraphAndSyncViz() {
    const engine = engineRef.current;
    if (!engine) {
      return null;
    }
    engine.rebuildGraph();
    return syncVizDataFromEngine();
  }

  React.useEffect(() => {
    const player = new BufferedAudioPlayer();
    const cowbellOverlay = new CowbellOverlayService(player.getContext(), {
      getPlaybackRate: () => player.getPlaybackRate(),
    });
    cowbellOverlay.setVolume(player.getVolume());
    playerRef.current = player;
    cowbellOverlayRef.current = cowbellOverlay;
    if (jukeboxAudioMode === "cowbell") {
      cowbellOverlay.enable();
      player.setJukeboxAudioMode("cowbell", audioIntensity);
    } else if (
      jukeboxAudioMode !== "swing" &&
      jukeboxAudioMode !== "instrumental"
    ) {
      player.setJukeboxAudioMode(jukeboxAudioMode, audioIntensity);
    }
    return () => {
      cowbellOverlayRef.current?.dispose();
      cowbellOverlayRef.current = null;
      const activePlayer = playerRef.current;
      if (activePlayer) {
        activePlayer.dispose().catch((err) => {
          console.warn(`Audio player dispose failed: ${String(err)}`);
        });
      }
      playerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    vizControllerRef.current?.setActiveIndex(activeVizIndex);
  }, [activeVizIndex]);

  React.useEffect(() => {
    storeVisualizationIndex(activeVizIndex);
  }, [activeVizIndex]);

  React.useEffect(() => {
    if (
      !vizLayerRef.current ||
      !canonizerLayerRef.current ||
      !wubMachineLayerRef.current
    ) {
      return;
    }
    const controller = new JukeboxController(vizLayerRef.current);
    const autocanonizer = new AutocanonizerController(canonizerLayerRef.current);
    const wubmachine = new WubMachineController(wubMachineLayerRef.current);
    vizControllerRef.current = controller;
    autocanonizerRef.current = autocanonizer;
    wubmachineRef.current = wubmachine;

    controller.setActiveIndex(activeVizIndex);
    controller.setVisible(playModeRef.current === "jukebox");
    controller.setAnchorHighlightEnabled(highlightAnchorBranch);
    autocanonizer.setVisible(playModeRef.current === "autocanonizer");
    autocanonizer.setFinishOutSong(finishOutSong);
    autocanonizer.setStreamPans(
      autocanonizerMainPanRef.current / 100,
      autocanonizerOtherPanRef.current / 100,
    );
    autocanonizer.setOnBeat((index, _beat, cursorTimes) => {
      setBeatsPlayed(index + 1);
      lastBeatRef.current = index;
      setAutocanonizerMainSeconds(cursorTimes.mainSeconds);
      setAutocanonizerOtherSeconds(cursorTimes.otherSeconds);
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
      startAutocanonizerPlayback(index, { resetSession: false });
    });

    wubmachine.setVisible(playModeRef.current === "wubmachine");
    wubmachine.setLoop(loopTrack);
    wubmachine.setVolume(playerRef.current?.getVolume() ?? 1);
    wubmachine.setOnTick((seconds) => {
      // Fires every frame; the display only changes once a second.
      setWubMachineSeconds((prev) =>
        prev === Math.floor(seconds) ? prev : Math.floor(seconds),
      );
    });
    wubmachine.setOnEnded(() => {
      if (!isRunningRef.current) {
        return;
      }
      stopPlayback();
    });
    wubmachine.setOnSelect((seconds) => {
      if (playModeRef.current !== "wubmachine") {
        return;
      }
      startWubMachinePlayback(seconds, { resetSession: false });
    });
    const render = wubMachineRenderRef.current;
    if (render) {
      wubmachine.setRemix(
        render.buffer,
        playerRef.current?.getContext() ?? null,
        render.parts,
      );
    }

    const resizeObserver = new ResizeObserver(() => {
      controller.resizeActive();
      autocanonizer.resizeNow();
      wubmachine.resizeNow();
    });
    resizeObserver.observe(vizPanelRef.current ?? vizLayerRef.current);

    return () => {
      resizeObserver.disconnect();
      controller.destroy();
      autocanonizer.destroy();
      wubmachine.destroy();
      vizControllerRef.current = null;
      autocanonizerRef.current = null;
      wubmachineRef.current = null;
    };
  }, [file]);

  React.useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  React.useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  React.useEffect(() => {
    return () => {
      shortcutToastQueue.clear();
    };
  }, [shortcutToastQueue]);

  React.useEffect(() => {
    bringItHomeModeRef.current = bringItHomeMode;
  }, [bringItHomeMode]);

  React.useEffect(() => {
    activeVizIndexRef.current = activeVizIndex;
  }, [activeVizIndex]);

  React.useEffect(() => {
    playModeRef.current = playMode;
    vizControllerRef.current?.setVisible(playMode === "jukebox");
    autocanonizerRef.current?.setVisible(playMode === "autocanonizer");
    wubmachineRef.current?.setVisible(playMode === "wubmachine");
    if (playMode === "autocanonizer") {
      autocanonizerRef.current?.resizeNow();
    } else if (playMode === "wubmachine") {
      wubmachineRef.current?.resizeNow();
    } else {
      vizControllerRef.current?.resizeActive();
    }
  }, [playMode]);

  React.useEffect(() => {
    storeWubMachineLoop(loopTrack);
    wubmachineRef.current?.setLoop(loopTrack);
  }, [loopTrack]);

  React.useEffect(() => {
    storeFinishOutSong(finishOutSong);
    autocanonizerRef.current?.setFinishOutSong(finishOutSong);
  }, [finishOutSong]);

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
    const currentFileKey = `${file.name}:${file.size}:${file.lastModified}`;
    const previousFileKey = previousFileKeyRef.current;
    const isTrackChange = previousFileKey !== null && previousFileKey !== currentFileKey;
    previousFileKeyRef.current = currentFileKey;
    if (isTrackChange) {
      cowbellOverlayRef.current?.setSectionStartBeatIndices([]);
      resetAudioModeToOff(playerRef.current);
    }

    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    let cancelled = false;

    const analysisPort = new AnalysisWorkerClient();
    const cache = createAnalysisCache();
    const decoder = new AudioDecoder(playerRef.current.getContext());
    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);

    engineRef.current?.stopJukebox();
    engineRef.current?.setFreezeCurrentBeat(false);
    engineRef.current?.setPlayVelocity(1);
    engineRef.current?.setBringItHomeMode(false);
    autocanonizerRef.current?.stop();
    stopPreparing();
    wubMachineRenderRef.current = null;
    wubmachineRef.current?.setRemix(null, null);
    setWubMachineDurationSeconds(0);
    resetPlaybackSessionMetrics();
    setIsRunning(false);
    setIsPaused(false);
    setBringItHomeMode(false);

    setIsAnalyzing(true);
    setError(null);
    setProgressPercent(0);
    setAnalysis(null);
    setReadyFileKey(null);
    analysisRef.current = null;
    fingerprintRef.current = null;
    clearSelectedBranch();
    resetExport();

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
          setProgressMessage(analysisStageLabel(progress.stage, t));
        },
      })
      .then(async (result) => {
        if (cancelled) {
          return;
        }
        analysisRef.current = result.analysis;
        fingerprintRef.current = result.fingerprint;
        trimRenderedTracks(result.fingerprint).catch((err: unknown) => {
          console.warn(`Rendered track trim failed: ${String(err)}`);
        });
        setAnalysis(result.analysis);
        setReadyFileKey(fileKey);
        await playerRef.current?.loadBuffer(result.audioBuffer);
        autocanonizerRef.current?.setAudio(
          playerRef.current?.getSourceBuffer() ?? null,
          playerRef.current?.getContext() ?? null
        );
        initializeEngine(result.analysis);
        restoreSavedTuning(result.fingerprint);
        if (jukeboxAudioMode === "cowbell") {
          cowbellOverlayRef.current?.enable();
        }
        if (jukeboxAudioMode === "swing") {
          playerRef.current?.setJukeboxAudioMode("swing");
          maybePrepareSwingMode();
        }
        if (jukeboxAudioMode === "instrumental") {
          playerRef.current?.setJukeboxAudioMode("instrumental");
          maybePrepareInstrumentalMode();
        }
        maybePrepareWubMachine();
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.warn(`Audio analysis failed: ${String(err)}`);
        setError(t("analysis.failed"));
      })
      .finally(() => {
        if (!cancelled) {
          setIsAnalyzing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file, t]);

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

  function stopPlayback() {
    cowbellOverlayRef.current?.cancelScheduledHits();
    if (playModeRef.current === "autocanonizer") {
      autocanonizerRef.current?.stop();
      playerRef.current?.stop();
      autocanonizerRef.current?.resetVisualization();
    }
    wubmachineRef.current?.stop();
    engineRef.current?.stopJukebox();
    engineRef.current?.resetStats();
    resetPlaybackSessionMetrics();
    vizControllerRef.current?.reset();
    if (bringItHomeModeRef.current) {
      bringItHomeModeRef.current = false;
      setBringItHomeMode(false);
      engineRef.current?.setBringItHomeMode(false);
    }
    setIsRunning(false);
    setIsPaused(false);
    isRunningRef.current = false;
    isPausedRef.current = false;
  }

  React.useEffect(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    player.setOnEnded(() => {
      if (!isRunningRef.current) {
        return;
      }
      if (playModeRef.current === "jukebox" && !bringItHomeModeRef.current) {
        // Recover if audio reaches buffer end before the scheduled wrap jump.
        startFromBeat(0);
        if (!player.isPlaying()) {
          engineRef.current?.play();
        }
        return;
      }
      stopPlayback();
    });
    return () => {
      player.setOnEnded(null);
    };
  }, []);

  const onSetPlayMode = (mode: PlayMode) => {
    if (playMode === mode) {
      return;
    }
    if (isRunningRef.current || isPausedRef.current) {
      stopPlayback();
    }
    if (playModeRef.current === "wubmachine") {
      cancelWubMachineRender();
    }
    playModeRef.current = mode;
    setPlayMode(mode);
    setAutocanonizerMainSeconds(0);
    setAutocanonizerOtherSeconds(0);
    setWubMachineSeconds(0);
    if (mode !== "jukebox") {
      setIsTuningOpen(false);
      setIsInfoOpen(false);
      setTuningActiveTab("tuning");
      clearSelectedBranch();
    }
    if (mode === "wubmachine") {
      maybePrepareWubMachine();
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
    engine.setBringItHomeMode(bringItHomeModeRef.current);
    cowbellOverlayRef.current?.setSectionStartBeatIndices(
      engine.getSectionStartBeatIndices(),
    );
    engine.onUpdate((state) => {
      setBeatsPlayed(state.beatsPlayed);
      if (state.currentBeatIndex >= 0) {
        if (state.beatsPlayed !== lastCowbellBeatsPlayedRef.current) {
          lastCowbellBeatsPlayedRef.current = state.beatsPlayed;
          const beat = analysisData.beats[state.currentBeatIndex];
          if (beat) {
            cowbellOverlayRef.current?.handleBeatEnter(
              state.currentBeatIndex,
              beat,
              analysisData.beats[state.currentBeatIndex + 1],
            );
          }
        }
        const highlightJump =
          state.lastJumped && engine.getLastJumpWasBranch();
        const jumpFrom =
          highlightJump && state.lastJumpFromIndex !== null
            ? state.lastJumpFromIndex
            : lastBeatRef.current;
        const jumpTo =
          highlightJump && typeof state.lastJumpToIndex === "number"
            ? state.lastJumpToIndex
            : state.currentBeatIndex;
        vizControllerRef.current?.update(jumpTo, highlightJump, jumpFrom);
        if (jumpTo !== state.currentBeatIndex) {
          vizControllerRef.current?.update(state.currentBeatIndex, false, jumpTo);
        }
        lastBeatRef.current = state.currentBeatIndex;
      }
    });
    engineRef.current = engine;
    autocanonizerRef.current?.setAnalysis(analysisData, analysisData.track?.duration);

    syncVizDataFromEngine();
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
      ramp:
        Math.round(
          config.randomBranchChanceDelta *
            RANDOM_BRANCH_DELTA_PERCENT_SCALE *
            10,
        ) / 10,
      volume: Math.round(player.getVolume() * 100),
      highlightAnchorBranch: nextHighlightAnchorBranch,
      justBackwards: config.justBackwards,
      minLongBranchPercent: config.justLongBranches
        ? (config.minLongBranchPercent ?? DEFAULT_MIN_LONG_BRANCH_PERCENT)
        : 0,
      removeSequentialBranches: config.removeSequentialBranches,
    });
  };

  const persistCurrentTuning = () => {
    const engine = engineRef.current;
    const fingerprint = fingerprintRef.current;
    if (!engine || !fingerprint) {
      return;
    }
    const config = engine.getConfig();
    const deletedEdgeIds =
      engine
        .getGraphState()
        ?.allEdges.filter((edge) => edge.deleted)
        .map((edge) => edge.id) ?? [];
    saveTuning(fingerprint, {
      v: 1,
      config: {
        currentThreshold: config.currentThreshold,
        justBackwards: config.justBackwards,
        justLongBranches: config.justLongBranches,
        removeSequentialBranches: config.removeSequentialBranches,
        minRandomBranchChance: config.minRandomBranchChance,
        maxRandomBranchChance: config.maxRandomBranchChance,
        randomBranchChanceDelta: config.randomBranchChanceDelta,
        minLongBranchPercent: config.minLongBranchPercent,
      },
      deletedEdgeIds,
      anchorEdgeId: engine.getUserAnchorEdgeId(),
    });
  };

  const restoreSavedTuning = (fingerprint: string) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    const saved = loadTuning(fingerprint);
    if (!saved) {
      return;
    }
    engine.updateConfig(saved.config);
    engine.clearDeletedEdges();
    engine.rebuildGraph();
    const allEdges = engine.getGraphState()?.allEdges ?? [];
    for (const id of saved.deletedEdgeIds) {
      const edge = allEdges.find((candidate) => candidate.id === id);
      if (edge) {
        engine.deleteEdge(edge);
      }
    }
    if (saved.anchorEdgeId !== null) {
      const anchorEdge = allEdges.find(
        (candidate) => candidate.id === saved.anchorEdgeId,
      );
      if (anchorEdge) {
        engine.setUserAnchorEdge(anchorEdge);
      }
    }
    syncVizDataFromEngine();
    syncTuneFormFromEngine();
  };

  const syncExtrasFormFromState = React.useCallback(() => {
    setExtrasForm({
      branchStatsEnabled,
      bringItHomeMode,
      audioMode: jukeboxAudioMode,
      audioIntensity,
    });
  }, [branchStatsEnabled, bringItHomeMode, jukeboxAudioMode, audioIntensity]);

  function getCurrentSourceIdentity() {
    return file ? `${file.name}:${file.size}:${file.lastModified}` : null;
  }

  function canPrepareSwingMode() {
    const player = playerRef.current;
    const activeAnalysis = analysisRef.current;
    return (
      playModeRef.current === "jukebox" &&
      player !== null &&
      player.getSourceBuffer() !== null &&
      Boolean(activeAnalysis?.beats.length)
    );
  }

  function isPlaybackBlockedForAudioMode() {
    if (playModeRef.current === "wubmachine") {
      return preparingModeRef.current === "wubmachine";
    }
    return (
      playModeRef.current === "jukebox" &&
      preparingModeRef.current !== null &&
      preparingModeRef.current === jukeboxAudioMode
    );
  }

  function showPreparingToast() {
    showShortcutToast(
      t(
        playModeRef.current === "wubmachine"
          ? "listen.preparingWubMachineEllipsis"
          : jukeboxAudioMode === "instrumental"
            ? "listen.preparingInstrumentalEllipsis"
            : "listen.preparingSwingEllipsis",
      ),
    );
  }

  // Stops a Wub Machine render in flight; a finished remix is kept.
  function cancelWubMachineRender() {
    if (!wubMachineAbortRef.current) {
      return;
    }
    wubMachineAbortRef.current.abort();
    wubMachineAbortRef.current = null;
    if (preparingModeRef.current === "wubmachine") {
      setPreparingState(null);
    }
  }

  // Renders the loaded track's remix once, while Wub Machine mode is selected.
  function maybePrepareWubMachine() {
    const player = playerRef.current;
    const sourceBuffer = player?.getSourceBuffer();
    if (
      playModeRef.current !== "wubmachine" ||
      !player ||
      !sourceBuffer ||
      !analysisRef.current ||
      wubMachineRenderRef.current ||
      wubMachineAbortRef.current
    ) {
      return;
    }
    const abort = new AbortController();
    wubMachineAbortRef.current = abort;
    const renderToken = renderTokenRef.current + 1;
    renderTokenRef.current = renderToken;
    setPreparingState("wubmachine");
    const isStale = () =>
      wubMachineAbortRef.current !== abort ||
      renderTokenRef.current !== renderToken;

    renderWubMachineBuffer(sourceBuffer, player.getContext(), analysisRef.current, {
      trackId: fingerprintRef.current,
      signal: abort.signal,
      onProgress: (progress) => {
        if (!isStale()) {
          setPreparingProgress(
            Math.max(0, Math.min(100, Math.round(progress * 100))),
          );
        }
      },
    })
      .then((render) => {
        if (isStale()) {
          return;
        }
        wubMachineAbortRef.current = null;
        wubMachineRenderRef.current = render;
        wubmachineRef.current?.setRemix(
          render.buffer,
          player.getContext(),
          render.parts,
        );
        setWubMachineSeconds(0);
        setWubMachineDurationSeconds(render.buffer.duration);
        setPreparingState(null);
      })
      .catch((err: unknown) => {
        if (isStale()) {
          return;
        }
        wubMachineAbortRef.current = null;
        console.warn(`Wub Machine render failed: ${String(err)}`);
        setPreparingState(null);
        showShortcutToast(t("listen.wubMachineFailed"));
      });
  }

  // Export renders a fresh copy when it must not reuse the stored one.
  async function renderWubMachineForExport(
    storeCopy: boolean,
    onProgress: (progress: number) => void,
  ) {
    const player = playerRef.current;
    const sourceBuffer = player?.getSourceBuffer();
    if (!player || !sourceBuffer || !analysisRef.current) {
      throw new Error("Wub Machine export needs a loaded track.");
    }
    const render = await renderWubMachineBuffer(
      sourceBuffer,
      player.getContext(),
      analysisRef.current,
      { trackId: storeCopy ? fingerprintRef.current : null, onProgress },
    );
    if (!wubMachineRenderRef.current) {
      wubMachineRenderRef.current = render;
      wubmachineRef.current?.setRemix(
        render.buffer,
        player.getContext(),
        render.parts,
      );
      setWubMachineDurationSeconds(render.buffer.duration);
    }
    return render;
  }

  function maybePrepareSwingMode() {
    if (jukeboxAudioMode !== "swing" || !canPrepareSwingMode()) {
      return;
    }
    prepareSwingMode();
  }

  function prepareSwingMode() {
    const player = playerRef.current;
    const sourceBuffer = player?.getSourceBuffer();
    const beats = analysisRef.current?.beats;
    if (
      player?.getJukeboxAudioMode() !== "swing" ||
      !sourceBuffer ||
      !beats?.length
    ) {
      return;
    }
    const resumeAfterPrepare = isRunningRef.current;
    if (isRunningRef.current) {
      pausePlayback();
    }
    const renderToken = renderTokenRef.current + 1;
    renderTokenRef.current = renderToken;
    setPreparingState("swing");

    getOrCreateSwingBuffer(sourceBuffer, getCurrentSourceIdentity(), () =>
      renderSwingBuffer(sourceBuffer, beats, {
        trackId: fingerprintRef.current,
        onProgress: (progress) => {
          if (
            renderTokenRef.current !== renderToken ||
            playerRef.current?.getJukeboxAudioMode() !== "swing"
          ) {
            return;
          }
          setPreparingProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
        },
      }),
    )
      .then((buffer) => {
        if (
          renderTokenRef.current !== renderToken ||
          playerRef.current?.getJukeboxAudioMode() !== "swing"
        ) {
          return;
        }
        setPreparingState(null);
        player.setRenderedJukeboxAudioBuffer("swing", buffer);
        player.setJukeboxAudioMode("swing");
        if (
          playModeRef.current === "jukebox" &&
          (isRunningRef.current || isPausedRef.current)
        ) {
          engineRef.current?.syncToPlaybackPosition();
        }
        if (
          resumeAfterPrepare &&
          playModeRef.current === "jukebox" &&
          playerRef.current?.getJukeboxAudioMode() === "swing" &&
          !isRunningRef.current
        ) {
          startJukeboxPlayback(false);
        }
      })
      .catch((err: unknown) => {
        if (renderTokenRef.current !== renderToken) {
          return;
        }
        console.warn(`Swing render failed: ${String(err)}`);
        resetAudioModeToOff(player);
        showShortcutToast(t("listen.swingFailed"));
      });
  }

  function canPrepareInstrumentalMode() {
    const player = playerRef.current;
    return (
      playModeRef.current === "jukebox" &&
      player !== null &&
      player.getSourceBuffer() !== null &&
      analysisRef.current !== null
    );
  }

  function maybePrepareInstrumentalMode() {
    if (jukeboxAudioMode !== "instrumental" || !canPrepareInstrumentalMode()) {
      return;
    }
    prepareInstrumentalMode();
  }

  function prepareInstrumentalMode() {
    const player = playerRef.current;
    const sourceBuffer = player?.getSourceBuffer();
    if (player?.getJukeboxAudioMode() !== "instrumental" || !sourceBuffer) {
      return;
    }
    const resumeAfterPrepare = isRunningRef.current;
    if (isRunningRef.current) {
      pausePlayback();
    }
    const renderToken = renderTokenRef.current + 1;
    renderTokenRef.current = renderToken;
    setPreparingState("instrumental");
    const isStale = () =>
      renderTokenRef.current !== renderToken ||
      playerRef.current?.getJukeboxAudioMode() !== "instrumental";

    renderInstrumentalBuffer(
      sourceBuffer,
      fingerprintRef.current,
      ({ phase, progress }) => {
        if (isStale()) {
          return;
        }
        setPreparingPhase(phase);
        setPreparingProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
      },
    )
      .then((buffer) => {
        if (isStale()) {
          return;
        }
        setPreparingState(null);
        player.setRenderedJukeboxAudioBuffer("instrumental", buffer);
        player.setJukeboxAudioMode("instrumental");
        if (
          playModeRef.current === "jukebox" &&
          (isRunningRef.current || isPausedRef.current)
        ) {
          engineRef.current?.syncToPlaybackPosition();
        }
        if (
          resumeAfterPrepare &&
          playModeRef.current === "jukebox" &&
          !isRunningRef.current
        ) {
          startJukeboxPlayback(false);
        }
      })
      .catch((err: unknown) => {
        if (renderTokenRef.current !== renderToken) {
          return;
        }
        console.warn(`Instrumental render failed: ${String(err)}`);
        resetAudioModeToOff(player);
        showShortcutToast(t("listen.instrumentalFailed"));
      });
  }

  const openTuningModalTab = (tab: TuningModalTab) => {
    if (playModeRef.current !== "jukebox") {
      return;
    }
    syncTuneFormFromEngine();
    syncExtrasFormFromState();
    setTuningActiveTab(tab);
    setIsTuningOpen(true);
  };

  const pausePlayback = () => {
    const player = playerRef.current;
    const engine = engineRef.current;
    if (!player || !engine || !isRunningRef.current) {
      return;
    }
    cowbellOverlayRef.current?.cancelScheduledHits();
    if (playModeRef.current === "autocanonizer") {
      autocanonizerRef.current?.stop();
      player.stop();
    } else if (playModeRef.current === "wubmachine") {
      wubmachineRef.current?.pause();
    } else {
      engine.pauseJukebox();
      engine.syncToPlaybackPosition();
    }
    if (lastPlayStampRef.current !== null) {
      playTimerMsRef.current += performance.now() - lastPlayStampRef.current;
      lastPlayStampRef.current = null;
    }
    isRunningRef.current = false;
    isPausedRef.current = true;
    setIsRunning(false);
    setIsPaused(true);
  };

  const startJukeboxPlayback = (resetSession: boolean) => {
    const player = playerRef.current;
    const engine = engineRef.current;
    if (!player || !engine || !analysisRef.current) {
      return;
    }
    if (isPlaybackBlockedForAudioMode()) {
      showPreparingToast();
      return;
    }
    if (!player.getBuffer()) {
      console.warn("Audio not loaded");
      stopPlayback();
      return;
    }
    if (resetSession) {
      cowbellOverlayRef.current?.cancelScheduledHits();
      engine.stopJukebox();
      engine.resetStats();
      resetPlaybackSessionMetrics();
      vizControllerRef.current?.reset();
    } else {
      engine.syncToPlaybackPosition();
    }
    engine.play();
    engine.startJukebox(resetSession);
    lastPlayStampRef.current = performance.now();
    isRunningRef.current = true;
    isPausedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    requestWakeLockIfFullscreen();
  };

  const togglePlayback = () => {
    if (isRunning) {
      pausePlayback();
      return;
    }
    if (playMode === "autocanonizer") {
      const startIndex = isPaused ? (lastBeatRef.current ?? 0) : 0;
      startAutocanonizerPlayback(startIndex, { resetSession: !isPaused });
      return;
    }
    if (playMode === "wubmachine") {
      startWubMachinePlayback(null, { resetSession: !isPaused });
      return;
    }
    if (isPaused) {
      startJukeboxPlayback(false);
      return;
    }
    startJukeboxPlayback(true);
  };

  // Plays the remix from `seconds`, or from the paused position (the start
  // after a stop) when `seconds` is null.
  const startWubMachinePlayback = (
    seconds: number | null,
    options?: { resetSession?: boolean },
  ) => {
    const wubmachine = wubmachineRef.current;
    const player = playerRef.current;
    if (!wubmachine || !player) {
      return false;
    }
    if (isPlaybackBlockedForAudioMode()) {
      showPreparingToast();
      return false;
    }
    if (!wubmachine.isReady()) {
      maybePrepareWubMachine();
      return false;
    }
    const resetSession = options?.resetSession ?? true;
    player.stop();
    cowbellOverlayRef.current?.cancelScheduledHits();
    engineRef.current?.stopJukebox();
    if (resetSession) {
      resetPlaybackSessionMetrics();
    }
    wubmachine.play(seconds ?? undefined);
    if (resetSession || !isRunningRef.current) {
      lastPlayStampRef.current = performance.now();
    }
    isRunningRef.current = true;
    isPausedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    requestWakeLockIfFullscreen();
    return true;
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
    if (isPlaybackBlockedForAudioMode()) {
      showPreparingToast();
      return;
    }
    const beat = activeAnalysis.beats[index];
    if (!beat) {
      return;
    }

    cowbellOverlayRef.current?.cancelScheduledHits();
    player.seek(beat.start);
    engine.seekToBeat(index);
    lastBeatRef.current = index;
    vizControllerRef.current?.update(index, true, null);

    if (!isRunningRef.current) {
      engine.play();
      engine.startJukebox(false);
      lastPlayStampRef.current = performance.now();
      isRunningRef.current = true;
      isPausedRef.current = false;
      setIsRunning(true);
      setIsPaused(false);
      requestWakeLockIfFullscreen();
      return;
    }
    if (!player.isPlaying()) {
      engine.play();
    }
  };

  const startAutocanonizerPlayback = (
    index: number,
    options?: { resetSession?: boolean },
  ) => {
    const autocanonizer = autocanonizerRef.current;
    const engine = engineRef.current;
    const player = playerRef.current;
    if (!autocanonizer || !engine || !player || !autocanonizer.isReady()) {
      return false;
    }
    const resetSession = options?.resetSession ?? true;
    player.stop();
    cowbellOverlayRef.current?.cancelScheduledHits();
    engine.stopJukebox();
    if (resetSession) {
      resetPlaybackSessionMetrics();
      autocanonizer.resetVisualization();
    }
    autocanonizer.startAtIndex(index);
    if (resetSession || !isRunningRef.current) {
      lastPlayStampRef.current = performance.now();
    }
    isRunningRef.current = true;
    isPausedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    requestWakeLockIfFullscreen();
    return true;
  };

  const deleteSelectedBranch = () => {
    const engine = engineRef.current;
    const edge = selectedEdge;
    if (!engine || !edge || edge.deleted) {
      return;
    }
    engine.deleteEdge(edge);
    rebuildGraphAndSyncViz();
    clearSelectedBranch();
    syncTuneFormFromEngine();
    persistCurrentTuning();
    showShortcutToast(t("listen.branchDeleted"));
  };

  const selectAdjacentBranch = (direction: -1 | 1) => {
    if (playModeRef.current !== "jukebox" || !selectedEdge) {
      return;
    }
    const edges =
      engineRef.current
        ?.getVisualizationData()
        ?.edges.filter((edge) => !edge.deleted) ?? [];
    if (edges.length === 0) {
      return;
    }
    const currentIndex = edges.findIndex((edge) => edge.id === selectedEdge.id);
    const nextIndex = nextEdgeIndex(currentIndex, direction, edges.length);
    const nextEdge = edges[nextIndex];
    setSelectedEdge(nextEdge);
    vizControllerRef.current?.setSelectedEdgeActive(nextEdge);
  };

  const toggleSelectedAnchorBranch = () => {
    const engine = engineRef.current;
    let edge = selectedEdge;
    if (!engine || !edge || edge.deleted) {
      return false;
    }
    if (edge.dest.which >= edge.src.which) {
      // In layouts that draw a twin pair as one arc, a click may have
      // grabbed the forward one; in layouts that draw the two directions
      // apart, a forward selection is deliberate and gets no redirect.
      const twin = visualizationSeparatesPairedEdges(activeVizIndexRef.current)
        ? null
        : findBackwardTwin(vizDataRef.current?.edges ?? [], edge);
      if (!twin) {
        showShortcutToast(t("listen.anchorRequiresBackward"));
        return false;
      }
      edge = twin;
      setSelectedEdge(twin);
    }
    const nextAnchor = engine.getUserAnchorEdgeId() === edge.id ? null : edge;
    engine.setUserAnchorEdge(nextAnchor);
    syncVizDataFromEngine();
    vizControllerRef.current?.setSelectedEdgeActive(edge);
    persistCurrentTuning();
    showShortcutToast(
      nextAnchor ? t("listen.anchorSet") : t("listen.anchorReset"),
    );
    return true;
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
      randomBranchChanceDelta: tuneForm.ramp / RANDOM_BRANCH_DELTA_PERCENT_SCALE,
      justBackwards: tuneForm.justBackwards,
      justLongBranches: tuneForm.minLongBranchPercent > 0,
      minLongBranchPercent:
        tuneForm.minLongBranchPercent > 0
          ? tuneForm.minLongBranchPercent
          : DEFAULT_MIN_LONG_BRANCH_PERCENT,
      removeSequentialBranches: tuneForm.removeSequentialBranches,
    });
    setHighlightAnchorBranch(tuneForm.highlightAnchorBranch);
    storeAnchorHighlight(tuneForm.highlightAnchorBranch);
    vizControllerRef.current?.setAnchorHighlightEnabled(
      tuneForm.highlightAnchorBranch,
    );
    rebuildGraphAndSyncViz();
    const volume = tuneForm.volume / 100;
    player.setVolume(volume);
    autocanonizerRef.current?.setVolume(volume);
    wubmachineRef.current?.setVolume(volume);
    cowbellOverlayRef.current?.setVolume(volume);
    syncTuneFormFromEngine(tuneForm.highlightAnchorBranch);
    persistCurrentTuning();
    setIsTuningOpen(false);
  };

  const onResetTuning = () => {
    const engine = engineRef.current;
    const player = playerRef.current;
    if (!engine || !player) {
      return;
    }
    engine.clearDeletedEdges();
    engine.updateConfig(DEFAULT_JUKEBOX_CONFIG);
    rebuildGraphAndSyncViz();
    clearSelectedBranch();
    syncTuneFormFromEngine();
    if (fingerprintRef.current) {
      removeTuning(fingerprintRef.current);
    }
    setIsTuningOpen(false);
  };

  const onApplyExtras = () => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    const previousAudioMode = jukeboxAudioMode;
    const previousAudioIntensity = audioIntensity;
    const nextBranchStatsEnabled = playModeRef.current === "jukebox" && extrasForm.branchStatsEnabled;
    const nextBringItHomeMode = playModeRef.current === "jukebox" && extrasForm.bringItHomeMode;
    const nextAudioMode = extrasForm.audioMode;
    const nextAudioIntensity = clampAudioModeIntensity(
      extrasForm.audioIntensity,
    );
    bringItHomeModeRef.current = nextBringItHomeMode;
    setBringItHomeMode(nextBringItHomeMode);
    if (nextBringItHomeMode) {
      engineRef.current?.setForceBranch(false);
    }
    engineRef.current?.setBringItHomeMode(nextBringItHomeMode);
    setBranchStatsEnabled(nextBranchStatsEnabled);
    storeBranchStatsEnabled(nextBranchStatsEnabled);
    setJukeboxAudioMode(nextAudioMode);
    setAudioIntensity(nextAudioIntensity);
    if (nextAudioMode === "cowbell") {
      cowbellOverlayRef.current?.enable();
    } else {
      cowbellOverlayRef.current?.disable();
    }
    if (nextAudioMode !== "instrumental") {
      cancelInstrumentalRender();
    }
    if (nextAudioMode === "swing") {
      player.setJukeboxAudioMode("swing", nextAudioIntensity);
      if (canPrepareSwingMode()) {
        prepareSwingMode();
      } else {
        showShortcutToast(t("listen.swingWhenLoaded"));
      }
    } else if (nextAudioMode === "instrumental") {
      player.setJukeboxAudioMode("instrumental", nextAudioIntensity);
      if (canPrepareInstrumentalMode()) {
        prepareInstrumentalMode();
      } else {
        showShortcutToast(t("listen.instrumentalWhenLoaded"));
      }
    } else {
      stopPreparing();
      player.setJukeboxAudioMode(nextAudioMode, nextAudioIntensity);
    }
    writeAudioModeToUrl(nextAudioMode, nextAudioIntensity, true);
    if (
      audioModeChangeAffectsPlayback(
        previousAudioMode,
        nextAudioMode,
        previousAudioIntensity,
        nextAudioIntensity,
      ) &&
      playModeRef.current === "jukebox" &&
      nextAudioMode !== "swing" &&
      nextAudioMode !== "instrumental" &&
      (isRunningRef.current || isPausedRef.current)
    ) {
      engineRef.current?.syncToPlaybackPosition();
    }
    setIsTuningOpen(false);
  };

  const onResetExtras = () => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    const previousAudioMode = jukeboxAudioMode;
    bringItHomeModeRef.current = false;
    setBringItHomeMode(false);
    engineRef.current?.setBringItHomeMode(false);
    setExtrasForm((prev) => ({
      ...prev,
      branchStatsEnabled: false,
      bringItHomeMode: false,
    }));
    setBranchStatsEnabled(false);
    storeBranchStatsEnabled(false);
    resetAudioModeToOff(player);
    if (
      previousAudioMode !== "off" &&
      playModeRef.current === "jukebox" &&
      (isRunningRef.current || isPausedRef.current)
    ) {
      engineRef.current?.syncToPlaybackPosition();
    }
    setIsTuningOpen(false);
  };

  const onApplyTuningModal = () => {
    if (tuningActiveTab === "extras") {
      onApplyExtras();
      return;
    }
    onApplyTuning();
  };

  const onResetTuningModal = () => {
    if (tuningActiveTab === "extras") {
      onResetExtras();
      return;
    }
    onResetTuning();
  };

  const onVolumeChange = (value: number) => {
    setTuneForm((prev) => ({ ...prev, volume: value }));
    const volume = value / 100;
    playerRef.current?.setVolume(volume);
    autocanonizerRef.current?.setVolume(volume);
    wubmachineRef.current?.setVolume(volume);
    cowbellOverlayRef.current?.setVolume(volume);
  };

  const onAutocanonizerStreamPanChange = (
    stream: "main" | "other",
    value: number,
  ) => {
    const nextMain = stream === "main" ? value : autocanonizerMainPan;
    const nextOther = stream === "other" ? value : autocanonizerOtherPan;
    setAutocanonizerMainPan(nextMain);
    setAutocanonizerOtherPan(nextOther);
    autocanonizerMainPanRef.current = nextMain;
    autocanonizerOtherPanRef.current = nextOther;
    autocanonizerRef.current?.setStreamPans(nextMain / 100, nextOther / 100);
  };

  const onSetActiveViz = (index: number) => {
    if (playMode !== "jukebox") {
      return;
    }
    const count = vizControllerRef.current?.getCount() ?? 1;
    if (!Number.isFinite(index) || index < 0 || index >= count) {
      return;
    }
    vizControllerRef.current?.setActiveIndex(index);
    setActiveVizIndex(index);
  };

  const { forceBranchActive, freezeBeatActive } = useListenHotkeys({
    isActive,
    playMode,
    selectedEdge,
    isRunning,
    isPaused,
    isTuningOpen,
    isInfoOpen,
    isExportOpen,
    engineRef,
    bringItHomeModeRef,
    setBringItHomeMode,
    showShortcutToast,
    t,
    openTuningModalTab,
    togglePlayback,
    selectAdjacentBranch,
    deleteSelectedBranch,
    toggleSelectedAnchorBranch,
  });

  const steps = React.useMemo<ProgressStep[]>(() => {
    const stageIndex = STEP_ORDER.indexOf(progressStage);
    return STEP_ORDER.map((step, idx) => ({
      id: step,
      label: analysisStageLabel(step, t),
      status: progressStepStatus(idx, stageIndex),
    }));
  }, [progressStage, t]);

  const graph = engineRef.current?.getGraphState();
  const totalBeats = graph?.totalBeats ?? analysis?.beats.length ?? 0;
  const totalBranches = engineRef.current?.getVisualizationData()?.edges.length ?? 0;
  const deletedBranches = graph?.allEdges.filter((edge) => edge.deleted).length ?? 0;
  const vizCount = vizControllerRef.current?.getCount() ?? 1;
  const currentFileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : null;
  const showPlaybackUi =
    Boolean(analysis) &&
    !isAnalyzing &&
    preparingMode === null &&
    readyFileKey === currentFileKey;
  const playControlLabel = playControlText({
    preparingMode,
    isRunning,
    isPaused,
    t,
  });
  const playIcon = playControlIcon(preparingMode !== null, isRunning);
  const beatsLabel =
    jukeboxAudioMode === "cowbell"
      ? t("listen.totalCowbells")
      : t("listen.totalBeats");
  const branchStats =
    branchStatsEnabled && playMode === "jukebox" && selectedEdge
      ? deriveBranchStats(
          selectedEdge,
          Math.max(1, engineRef.current?.getConfig().maxBranchThreshold ?? 80),
          t,
        )
      : null;

  const closeSettings = () => setIsSettingsOpen(false);
  const settingsModal = isSettingsOpen ? (
    <SettingsModal
      theme={theme}
      onThemeChange={(option) => {
        setTheme(option);
        applyTheme(option);
        vizControllerRef.current?.refresh();
      }}
      sleepTimer={sleepTimer}
      pendingSleepTimerDurationMs={pendingSleepTimerDurationMs}
      onPendingSleepTimerDurationChange={setPendingSleepTimerDurationMs}
      onSetSleepTimer={setSleepTimer}
      onClose={closeSettings}
    />
  ) : null;

  // Computed before the early return (and file-guarded) so the marquee hooks
  // below run unconditionally on every render, keeping hook order stable.
  const displayTitle = file
    ? formatTrackTitle(file.name, playMode, jukeboxAudioMode, t)
    : "";
  // The marquee controller owns each title node's text imperatively, so the
  // title <div>s are left empty in JSX (see .play-title / .viz-title) and wired
  // through these ref callbacks.
  const playTitleRef = useMarquee(displayTitle);
  const vizTitleRef = useMarquee(displayTitle);

  if (!file) {
    return (
      <>
        <section className="panel panel--center">
          <p>{t("listen.noFile")}</p>
          <Link className="tab-btn" to="/">{t("listen.goBack")}</Link>
        </section>
        {settingsModal}
      </>
    );
  }

  return (
    <>
      <section className="listen-page">
      <StatusPanel
        isAnalyzing={isAnalyzing}
        steps={steps}
        progressMessage={progressMessage}
        progressPercent={progressPercent}
        preparingMode={preparingMode}
        preparingPhase={preparingPhase}
        preparingProgress={preparingProgress}
      />

      {error ? <div className="error">{error}</div> : null}

      {showPlaybackUi ? (
        <PlayMenu
          playTitleRef={playTitleRef}
          playMode={playMode}
          bringItHomeMode={bringItHomeMode}
          hasAnalysis={Boolean(analysis)}
          isExporting={isExporting}
          onOpenTuning={() => openTuningModalTab("tuning")}
          onOpenInfo={() => setIsInfoOpen(true)}
          onOpenExport={openExport}
        />
      ) : null}

      <div id="viz-panel" ref={vizPanelRef} hidden={!showPlaybackUi}>
        <div id="jukebox-viz" className={`viz ${VIZ_CLASS_NAMES[playMode]}`}>
          {branchStats ? (
            <BranchStatsPopup
              stats={branchStats}
              deleteDisabled={Boolean(selectedEdge?.deleted)}
              onDelete={deleteSelectedBranch}
            />
          ) : null}
          <VizTop
            playMode={playMode}
            onPlayModeChange={onSetPlayMode}
            activeVizIndex={activeVizIndex}
            vizCount={vizCount}
            onActiveVizChange={onSetActiveViz}
            finishOutSong={finishOutSong}
            onFinishOutSongChange={setFinishOutSong}
            loopTrack={loopTrack}
            onLoopTrackChange={setLoopTrack}
          />
          {forceBranchActive || freezeBeatActive ? (
            <div className="modifier-badges" role="status" aria-live="polite">
              {forceBranchActive ? (
                <span className="modifier-badge">
                  {t("listen.forceBranchBadge")}
                </span>
              ) : null}
              {freezeBeatActive ? (
                <span className="modifier-badge">
                  {t("listen.freezeBeatBadge")}
                </span>
              ) : null}
            </div>
          ) : null}
          <div id="viz-layer" className="viz-layer" ref={vizLayerRef} />
          <div id="canonizer-layer" className="canonizer-layer" ref={canonizerLayerRef} />
          <div id="wubmachine-layer" className="wubmachine-layer" ref={wubMachineLayerRef} />
          <div className="viz-bottom" id="viz-stats">
            <div className="viz-bottom-left">
              <button
                id="viz-play"
                className="play-toggle viz-play-toggle"
                type="button"
                onClick={togglePlayback}
                disabled={!analysis || preparingMode !== null}
                title={playControlLabel}
                aria-label={playControlLabel}
              >
                <SymbolIcon
                  className="play-icon"
                  name={playIcon}
                />
              </button>
              <VizInfo
                vizTitleRef={vizTitleRef}
                playMode={playMode}
                autocanonizerMainSeconds={autocanonizerMainSeconds}
                autocanonizerOtherSeconds={autocanonizerOtherSeconds}
                wubMachineSeconds={wubMachineSeconds}
                wubMachineDurationSeconds={wubMachineDurationSeconds}
                trackDurationSeconds={analysis?.track?.duration ?? 0}
                listenSeconds={listenSeconds}
                beatsLabel={beatsLabel}
                beatsPlayed={beatsPlayed}
                bringItHomeMode={bringItHomeMode}
              />
            </div>
            <div className="viz-bottom-right">
              {playMode === "autocanonizer" ? (
                <PanPopover
                  isOpen={isPanOpen}
                  panelRef={panPanelRef}
                  buttonRef={panButtonRef}
                  mainPan={autocanonizerMainPan}
                  otherPan={autocanonizerOtherPan}
                  onPanChange={onAutocanonizerStreamPanChange}
                  onToggle={togglePan}
                />
              ) : null}
              <VolumePopover
                isOpen={isVolumeOpen}
                panelRef={volumePanelRef}
                buttonRef={volumeButtonRef}
                volume={tuneForm.volume}
                onVolumeChange={onVolumeChange}
                onToggle={toggleVolume}
              />
              <button
                id="fullscreen"
                className="fullscreen-toggle"
                type="button"
                onClick={onToggleFullscreen}
                title={
                  isFullscreen
                    ? t("listen.exitFullscreen")
                    : t("listen.fullscreen")
                }
                aria-label={
                  isFullscreen
                    ? t("listen.exitFullscreen")
                    : t("listen.fullscreen")
                }
              >
                <SymbolIcon className="fullscreen-icon" name={isFullscreen ? "fullscreen_exit" : "fullscreen"} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {isExportOpen ? (
        <ExportModal
          form={exportForm}
          setForm={setExportForm}
          isExporting={isExporting}
          progress={exportProgress}
          error={exportError}
          onClose={closeExport}
          onExport={handleExportJukeboxAudio}
          playMode={playMode}
          remixDurationSeconds={wubMachineDurationSeconds}
        />
      ) : null}

      {isTuningOpen ? (
        <TuningModal
          playMode={playMode}
          activeTab={tuningActiveTab}
          onTabChange={setTuningActiveTab}
          tuneForm={tuneForm}
          setTuneForm={setTuneForm}
          extrasForm={extrasForm}
          setExtrasForm={setExtrasForm}
          onClose={() => setIsTuningOpen(false)}
          onReset={onResetTuningModal}
          onApply={onApplyTuningModal}
        />
      ) : null}

      {isInfoOpen ? (
        <InfoModal
          trackDurationSeconds={analysis?.track?.duration ?? 0}
          totalBeats={totalBeats}
          totalBranches={totalBranches}
          deletedBranches={deletedBranches}
          onClose={() => setIsInfoOpen(false)}
        />
      ) : null}
      <ShortcutToastStack queue={shortcutToastQueue} />
      </section>
      {settingsModal}
    </>
  );
}

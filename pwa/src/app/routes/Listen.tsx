import React from "react";
import "@/app/i18n";
import { Link } from "react-router-dom";
import { AnalysisWorkerClient } from "@/core/infrastructure/analysis/AnalysisWorkerClient";
import { AudioDecoder } from "@/core/infrastructure/audio/AudioDecoder";
import { createAnalysisCache } from "@/core/infrastructure/cache/analysisCache";
import {
  loadTuning,
  removeTuning,
  saveTuning,
} from "@/core/infrastructure/cache/tuningStore";
import { AnalyzeAudioUseCase, AnalyzeStage } from "@/core/application/usecases/analyzeAudio";
import { AnalysisOutput } from "@/shared/analysis-schema";
import {
  pickBinaryExportFile,
  saveExportBinary,
} from "@/shared/utils/exportJson";
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
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "@forever-jukebox/shared/background";
import {
  exportJukeboxAudio,
  type JukeboxExportProgress,
} from "@/shared/export";
import { AutocanonizerController } from "@forever-jukebox/shared/autocanonizer/AutocanonizerController";
import { JukeboxController } from "@forever-jukebox/shared/viz/JukeboxController";
import { useAppState } from "../state/AppState";
import type { ProgressStep } from "@/ui/components/ProgressSteps";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { useWakeLock } from "./listen/useWakeLock";
import { useMarquee } from "./listen/useMarquee";
import { useTranslation } from "react-i18next";
import { applyTheme, resolveStoredTheme, type ThemeName } from "../theme";
import type { PlayMode, TuningModalTab } from "./listen/types";
import {
  resolveSleepTimerDuration,
  type SleepTimerState,
} from "./listen/sleepTimer";
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
  storeAnchorHighlight,
  storeBranchStatsEnabled,
  storeFinishOutSong,
  storeVisualizationIndex,
} from "./listen/preferences";
import {
  STEP_ORDER,
  analysisStageLabel,
  formatPlayVelocity,
  formatTrackTitle,
  playControlIcon,
  playControlText,
  progressStepStatus,
} from "./listen/labels";
import {
  RANDOM_BRANCH_DELTA_PERCENT_SCALE,
  type ExtrasFormState,
  type TuneFormState,
} from "./listen/tuning";
import {
  MAX_EXPORT_DURATION_SECONDS,
  buildAudioExportName,
  exportErrorMessage,
  type ExportFormState,
} from "./listen/exportAudio";
import { deriveBranchStats, nextEdgeIndex } from "./listen/branches";
import {
  createSessionSeed,
  isEditableTarget,
  waitForNextPaint,
} from "./listen/browser";
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
import { StatusPanel } from "./listen/StatusPanel";
import { TuningModal } from "./listen/TuningModal";
import { VizInfo } from "./listen/VizInfo";
import { VizTop } from "./listen/VizTop";
import { VolumePopover } from "./listen/VolumePopover";

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
  const [selectedEdge, setSelectedEdge] = React.useState<Edge | null>(null);
  const [isTuningOpen, setIsTuningOpen] = React.useState(false);
  const [isInfoOpen, setIsInfoOpen] = React.useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = React.useState(false);
  const [isPanOpen, setIsPanOpen] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [sleepTimer, setSleepTimerState] = React.useState<SleepTimerState>({
    configuredDurationMs: null,
    endTimeMs: null,
    remainingMs: 0,
  });
  const [pendingSleepTimerDurationMs, setPendingSleepTimerDurationMs] =
    React.useState<number | null>(null);
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
  const [swingPreparing, setSwingPreparing] = React.useState(false);
  const [swingProgress, setSwingProgress] = React.useState(0);
  const [tuningActiveTab, setTuningActiveTab] =
    React.useState<TuningModalTab>("tuning");
  const [forceBranchActive, setForceBranchActive] = React.useState(false);
  const [freezeBeatActive, setFreezeBeatActive] = React.useState(false);
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
  const swingRenderTokenRef = React.useRef(0);
  const swingPreparingRef = React.useRef(false);
  const playTimerMsRef = React.useRef(0);
  const lastPlayStampRef = React.useRef<number | null>(null);
  const sleepTimerTimeoutRef = React.useRef<number | null>(null);
  const sleepTimerEndTimeRef = React.useRef<number | null>(null);
  const analysisRef = React.useRef<AnalysisOutput | null>(null);
  const fingerprintRef = React.useRef<string | null>(null);
  const previousFileKeyRef = React.useRef<string | null>(null);
  const volumeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const volumePanelRef = React.useRef<HTMLDivElement | null>(null);
  const panButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const panPanelRef = React.useRef<HTMLDivElement | null>(null);
  const { requestWakeLock, releaseWakeLock } = useWakeLock();

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

  const requestWakeLockSafely = React.useCallback(() => {
    requestWakeLock().catch((err) => {
      console.warn(`Wake lock request failed: ${String(err)}`);
    });
  }, [requestWakeLock]);

  const releaseWakeLockSafely = React.useCallback(() => {
    releaseWakeLock().catch((err) => {
      console.warn(`Wake lock release failed: ${String(err)}`);
    });
  }, [releaseWakeLock]);

  function setSwingPreparingState(preparing: boolean) {
    swingPreparingRef.current = preparing;
    setSwingPreparing(preparing);
  }

  // The audio-mode reset shared by track changes and the extras reset:
  // player, mode/intensity state, extras form, and URL all return to "off"
  // at default intensity.
  function resetAudioModeToOff(player: BufferedAudioPlayer) {
    cowbellOverlayRef.current?.disable();
    swingRenderTokenRef.current += 1;
    setSwingPreparingState(false);
    setSwingProgress(0);
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
  }

  function clearSelectedBranch() {
    setSelectedEdge(null);
    vizControllerRef.current?.setSelectedEdge(null);
  }

  function clearSleepTimerTimeout() {
    if (sleepTimerTimeoutRef.current === null) {
      return;
    }
    backgroundClearTimeout(sleepTimerTimeoutRef.current);
    sleepTimerTimeoutRef.current = null;
  }

  function publishInactiveSleepTimer() {
    sleepTimerEndTimeRef.current = null;
    setSleepTimerState({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
  }

  function expireSleepTimer(expectedEndTimeMs: number) {
    if (sleepTimerEndTimeRef.current !== expectedEndTimeMs) {
      return;
    }
    sleepTimerEndTimeRef.current = null;
    setSleepTimerState({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
    clearSleepTimerTimeout();
    stopPlayback();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        console.warn("Failed to exit fullscreen");
      });
    }
  }

  function scheduleSleepTimerTick(expectedEndTimeMs: number) {
    clearSleepTimerTimeout();
    const remainingMs = Math.max(0, expectedEndTimeMs - performance.now());
    const nextDelayMs = remainingMs > 1000 ? 1000 : remainingMs;
    sleepTimerTimeoutRef.current = backgroundSetTimeout(() => {
      if (sleepTimerEndTimeRef.current !== expectedEndTimeMs) {
        return;
      }
      const nextRemainingMs = Math.max(0, expectedEndTimeMs - performance.now());
      setSleepTimerState((current) => {
        if (current.endTimeMs !== expectedEndTimeMs) {
          return current;
        }
        return {
          configuredDurationMs: current.configuredDurationMs,
          endTimeMs: expectedEndTimeMs,
          remainingMs: nextRemainingMs,
        };
      });
      if (nextRemainingMs <= 0) {
        expireSleepTimer(expectedEndTimeMs);
        return;
      }
      scheduleSleepTimerTick(expectedEndTimeMs);
    }, nextDelayMs);
  }

  function setSleepTimer(durationMs: number | null) {
    clearSleepTimerTimeout();
    if (
      durationMs === null ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      publishInactiveSleepTimer();
      return;
    }
    const endTimeMs = performance.now() + durationMs;
    sleepTimerEndTimeRef.current = endTimeMs;
    setSleepTimerState({
      configuredDurationMs: durationMs,
      endTimeMs,
      remainingMs: durationMs,
    });
    scheduleSleepTimerTick(endTimeMs);
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
    } else if (jukeboxAudioMode !== "swing") {
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
    if (playMode === "autocanonizer") {
      autocanonizerRef.current?.resizeNow();
    } else {
      vizControllerRef.current?.resizeActive();
    }
  }, [playMode]);

  React.useEffect(() => {
    storeFinishOutSong(finishOutSong);
    autocanonizerRef.current?.setFinishOutSong(finishOutSong);
  }, [finishOutSong]);

  React.useEffect(() => {
    setPendingSleepTimerDurationMs(
      resolveSleepTimerDuration(sleepTimer.configuredDurationMs),
    );
  }, [sleepTimer.configuredDurationMs]);

  React.useEffect(() => {
    if (isSettingsOpen) {
      setPendingSleepTimerDurationMs(
        resolveSleepTimerDuration(sleepTimer.configuredDurationMs),
      );
    }
  }, [isSettingsOpen, sleepTimer.configuredDurationMs]);

  React.useEffect(() => {
    return () => {
      clearSleepTimerTimeout();
    };
  }, []);

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
          setProgressMessage(analysisStageLabel(progress.stage, t));
        },
      })
      .then(async (result) => {
        if (cancelled) {
          return;
        }
        analysisRef.current = result.analysis;
        fingerprintRef.current = result.fingerprint;
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

  React.useEffect(() => {
    if (!isActive) {
      engineRef.current?.setForceBranch(false);
      engineRef.current?.setFreezeCurrentBeat(false);
      setForceBranchActive(false);
      setFreezeBeatActive(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTuningOpen || isInfoOpen || isExportOpen) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "e" || event.key === "E") &&
        !event.repeat
      ) {
        event.preventDefault();
        openTuningModalTab("extras");
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        selectedEdge
      ) {
        event.preventDefault();
        selectAdjacentBranch(event.key === "ArrowRight" ? 1 : -1);
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
      if (
        playMode === "jukebox" &&
        (event.key === "h" || event.key === "H") &&
        !event.repeat
      ) {
        event.preventDefault();
        const nextValue = !bringItHomeModeRef.current;
        bringItHomeModeRef.current = nextValue;
        setBringItHomeMode(nextValue);
        engineRef.current?.setBringItHomeMode(nextValue);
        if (nextValue) {
          engineRef.current?.setForceBranch(false);
          setForceBranchActive(false);
        }
        showShortcutToast(
          nextValue
            ? t("listen.bringHomeEnabled")
            : t("listen.bringHomeDisabled"),
        );
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "a" || event.key === "A") &&
        !event.repeat
      ) {
        if (toggleSelectedAnchorBranch()) {
          event.preventDefault();
        }
        return;
      }
      // Match brackets by typed character first, then by physical key
      // position so layouts without direct bracket keys still work.
      let bracketDirection = 0;
      if (event.key === "[") {
        bracketDirection = -1;
      } else if (event.key === "]") {
        bracketDirection = 1;
      } else if (event.code === "BracketLeft") {
        bracketDirection = -1;
      } else if (event.code === "BracketRight") {
        bracketDirection = 1;
      }
      if (playMode === "jukebox" && bracketDirection !== 0) {
        event.preventDefault();
        const engine = engineRef.current;
        if (!engine) {
          return;
        }
        const direction = bracketDirection;
        const velocity = engine.getPlayVelocity() + direction;
        engine.setPlayVelocity(velocity);
        showShortcutToast(
          t("listen.playVelocity", {
            value: formatPlayVelocity(engine.getPlayVelocity()),
          }),
          "play-velocity",
        );
        return;
      }
      if (playMode === "jukebox" && event.key === "ArrowDown") {
        event.preventDefault();
        engineRef.current?.setPlayVelocity(0);
        showShortcutToast(
          t("listen.playVelocity", { value: "0" }),
          "play-velocity",
        );
        return;
      }
      if (playMode === "jukebox" && event.key === "ArrowUp") {
        event.preventDefault();
        engineRef.current?.setPlayVelocity(1);
        showShortcutToast(
          t("listen.playVelocity", { value: "+1" }),
          "play-velocity",
        );
        return;
      }
      if (playMode === "jukebox" && event.key === "Control") {
        event.preventDefault();
        engineRef.current?.setFreezeCurrentBeat(true);
        setFreezeBeatActive(true);
        return;
      }
      if (
        playMode === "jukebox" &&
        event.key === "Shift" &&
        isRunning &&
        !bringItHomeModeRef.current
      ) {
        engineRef.current?.setForceBranch(true);
        setForceBranchActive(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        engineRef.current?.setFreezeCurrentBeat(false);
        setFreezeBeatActive(false);
      }
      if (playMode === "jukebox" && event.key === "Shift") {
        engineRef.current?.setForceBranch(false);
        setForceBranchActive(false);
      }
    };
    const onBlur = () => {
      engineRef.current?.setFreezeCurrentBeat(false);
      engineRef.current?.setForceBranch(false);
      setFreezeBeatActive(false);
      setForceBranchActive(false);
    };
    // Blur alone can be missed on tab switches (e.g. Ctrl+T), leaving
    // freeze/branch modes stuck; visibilitychange covers that path.
    const onHotkeyVisibilityChange = () => {
      if (document.hidden) {
        onBlur();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHotkeyVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener(
        "visibilitychange",
        onHotkeyVisibilityChange,
      );
      engineRef.current?.setFreezeCurrentBeat(false);
      engineRef.current?.setForceBranch(false);
      setFreezeBeatActive(false);
      setForceBranchActive(false);
    };
  }, [
    selectedEdge,
    isRunning,
    isPaused,
    isTuningOpen,
    isInfoOpen,
    isExportOpen,
    playMode,
    isActive,
    showShortcutToast,
  ]);

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
        requestWakeLockSafely();
      } else {
        releaseWakeLockSafely();
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        releaseWakeLockSafely();
        return;
      }
      if (document.fullscreenElement === vizPanelRef.current) {
        requestWakeLockSafely();
      }
    };

    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [releaseWakeLockSafely, requestWakeLockSafely]);

  React.useEffect(() => {
    if (!isVolumeOpen && !isPanOpen) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (volumePanelRef.current?.contains(target)) {
        return;
      }
      if (volumeButtonRef.current?.contains(target)) {
        return;
      }
      if (panPanelRef.current?.contains(target)) {
        return;
      }
      if (panButtonRef.current?.contains(target)) {
        return;
      }
      setIsVolumeOpen(false);
      setIsPanOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => {
      document.removeEventListener("click", onDocumentClick);
    };
  }, [isVolumeOpen, isPanOpen]);

  React.useEffect(() => {
    if (playMode !== "autocanonizer") {
      setIsPanOpen(false);
    }
  }, [playMode]);

  function stopPlayback() {
    cowbellOverlayRef.current?.cancelScheduledHits();
    if (playModeRef.current === "autocanonizer") {
      autocanonizerRef.current?.stop();
      playerRef.current?.stop();
      autocanonizerRef.current?.resetVisualization();
    }
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
    playModeRef.current = mode;
    setPlayMode(mode);
    setAutocanonizerMainSeconds(0);
    setAutocanonizerOtherSeconds(0);
    if (mode === "autocanonizer") {
      setIsTuningOpen(false);
      setIsInfoOpen(false);
      setTuningActiveTab("tuning");
      clearSelectedBranch();
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

  function getCurrentSwingSourceIdentity() {
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

  function isPlaybackBlockedForSwing() {
    return (
      playModeRef.current === "jukebox" &&
      jukeboxAudioMode === "swing" &&
      swingPreparingRef.current
    );
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
    const renderToken = swingRenderTokenRef.current + 1;
    swingRenderTokenRef.current = renderToken;
    setSwingPreparingState(true);
    setSwingProgress(0);

    getOrCreateSwingBuffer(sourceBuffer, getCurrentSwingSourceIdentity(), () =>
      renderSwingBuffer(sourceBuffer, beats, {
        onProgress: (progress) => {
          if (
            swingRenderTokenRef.current !== renderToken ||
            playerRef.current?.getJukeboxAudioMode() !== "swing"
          ) {
            return;
          }
          setSwingProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
        },
      }),
    )
      .then((buffer) => {
        if (
          swingRenderTokenRef.current !== renderToken ||
          playerRef.current?.getJukeboxAudioMode() !== "swing"
        ) {
          return;
        }
        setSwingPreparingState(false);
        setSwingProgress(100);
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
        if (swingRenderTokenRef.current !== renderToken) {
          return;
        }
        console.warn(`Swing render failed: ${String(err)}`);
        resetAudioModeToOff(player);
        showShortcutToast(t("listen.swingFailed"));
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
    if (isPlaybackBlockedForSwing()) {
      showShortcutToast(t("listen.preparingSwingEllipsis"));
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
    if (document.fullscreenElement === vizPanelRef.current) {
      requestWakeLockSafely();
    }
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
    if (isPaused) {
      startJukeboxPlayback(false);
      return;
    }
    startJukeboxPlayback(true);
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
    if (isPlaybackBlockedForSwing()) {
      showShortcutToast(t("listen.preparingSwingEllipsis"));
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
      if (document.fullscreenElement === vizPanelRef.current) {
        requestWakeLockSafely();
      }
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
    if (document.fullscreenElement === vizPanelRef.current) {
      requestWakeLockSafely();
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
    if (nextAudioMode === "swing") {
      player.setJukeboxAudioMode("swing", nextAudioIntensity);
      if (canPrepareSwingMode()) {
        prepareSwingMode();
      } else {
        showShortcutToast(t("listen.swingWhenLoaded"));
      }
    } else {
      swingRenderTokenRef.current += 1;
      setSwingPreparingState(false);
      setSwingProgress(0);
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

  const onExportJukeboxAudio = async () => {
    const activeAnalysis = analysisRef.current ?? analysis;
    const player = playerRef.current;
    const engine = engineRef.current;
    if (!activeAnalysis || !player || !engine || !file) {
      return;
    }

    const sourceBuffer = player.getSourceBuffer() ?? player.getBuffer();
    if (!sourceBuffer) {
      setExportError(t("export.bufferUnavailable"));
      return;
    }

    const durationSeconds = Number(exportForm.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      setExportError(t("export.positiveDuration"));
      return;
    }
    if (durationSeconds > MAX_EXPORT_DURATION_SECONDS) {
      setExportError(t("export.durationCap", {
        minutes: MAX_EXPORT_DURATION_SECONDS / 60,
      }));
      return;
    }

    const requestedExtension = exportForm.format;
    const requestedFilename = buildAudioExportName(file.name, requestedExtension);
    const requestedDescription =
      requestedExtension === "mp3"
        ? t("export.mp3Description")
        : t("export.wavDescription");
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
      console.warn(`Unable to open export save dialog: ${String(err)}`);
      setExportError(t("export.saveDialogFailed"));
      return;
    }

    setExportError(null);
    setExportProgress({
      stage: "planning",
      message: { kind: "initializing" },
      percent: 0,
    });
    setIsExporting(true);
    await waitForNextPaint();

    try {
      let swingBuffer: AudioBuffer | undefined;
      if (jukeboxAudioMode === "swing") {
        const existingSwingBuffer = player.getRenderedJukeboxAudioBuffer("swing");
        if (existingSwingBuffer) {
          swingBuffer = existingSwingBuffer;
        } else if (activeAnalysis.beats.length > 0) {
          setExportProgress({
            stage: "rendering",
            message: { kind: "preparingSwing" },
            percent: 2,
          });
          swingBuffer = await getOrCreateSwingBuffer(
            sourceBuffer,
            getCurrentSwingSourceIdentity(),
            () =>
              renderSwingBuffer(sourceBuffer, activeAnalysis.beats, {
                onProgress: (progress) => {
                  setExportProgress({
                    stage: "rendering",
                    message: { kind: "preparingSwing" },
                    percent: 2 + Math.max(0, Math.min(1, progress)) * 6,
                  });
                },
              }),
          );
          player.setRenderedJukeboxAudioBuffer("swing", swingBuffer);
        } else {
          throw new Error("Swing export requires beat analysis.");
        }
      }

      const deletedEdges =
        engine
          .getGraphState()
          ?.allEdges.filter((edge) => edge.deleted)
          .map((edge) => ({ src: edge.src.which, dest: edge.dest.which })) ?? [];
      const anchorEdge = engine.getUserAnchorEdge();

      const result = await exportJukeboxAudio({
        analysis: activeAnalysis,
        sourceBuffer,
        config: engine.getConfig(),
        deletedEdges,
        userAnchorEdge: anchorEdge
          ? { src: anchorEdge.src.which, dest: anchorEdge.dest.which }
          : null,
        durationSeconds,
        format: exportForm.format,
        bitrateKbps: exportForm.format === "mp3" ? exportForm.bitrateKbps : undefined,
        gain: player.getVolume(),
        audioMode: jukeboxAudioMode,
        audioIntensityPct: audioIntensity,
        sectionStartBeatIndices: engine.getSectionStartBeatIndices(),
        swingBuffer,
        randomMode: "seeded",
        seed: createSessionSeed(),
        onProgress: (progress) => setExportProgress(progress),
      });

      const extension = result.extension;
      const filename = buildAudioExportName(file.name, extension);
      const description =
        extension === "mp3"
          ? t("export.mp3Description")
          : t("export.wavDescription");
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
      console.warn(`Audio export failed: ${String(err)}`);
      setExportError(exportErrorMessage(err, t));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJukeboxAudio = () => {
    onExportJukeboxAudio().catch((err) => {
      console.warn(`Audio export failed: ${String(err)}`);
      setExportError(exportErrorMessage(err, t));
      setIsExporting(false);
    });
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
    !swingPreparing &&
    readyFileKey === currentFileKey;
  const playControlLabel = playControlText({
    swingPreparing,
    isRunning,
    isPaused,
    t,
  });
  const playIcon = playControlIcon(swingPreparing, isRunning);
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
        swingPreparing={swingPreparing}
        swingProgress={swingProgress}
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
          onOpenExport={() => {
            setExportError(null);
            setExportProgress(null);
            setIsExportOpen(true);
          }}
        />
      ) : null}

      <div id="viz-panel" ref={vizPanelRef} hidden={!showPlaybackUi}>
        <div id="jukebox-viz" className={`viz ${playMode === "autocanonizer" ? "is-canonizer" : ""}`}>
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
          <div className="viz-bottom" id="viz-stats">
            <div className="viz-bottom-left">
              <button
                id="viz-play"
                className="play-toggle viz-play-toggle"
                type="button"
                onClick={togglePlayback}
                disabled={!analysis || swingPreparing}
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
                  onToggle={() => {
                    setIsVolumeOpen(false);
                    setIsPanOpen((prev) => !prev);
                  }}
                />
              ) : null}
              <VolumePopover
                isOpen={isVolumeOpen}
                panelRef={volumePanelRef}
                buttonRef={volumeButtonRef}
                volume={tuneForm.volume}
                onVolumeChange={onVolumeChange}
                onToggle={() => {
                  setIsPanOpen(false);
                  setIsVolumeOpen((prev) => !prev);
                }}
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
          onClose={() => setIsExportOpen(false)}
          onExport={handleExportJukeboxAudio}
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

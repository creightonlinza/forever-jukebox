import React from "react";
import { createPortal } from "react-dom";
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
import { formatDuration, formatTime } from "@/shared/utils/format";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "@/shared/utils/safeStorage";
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
  AUDIO_MODE_INTENSITY_PARAM,
  DEFAULT_AUDIO_MODE_INTENSITY,
  MAX_AUDIO_MODE_INTENSITY,
  MIN_AUDIO_MODE_INTENSITY,
  audioModeChangeAffectsPlayback,
  audioModeSupportsIntensity,
  clampAudioModeIntensity,
  parseAudioModeIntensityParam,
  setAudioModeIntensityParam,
} from "@forever-jukebox/shared/audio/audioModes";
import { getOrCreateSwingBuffer } from "@forever-jukebox/shared/audio/swingBufferCache";
import { renderSwingBuffer } from "@forever-jukebox/shared/audio/swingRenderer";
import {
  DEFAULT_MIN_LONG_BRANCH_PERCENT,
  Edge,
  findBackwardTwin,
  JukeboxConfig,
  JukeboxEngine,
} from "@forever-jukebox/shared";
import {
  DEFAULT_VISUALIZATION_INDEX,
  VISUALIZATION_LABELS,
  visualizationSeparatesPairedEdges,
} from "@forever-jukebox/shared/constants/visualization";
import {
  createToastQueue,
  type ToastQueue,
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
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/shared/autocanonizer/AutocanonizerViz";
import { JukeboxController } from "@forever-jukebox/shared/viz/JukeboxController";
import { useAppState } from "../state/AppState";
import { ProgressSteps, ProgressStep } from "@/ui/components/ProgressSteps";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { useWakeLock } from "./listen/useWakeLock";
import { useMarquee } from "./listen/useMarquee";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  resolveSupportedLanguage,
  supportedLanguageOptions,
} from "../i18n";
import { applyTheme, resolveStoredTheme, type ThemeName } from "../theme";

const STEP_ORDER: AnalyzeStage[] = [
  "loading",
  "decoding",
  "beats",
  "features",
  "building",
  "ready",
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
  randomBranchChanceDelta: 0.02,
  minLongBranch: 0,
  minLongBranchPercent: DEFAULT_MIN_LONG_BRANCH_PERCENT,
};

const CANONIZER_FINISH_STORAGE_KEY = "fj-canonizer-finish";
const VISUALIZATION_STORAGE_KEY = "fj-viz";
const ANCHOR_HIGHLIGHT_STORAGE_KEY = "fj-highlight-anchor-branch";
const BRANCH_STATS_STORAGE_KEY = "fj-branch-stats-enabled";
const AUDIO_MODE_QUERY_KEY = "am";
const MAX_EXPORT_DURATION_SECONDS = 60 * 60 * 2;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const RANDOM_BRANCH_DELTA_PERCENT_SCALE = 100 / MAX_RANDOM_BRANCH_DELTA;
const MIN_JUMP_DISTANCE_OPTIONS = [0, 5, 10, 20, 30] as const;
type ShortcutToastQueue = ToastQueue<{ message: string }>;

function ShortcutToastStack({ queue }: { queue: ShortcutToastQueue }) {
  const toasts = React.useSyncExternalStore(queue.subscribe, queue.getItems);
  return (
    <div className="shortcut-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={
            toast.exiting ? "shortcut-toast exiting" : "shortcut-toast"
          }
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

type PlayMode = "jukebox" | "autocanonizer";
type TuningModalTab = "tuning" | "extras";
type AudioExportFormat = "mp3" | "wav";

type SleepTimerOption = {
  durationMs: number | null;
};

type SleepTimerState = {
  configuredDurationMs: number | null;
  endTimeMs: number | null;
  remainingMs: number;
};

const SLEEP_TIMER_OPTIONS: SleepTimerOption[] = [
  { durationMs: null },
  { durationMs: 15 * 60 * 1000 },
  { durationMs: 30 * 60 * 1000 },
  { durationMs: 45 * 60 * 1000 },
  { durationMs: 60 * 60 * 1000 },
  { durationMs: 2 * 60 * 60 * 1000 },
];

function getSleepTimerOptionValue(durationMs: number | null) {
  return durationMs === null ? "off" : String(durationMs);
}

function getSleepTimerDurationFromValue(value: string) {
  if (value === "off") {
    return null;
  }
  const durationMs = Number(value);
  const matchedOption = SLEEP_TIMER_OPTIONS.find(
    (option) => option.durationMs === durationMs,
  );
  return matchedOption ? matchedOption.durationMs : null;
}

function resolveSleepTimerDuration(durationMs: number | null) {
  return SLEEP_TIMER_OPTIONS.some((option) => option.durationMs === durationMs)
    ? durationMs
    : null;
}

function formatSleepTimerRemaining(remainingMs: number) {
  return formatDuration(Math.ceil(Math.max(0, remainingMs) / 1000));
}

function exportProgressMessage(
  message: JukeboxExportProgress["message"],
  t: TFunction,
) {
  switch (message.kind) {
    case "initializing":
      return t("export.initializing");
    case "preparingSwing":
      return t("listen.preparingSwing");
    case "planning":
      return t("export.planning");
    case "renderingChunk":
      return t("export.renderingChunk", message);
    case "encodingChunk":
      return t("export.encodingChunk", message);
    case "combiningChunks":
      return t("export.combiningChunks");
    case "renderingAudio":
      return t("export.renderingAudio");
    case "encodingFormat":
      return t("export.encodingFormat", message);
    case "finalizing":
      return t("export.finalizing");
  }
}

function exportErrorMessage(error: unknown, t: TFunction) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message ===
    "WAV export is too large for browser memory at this duration. Use MP3 for long exports."
  ) {
    return t("export.wavTooLarge");
  }
  if (message === "Swing export requires beat analysis.") {
    return t("export.swingNeedsBeats");
  }
  return t("export.failed");
}

function sleepTimerOptionLabel(durationMs: number | null, t: TFunction) {
  if (durationMs === null) {
    return t("sleepTimer.off");
  }
  if (durationMs === 60 * 60 * 1000) {
    return t("sleepTimer.oneHour");
  }
  if (durationMs === 2 * 60 * 60 * 1000) {
    return t("sleepTimer.twoHours");
  }
  return t("sleepTimer.minutes", { count: durationMs / 60_000 });
}

type ExtrasFormState = {
  branchStatsEnabled: boolean;
  bringItHomeMode: boolean;
  audioMode: JukeboxAudioMode;
  audioIntensity: number;
};

type AudioModeSection = {
  titleKey: "audioModes.playbackStyles" | "audioModes.remixToys";
  options: JukeboxAudioMode[];
};

const AUDIO_MODE_SECTIONS: AudioModeSection[] = [
  {
    titleKey: "audioModes.playbackStyles",
    options: [
      "nightcore",
      "daycore",
      "vaporwave",
      "eight_d",
      "lofi",
      "eight_bit",
      "underwater",
      "cathedral",
    ],
  },
  {
    titleKey: "audioModes.remixToys",
    options: ["cowbell", "swing"],
  },
];

function audioModeLabel(audioMode: JukeboxAudioMode, t: TFunction) {
  const keys: Record<
    JukeboxAudioMode,
    | "common.off"
    | "audioModes.nightcore"
    | "audioModes.daycore"
    | "audioModes.vaporwave"
    | "audioModes.eightD"
    | "audioModes.lofi"
    | "audioModes.eightBit"
    | "audioModes.underwater"
    | "audioModes.cathedral"
    | "audioModes.cowbell"
    | "audioModes.swing"
  > = {
    off: "common.off",
    nightcore: "audioModes.nightcore",
    daycore: "audioModes.daycore",
    vaporwave: "audioModes.vaporwave",
    eight_d: "audioModes.eightD",
    lofi: "audioModes.lofi",
    eight_bit: "audioModes.eightBit",
    underwater: "audioModes.underwater",
    cathedral: "audioModes.cathedral",
    cowbell: "audioModes.cowbell",
    swing: "audioModes.swing",
  };
  return t(keys[audioMode]);
}

function formatAudioModeTitleLabel(audioMode: JukeboxAudioMode, t: TFunction) {
  return audioModeLabel(audioMode, t).toLocaleLowerCase();
}

function getAudioModeInputId(mode: JukeboxAudioMode) {
  return `audio-mode-${mode.replaceAll("_", "-")}`;
}

function AudioModeRadio({
  option,
  checked,
  disabled,
  onChange,
  className = "",
}: {
  option: JukeboxAudioMode;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={`audio-mode-option ${className}`.trim()}>
      <input
        id={getAudioModeInputId(option)}
        type="radio"
        name="audio-mode"
        value={option}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span>{audioModeLabel(option, t)}</span>
    </label>
  );
}

function AudioModeSectionGroup({
  section,
  selectedAudioMode,
  disabled,
  onChange,
  intensityPct,
  onIntensityChange,
}: {
  section: AudioModeSection;
  selectedAudioMode: JukeboxAudioMode;
  disabled: boolean;
  onChange: (mode: JukeboxAudioMode) => void;
  intensityPct: number;
  onIntensityChange: (intensityPct: number) => void;
}) {
  const { t } = useTranslation();
  const showIntensity =
    section.options.includes(selectedAudioMode) &&
    audioModeSupportsIntensity(selectedAudioMode);
  return (
    <div className="audio-mode-section">
      <div className="audio-mode-section-title">{t(section.titleKey)}</div>
      <div className="audio-mode-section-options">
        {section.options.map((option) => (
          <AudioModeRadio
            key={option}
            option={option}
            checked={selectedAudioMode === option}
            disabled={disabled}
            onChange={() => onChange(option)}
          />
        ))}
      </div>
      {showIntensity ? (
        <label>
          <div className="label-line">
            <span>{t("audioModes.intensity")}</span>
            <span>{intensityPct}%</span>
          </div>
          <input
            id="audio-intensity"
            type="range"
            aria-label={t("audioModes.intensity")}
            min={MIN_AUDIO_MODE_INTENSITY}
            max={MAX_AUDIO_MODE_INTENSITY}
            step={5}
            value={intensityPct}
            disabled={disabled}
            onChange={(event) => onIntensityChange(Number(event.target.value))}
          />
        </label>
      ) : null}
    </div>
  );
}

function AudioModeOptions({
  selectedAudioMode,
  disabled,
  onChange,
  intensityPct,
  onIntensityChange,
}: {
  selectedAudioMode: JukeboxAudioMode;
  disabled: boolean;
  onChange: (mode: JukeboxAudioMode) => void;
  intensityPct: number;
  onIntensityChange: (intensityPct: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="audio-mode-options"
      role="radiogroup"
      aria-label={t("tuning.audioMode")}
    >
      <AudioModeRadio
        option="off"
        className="audio-mode-default-option"
        checked={selectedAudioMode === "off"}
        disabled={disabled}
        onChange={() => onChange("off")}
      />
      {AUDIO_MODE_SECTIONS.map((section) => (
        <AudioModeSectionGroup
          key={section.titleKey}
          section={section}
          selectedAudioMode={selectedAudioMode}
          disabled={disabled}
          onChange={onChange}
          intensityPct={intensityPct}
          onIntensityChange={onIntensityChange}
        />
      ))}
    </div>
  );
}

function getVisualizationLabel(index: number, t: TFunction) {
  return VISUALIZATION_LABELS[index] ??
    t("listen.visualizationNumber", { number: index + 1 });
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
  const stored = safeLocalStorageGet(ANCHOR_HIGHLIGHT_STORAGE_KEY);
  return stored === "1" || stored === "true";
}

function resolveStoredBranchStatsEnabled(): boolean {
  const stored = safeLocalStorageGet(BRANCH_STATS_STORAGE_KEY);
  return stored === "1" || stored === "true";
}

function storeAnchorHighlight(enabled: boolean) {
  safeLocalStorageSet(ANCHOR_HIGHLIGHT_STORAGE_KEY, enabled ? "1" : "0");
}

function storeBranchStatsEnabled(enabled: boolean) {
  safeLocalStorageSet(BRANCH_STATS_STORAGE_KEY, enabled ? "1" : "0");
}

function parseAudioMode(value: string | null): JukeboxAudioMode | null {
  if (
    value === "off" ||
    value === "nightcore" ||
    value === "daycore" ||
    value === "vaporwave" ||
    value === "eight_d" ||
    value === "eight_bit" ||
    value === "lofi" ||
    value === "underwater" ||
    value === "cathedral" ||
    value === "cowbell" ||
    value === "swing"
  ) {
    return value;
  }
  return null;
}

function resolveAudioModeFromUrl(): JukeboxAudioMode {
  if (typeof window === "undefined") {
    return "off";
  }
  const params = new URLSearchParams(window.location.search);
  return parseAudioMode(params.get(AUDIO_MODE_QUERY_KEY)) ?? "off";
}

function resolveAudioIntensityFromUrl(): number {
  if (typeof window === "undefined") {
    return DEFAULT_AUDIO_MODE_INTENSITY;
  }
  const params = new URLSearchParams(window.location.search);
  return parseAudioModeIntensityParam(
    params.get(AUDIO_MODE_INTENSITY_PARAM),
    parseAudioMode(params.get(AUDIO_MODE_QUERY_KEY)),
  );
}

function writeAudioModeToUrl(
  mode: JukeboxAudioMode,
  intensityPct: number,
  replace = true,
) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (mode === "off") {
    url.searchParams.delete(AUDIO_MODE_QUERY_KEY);
  } else {
    url.searchParams.set(AUDIO_MODE_QUERY_KEY, mode);
  }
  setAudioModeIntensityParam(url.searchParams, mode, intensityPct);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
    return;
  }
  window.history.pushState({}, "", url.toString());
}

function formatTrackTitle(
  baseTitle: string,
  playMode: PlayMode,
  audioMode: JukeboxAudioMode,
  t: TFunction,
) {
  if (playMode === "autocanonizer") {
    return `${baseTitle} (${t("listen.autocanonized")})`;
  }
  if (audioMode !== "off") {
    return `${baseTitle} (${formatAudioModeTitleLabel(audioMode, t)})`;
  }
  return baseTitle;
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
  minLongBranchPercent: number;
  removeSequentialBranches: boolean;
};

function formatMinJumpDistance(percent: number, t: TFunction) {
  return percent === 0
    ? t("tuning.anyDistance")
    : t("tuning.percentOfTrack", { percent });
}

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "button" ||
    tag === "select" ||
    tag === "a" ||
    target.isContentEditable
  );
}

function toSimilarityPercent(distance: number, maxDistance: number) {
  if (!Number.isFinite(distance) || maxDistance <= 0) {
    return 0;
  }
  const normalized = 1 - distance / maxDistance;
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

function nextEdgeIndex(currentIndex: number, direction: number, edgeCount: number) {
  if (currentIndex >= 0) {
    return (currentIndex + direction + edgeCount) % edgeCount;
  }
  return direction > 0 ? 0 : edgeCount - 1;
}

function progressStepStatus(index: number, activeIndex: number): ProgressStep["status"] {
  if (index < activeIndex) {
    return "done";
  }
  return index === activeIndex ? "active" : "pending";
}

function analysisStageLabel(stage: AnalyzeStage, t: TFunction) {
  const keys: Record<
    Exclude<AnalyzeStage, "cached">,
    | "analysis.loading"
    | "analysis.decoding"
    | "analysis.beats"
    | "analysis.features"
    | "analysis.segments"
    | "analysis.building"
    | "analysis.ready"
  > = {
    loading: "analysis.loading",
    decoding: "analysis.decoding",
    beats: "analysis.beats",
    features: "analysis.features",
    segments: "analysis.segments",
    building: "analysis.building",
    ready: "analysis.ready",
  };
  const normalizedStage: Exclude<AnalyzeStage, "cached"> =
    stage === "cached" ? "ready" : stage;
  return t(keys[normalizedStage]);
}

function playControlText({
  swingPreparing,
  isRunning,
  isPaused,
  t,
}: {
  swingPreparing: boolean;
  isRunning: boolean;
  isPaused: boolean;
  t: TFunction;
}) {
  if (swingPreparing) {
    return t("listen.preparingSwing");
  }
  if (isRunning) {
    return t("listen.pause");
  }
  return isPaused ? t("listen.resume") : t("listen.play");
}

function playControlIcon(swingPreparing: boolean, isRunning: boolean) {
  if (swingPreparing) {
    return "hourglass_top";
  }
  return isRunning ? "pause" : "play_arrow";
}

function formatPlayVelocity(velocity: number) {
  return velocity > 0 ? `+${velocity}` : `${velocity}`;
}

function branchDirection(edge: Edge, t: TFunction) {
  if (edge.dest.which < edge.src.which) {
    return t("listen.backward");
  }
  if (edge.dest.which > edge.src.which) {
    return t("listen.forward");
  }
  return t("listen.sameBeat");
}

export function Listen({ isActive = true }: { isActive?: boolean }) {
  const { t, i18n } = useTranslation();
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
  const [activeVizIndex, setActiveVizIndex] = React.useState(() => {
    const raw = safeLocalStorageGet(VISUALIZATION_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number.parseInt(raw, 10);
      return coerceVisualizationIndex(parsed);
    }
    return DEFAULT_VISUALIZATION_INDEX;
  });
  const [playMode, setPlayMode] = React.useState<PlayMode>("jukebox");
  const [highlightAnchorBranch, setHighlightAnchorBranch] = React.useState<boolean>(
    () => resolveStoredAnchorHighlight(),
  );
  const [finishOutSong, setFinishOutSong] = React.useState<boolean>(() => {
    return safeLocalStorageGet(CANONIZER_FINISH_STORAGE_KEY) === "true";
  });
  const [tuneForm, setTuneForm] = React.useState<TuneFormState>({
    threshold: 0,
    computedThreshold: 0,
    minProb: Math.round(DEFAULT_CONFIG.minRandomBranchChance * 100),
    maxProb: Math.round(DEFAULT_CONFIG.maxRandomBranchChance * 100),
    ramp:
      Math.round(
        DEFAULT_CONFIG.randomBranchChanceDelta *
          RANDOM_BRANCH_DELTA_PERCENT_SCALE *
          10,
      ) / 10,
    volume: 100,
    highlightAnchorBranch,
    justBackwards: DEFAULT_CONFIG.justBackwards,
    minLongBranchPercent: 0,
    removeSequentialBranches: DEFAULT_CONFIG.removeSequentialBranches,
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
      destination: player.getOverlayDestination(),
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
    safeLocalStorageSet(VISUALIZATION_STORAGE_KEY, String(activeVizIndex));
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
    safeLocalStorageSet(CANONIZER_FINISH_STORAGE_KEY, String(finishOutSong));
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
          playerRef.current?.getBuffer() ?? null,
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
        setSwingPreparingState(false);
        setSwingProgress(0);
        setJukeboxAudioMode("off");
        setExtrasForm((prev) => ({ ...prev, audioMode: "off" }));
        player.setJukeboxAudioMode("off");
        writeAudioModeToUrl("off", DEFAULT_AUDIO_MODE_INTENSITY, true);
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
    engine.updateConfig(DEFAULT_CONFIG);
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

      const result = await exportJukeboxAudio({
        analysis: activeAnalysis,
        sourceBuffer,
        config: engine.getConfig(),
        deletedEdges,
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
    const stageIndex = STEP_ORDER.findIndex((step) => step === progressStage);
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
      ? (() => {
          const startSeconds = Math.max(0, selectedEdge.src.start);
          const endSeconds = Math.max(0, selectedEdge.dest.start);
          const startDisplaySeconds = Math.floor(startSeconds);
          const endDisplaySeconds = Math.floor(endSeconds);
          const deltaSeconds = endDisplaySeconds - startDisplaySeconds;
          const maxDistance = Math.max(
            1,
            engineRef.current?.getConfig().maxBranchThreshold ?? 80,
          );
          const signedDelta =
            `${deltaSeconds >= 0 ? "+" : "-"}${formatDuration(Math.abs(deltaSeconds))}`;
          const beatDelta = selectedEdge.dest.which - selectedEdge.src.which;
          return {
            id: selectedEdge.id,
            start: formatDuration(startDisplaySeconds),
            end: formatDuration(endDisplaySeconds),
            delta: signedDelta,
            startBeat: String(selectedEdge.src.which),
            endBeat: String(selectedEdge.dest.which),
            beatDelta: `${beatDelta >= 0 ? "+" : "-"}${Math.abs(beatDelta)}`,
            direction: branchDirection(selectedEdge, t),
            similarity: `${toSimilarityPercent(selectedEdge.distance, maxDistance)}%`,
          };
        })()
      : null;

  const closeSettings = () => setIsSettingsOpen(false);
  const settingsModal = isSettingsOpen
    ? createPortal(
        <div
          id="settings-modal"
          className="modal open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <button
            className="modal-backdrop"
            type="button"
            onClick={closeSettings}
            aria-label={t("common.close")}
          />
          <div className="modal-panel settings-panel">
            <div className="modal-header">
              <h2 id="settings-title">{t("settings.title")}</h2>
              <button
                id="settings-close"
                className="modal-close"
                type="button"
                onClick={closeSettings}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <SymbolIcon className="modal-close-icon" name="close" />
              </button>
            </div>
            <div className="modal-body settings-body">
              <section className="settings-section">
                <label className="settings-field" htmlFor="settings-language">
                  <span className="label-line">{t("settings.language")}</span>
                  <span className="viz-select-wrap settings-select-wrap">
                    <select
                      id="settings-language"
                      className="viz-select settings-select"
                      value={resolveSupportedLanguage(i18n.resolvedLanguage)}
                      onChange={(event) => {
                        void i18n.changeLanguage(event.target.value);
                      }}
                    >
                      {supportedLanguageOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <SymbolIcon
                      className="viz-select-arrow"
                      name="arrow_drop_down"
                    />
                  </span>
                </label>
              </section>

              <section className="settings-section">
                <fieldset className="settings-fieldset">
                  <legend className="label-line">{t("settings.theme")}</legend>
                  <div className="settings-theme-options">
                    {(["light", "dark"] as const).map((option) => (
                      <label key={option} className="settings-theme-option">
                        <input
                          type="radio"
                          name="settings-theme"
                          value={option}
                          checked={theme === option}
                          onChange={() => {
                            setTheme(option);
                            applyTheme(option);
                            vizControllerRef.current?.refresh();
                          }}
                        />
                        <span>{t(`common.${option}`)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>

              <section className="settings-section">
                <div className="label-line">{t("settings.sleepTimer")}</div>
                <div id="sleep-timer-current" className="sleep-timer-current">
                  {sleepTimer.remainingMs > 0
                    ? t("sleepTimer.currentCountdown", {
                        time: formatSleepTimerRemaining(sleepTimer.remainingMs),
                      })
                    : t("sleepTimer.off")}
                </div>
                <label className="settings-field" htmlFor="sleep-timer-select">
                  <span className="label-line">{t("sleepTimer.timer")}</span>
                  <span className="viz-select-wrap settings-select-wrap">
                    <select
                      id="sleep-timer-select"
                      className="viz-select settings-select"
                      value={getSleepTimerOptionValue(
                        pendingSleepTimerDurationMs,
                      )}
                      onChange={(event) =>
                        setPendingSleepTimerDurationMs(
                          getSleepTimerDurationFromValue(event.target.value),
                        )
                      }
                    >
                      {SLEEP_TIMER_OPTIONS.map((option) => (
                        <option
                          key={getSleepTimerOptionValue(option.durationMs)}
                          value={getSleepTimerOptionValue(option.durationMs)}
                        >
                          {sleepTimerOptionLabel(option.durationMs, t)}
                        </option>
                      ))}
                    </select>
                    <SymbolIcon
                      className="viz-select-arrow"
                      name="arrow_drop_down"
                    />
                  </span>
                </label>
              </section>
            </div>
            <div className="modal-footer settings-footer">
              <button
                id="settings-cancel"
                className="tab-btn"
                type="button"
                onClick={closeSettings}
              >
                {t("common.close")}
              </button>
              <button
                id="sleep-timer-set"
                className="tab-btn"
                type="button"
                onClick={() => {
                  setSleepTimer(pendingSleepTimerDurationMs);
                  closeSettings();
                }}
              >
                {t("common.set")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

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
      {isAnalyzing ? (
        <div className="panel" id="play-status">
          <ProgressSteps
            steps={steps}
            currentMessage={progressMessage}
            currentProgress={progressPercent}
          />
        </div>
      ) : null}
      {!isAnalyzing && swingPreparing ? (
        <div className="panel" id="play-status">
          <div className="progress">
            <div className="progress__header">
              <p className="progress__title">
                {t("listen.preparingSwingPercent", { percent: swingProgress })}
              </p>
              <p className="progress__message">{t("listen.addingSwing")}</p>
            </div>
            <div className="progress-bar" aria-hidden="true">
              <div
                className="progress-bar-fill"
                style={{ width: `${swingProgress}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {showPlaybackUi ? (
        <div className="menu-bar">
          <div className="menu-left">
            <div className="play-title" ref={playTitleRef}></div>
            {playMode === "jukebox" && bringItHomeMode ? (
              <span className="bring-home-note">{t("listen.bringingHome")}</span>
            ) : null}
          </div>
          <div className="menu-right">
            <button
              id="tuning"
              className={`tune-toggle ${playMode === "autocanonizer" ? "is-hidden" : ""}`}
              type="button"
              onClick={() => openTuningModalTab("tuning")}
              disabled={!analysis || playMode === "autocanonizer"}
              title={t("listen.tune")}
              aria-label={t("listen.tune")}
            >
              <SymbolIcon className="tune-icon" name="tune" />
            </button>
            <button
              id="track-info"
              className={`info-toggle ${playMode === "autocanonizer" ? "is-hidden" : ""}`}
              type="button"
              onClick={() => setIsInfoOpen(true)}
              disabled={!analysis || playMode === "autocanonizer"}
              title={t("listen.info")}
              aria-label={t("listen.info")}
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
              title={t("listen.exportAudio")}
              aria-label={t("listen.exportAudio")}
            >
              <SymbolIcon className="copy-icon" name="download" />
            </button>
          </div>
        </div>
      ) : null}

      <div id="viz-panel" ref={vizPanelRef} hidden={!showPlaybackUi}>
        <div id="jukebox-viz" className={`viz ${playMode === "autocanonizer" ? "is-canonizer" : ""}`}>
          {branchStats ? (
            <div className="branch-stats-popup">
              <div className="branch-stats-popup-header">
                <div className="branch-stats-popup-title">
                  Branch #{branchStats.id} stats
                </div>
                <button
                  id="branch-stats-delete"
                  className="branch-stats-delete"
                  type="button"
                  aria-label={t("listen.deleteBranch")}
                  title={t("listen.deleteBranch")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    deleteSelectedBranch();
                  }}
                  disabled={Boolean(selectedEdge?.deleted)}
                >
                  <SymbolIcon className="branch-stats-delete-icon" name="delete" />
                </button>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.direction")}</span>
                <span className="branch-stats-popup-value">{branchStats.direction}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.startTime")}</span>
                <span className="branch-stats-popup-value">{branchStats.start}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.endTime")}</span>
                <span className="branch-stats-popup-value">{branchStats.end}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.timeDifference")}</span>
                <span className="branch-stats-popup-value">{branchStats.delta}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.startBeat")}</span>
                <span className="branch-stats-popup-value">{branchStats.startBeat}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.endBeat")}</span>
                <span className="branch-stats-popup-value">{branchStats.endBeat}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.beatDifference")}</span>
                <span className="branch-stats-popup-value">{branchStats.beatDelta}</span>
              </div>
              <div className="branch-stats-popup-row">
                <span className="branch-stats-popup-label">{t("listen.branchMatch")}</span>
                <span className="branch-stats-popup-value">{branchStats.similarity}</span>
              </div>
            </div>
          ) : null}
          <div className="viz-top">
            <div className="viz-actions">
              <label className="viz-select-group" htmlFor="play-mode-select">
                <span className="viz-select-wrap">
                  <select
                    id="play-mode-select"
                    className="viz-select"
                    aria-label={t("listen.mode")}
                    value={playMode}
                    onChange={(event) =>
                      onSetPlayMode(
                        event.target.value === "autocanonizer"
                          ? "autocanonizer"
                          : "jukebox"
                      )
                    }
                  >
                    <option value="autocanonizer">{t("listen.autocanonizer")}</option>
                    <option value="jukebox">{t("listen.jukebox")}</option>
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
                    aria-label={t("listen.visualization")}
                    value={String(activeVizIndex)}
                    onChange={(event) => onSetActiveViz(Number(event.target.value))}
                    disabled={playMode === "autocanonizer"}
                  >
                    {Array.from({ length: vizCount }, (_, index) => (
                      <option key={index} value={index}>
                        {getVisualizationLabel(index, t)}
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
              <span>{t("listen.finishTrack")}</span>
            </div>
          </div>
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
              <div className="viz-info">
                <div className="viz-title" id="viz-now-playing" ref={vizTitleRef}></div>
                <div className="viz-meta">
                  <span
                    id="autocanonizer-times"
                    className={`autocanonizer-times ${playMode === "autocanonizer" ? "" : "is-hidden"}`}
                  >
                    <span
                      id="autocanonizer-main-time"
                      style={{ color: AUTOCANONIZER_MAIN_COLOR }}
                    >
                      {formatTime(autocanonizerMainSeconds)}
                    </span>
                    <span aria-hidden="true">–</span>
                    <span
                      id="autocanonizer-other-time"
                      style={{ color: AUTOCANONIZER_OTHER_COLOR }}
                    >
                      {formatTime(autocanonizerOtherSeconds)}
                    </span>
                    <span aria-hidden="true">/</span>
                    <span id="autocanonizer-total-time">
                      {formatTime(analysis?.track?.duration ?? 0)}
                    </span>
                  </span>
                  <span className="viz-meta-stats">
                    <span>{t("listen.listenTime")}</span>
                    <span>{formatDuration(listenSeconds)}</span>
                    <span className={`viz-divider ${playMode === "autocanonizer" ? "is-hidden" : ""}`}>·</span>
                    <span className={playMode === "autocanonizer" ? "is-hidden" : ""}>{beatsLabel}</span>
                    <span className={playMode === "autocanonizer" ? "is-hidden" : ""}>{beatsPlayed}</span>
                  </span>
                  {playMode === "jukebox" && bringItHomeMode ? (
                    <span className="bring-home-fullscreen-note">· Bringing it on home</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="viz-bottom-right">
              {playMode === "autocanonizer" ? (
                <div className="pan-control-wrap">
                  <div
                    className={`pan-control-panel ${
                      isPanOpen ? "" : "is-hidden"
                    }`}
                    ref={panPanelRef}
                  >
                    <label className="stream-pan-control">
                      <div className="label-line">
                        <span className="pan-end-label">
                          {t("listen.balanceLeft")}
                        </span>
                        <span style={{ color: AUTOCANONIZER_MAIN_COLOR }}>
                          {t("listen.blueBalance")}
                        </span>
                        <span className="pan-end-label">
                          {t("listen.balanceRight")}
                        </span>
                      </div>
                      <input
                        id="autocanonizer-main-pan"
                        className="pan-slider stream-pan-slider"
                        type="range"
                        aria-label={t("listen.blueBalance")}
                        min={-100}
                        max={100}
                        step={1}
                        list="autocanonizer-pan-ticks"
                        value={autocanonizerMainPan}
                        style={{ accentColor: AUTOCANONIZER_MAIN_COLOR }}
                        onChange={(event) =>
                          onAutocanonizerStreamPanChange(
                            "main",
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="stream-pan-control">
                      <div className="label-line">
                        <span className="pan-end-label">
                          {t("listen.balanceLeft")}
                        </span>
                        <span style={{ color: AUTOCANONIZER_OTHER_COLOR }}>
                          {t("listen.greenBalance")}
                        </span>
                        <span className="pan-end-label">
                          {t("listen.balanceRight")}
                        </span>
                      </div>
                      <input
                        id="autocanonizer-other-pan"
                        className="pan-slider stream-pan-slider"
                        type="range"
                        aria-label={t("listen.greenBalance")}
                        min={-100}
                        max={100}
                        step={1}
                        list="autocanonizer-pan-ticks"
                        value={autocanonizerOtherPan}
                        style={{ accentColor: AUTOCANONIZER_OTHER_COLOR }}
                        onChange={(event) =>
                          onAutocanonizerStreamPanChange(
                            "other",
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>
                    <datalist id="autocanonizer-pan-ticks">
                      <option value={-100} />
                      <option value={0} />
                      <option value={100} />
                    </datalist>
                  </div>
                  <button
                    id="autocanonizer-pan-button"
                    className="volume-button pan-button"
                    type="button"
                    ref={panButtonRef}
                    onClick={() => {
                      setIsVolumeOpen(false);
                      setIsPanOpen((prev) => !prev);
                    }}
                    title={t("listen.audioBalance")}
                    aria-label={t("listen.audioBalance")}
                  >
                    <SymbolIcon className="pan-icon" name="swap_horiz" />
                  </button>
                </div>
              ) : null}
              <div className="volume-control-wrap">
                <div
                  className={`volume-control-panel ${
                    isVolumeOpen ? "" : "is-hidden"
                  }`}
                  ref={volumePanelRef}
                >
                  <label>
                    <input
                      className="volume-slider"
                      type="range"
                      aria-label={t("listen.volume")}
                      min={0}
                      max={100}
                      step={1}
                      value={tuneForm.volume}
                      onChange={(event) =>
                        onVolumeChange(Number(event.target.value))
                      }
                    />
                    <div className="label-line">
                      <span className="volume-value">{tuneForm.volume}</span>
                    </div>
                  </label>
                </div>
                <button
                  id="volume-button"
                  className="volume-button"
                  type="button"
                  ref={volumeButtonRef}
                  onClick={() => {
                    setIsPanOpen(false);
                    setIsVolumeOpen((prev) => !prev);
                  }}
                  title={t("listen.volume")}
                  aria-label={t("listen.volume")}
                >
                  <SymbolIcon className="volume-icon" name="volume_up" />
                </button>
              </div>
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
        <div className="modal open">
          <button
            className="modal-backdrop"
            type="button"
            onClick={() => setIsExportOpen(false)}
            aria-label={t("listen.closeExportDialog")}
            disabled={isExporting}
          />
          <div className="modal-panel">
            <div className="modal-header">
              <h2>{t("export.title")}</h2>
              <button
                className="modal-close"
                type="button"
                onClick={() => setIsExportOpen(false)}
                aria-label={t("common.close")}
                title={t("common.close")}
                disabled={isExporting}
              >
                <SymbolIcon className="modal-close-icon" name="close" />
              </button>
            </div>
            <div className="modal-body export-body">
              <p className="export-note">
                {t("export.note")}
              </p>
              <label>
                <div className="label-line">
                  <span>{t("export.duration")}</span>
                  <span>{formatDuration(exportForm.durationSeconds)}</span>
                </div>
                <input
                  className="field-input"
                  type="number"
                  aria-label={t("export.duration")}
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
                <div className="label-line">{t("export.format")}</div>
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
                  <option value="mp3">{t("export.mp3")}</option>
                  <option value="wav">{t("export.wav")}</option>
                </select>
              </label>
              {exportForm.format === "mp3" ? (
                <label>
                  <div className="label-line">
                    <span>{t("export.bitrate")}</span>
                    <span>{exportForm.bitrateKbps} kbps</span>
                  </div>
                  <input
                    type="range"
                    aria-label={t("export.bitrate")}
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
                  {exportProgressMessage(exportProgress.message, t)} (
                  {Math.round(exportProgress.percent)}%)
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
                {t("common.cancel")}
              </button>
              <button
                className="tab-btn"
                type="button"
                onClick={handleExportJukeboxAudio}
                disabled={isExporting}
              >
                {isExporting ? t("export.exporting") : t("export.action")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isTuningOpen ? (
        <div className="modal open">
          <button
            className="modal-backdrop"
            type="button"
            onClick={() => setIsTuningOpen(false)}
            aria-label={t("listen.closeTuningDialog")}
          />
          <div className="modal-panel">
            <div className="modal-header">
              <div className="modal-header-main">
                <h2
                  id="tuning-title"
                  className={tuningActiveTab === "extras" ? "is-extras-active" : ""}
                >
                  <span id="tuning-title-text">
                    {tuningActiveTab === "tuning"
                      ? t("tuning.title")
                      : t("tuning.extras")}
                  </span>
                </h2>
                <div className="modal-tabs" aria-label={t("tuning.sections")}>
                  <button
                    id="tuning-tab-toggle"
                    className={`modal-tab ${playMode !== "jukebox" ? "hidden" : ""}`}
                    type="button"
                    onClick={() =>
                      setTuningActiveTab(tuningActiveTab === "tuning" ? "extras" : "tuning")
                    }
                    aria-label={
                      tuningActiveTab === "tuning"
                        ? t("tuning.switchToExtras")
                        : t("tuning.switchToTuning")
                    }
                  >
                    <SymbolIcon
                      className="modal-tab-icon"
                      name={tuningActiveTab === "tuning" ? "science" : "tune"}
                    />
                    <span id="tuning-tab-toggle-label">
                      {tuningActiveTab === "tuning"
                        ? t("tuning.extras")
                        : t("tuning.title")}
                    </span>
                  </button>
                </div>
              </div>
              <div className="modal-header-actions">
                <button className="modal-close" type="button" onClick={() => setIsTuningOpen(false)} aria-label={t("common.close")} title={t("common.close")}>
                  <SymbolIcon className="modal-close-icon" name="close" />
                </button>
              </div>
            </div>
            <div className="modal-body">
              <div id="tuning-panel-tuning" className={tuningActiveTab === "tuning" ? "" : "hidden"}>
                <label>
                  <div className="label-line">
                    <span>{t("tuning.similarityThreshold")}</span>
                    <span>{tuneForm.threshold}</span>
                  </div>
                  <div className="hint">
                    <span>{t("tuning.computedThreshold")}</span>
                    <span>{tuneForm.computedThreshold}</span>
                  </div>
                  <input
                    type="range"
                    aria-label={t("tuning.similarityThreshold")}
                    min={2}
                    max={80}
                    step={1}
                    value={tuneForm.threshold}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, threshold: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  <div className="label-line">
                    <span>{t("tuning.probabilityMin")}</span>
                    <span>{tuneForm.minProb}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={2}
                    value={tuneForm.minProb}
                    aria-label={t("tuning.probabilityMin")}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, minProb: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  <div className="label-line">
                    <span>{t("tuning.probabilityMax")}</span>
                    <span>{tuneForm.maxProb}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={2}
                    value={tuneForm.maxProb}
                    aria-label={t("tuning.probabilityMax")}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, maxProb: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  <div className="label-line">
                    <span>{t("tuning.rampSpeed")}</span>
                    <span>{tuneForm.ramp}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={2}
                    value={tuneForm.ramp}
                    aria-label={t("tuning.rampSpeed")}
                    onChange={(event) =>
                      setTuneForm((prev) => ({ ...prev, ramp: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  <div className="label-line">
                    <span>{t("tuning.minJumpDistance")}</span>
                    <span>
                      {formatMinJumpDistance(tuneForm.minLongBranchPercent, t)}
                    </span>
                  </div>
                  <div className="hint">
                    {t("tuning.minJumpDistanceHint")}
                  </div>
                  <input
                    id="min-jump-distance"
                    type="range"
                    min={0}
                    max={MIN_JUMP_DISTANCE_OPTIONS.length - 1}
                    step={1}
                    value={Math.max(
                      0,
                      MIN_JUMP_DISTANCE_OPTIONS.indexOf(
                        tuneForm.minLongBranchPercent as (typeof MIN_JUMP_DISTANCE_OPTIONS)[number],
                      ),
                    )}
                    aria-label={t("tuning.minJumpDistance")}
                    onChange={(event) =>
                      setTuneForm((prev) => ({
                        ...prev,
                        minLongBranchPercent:
                          MIN_JUMP_DISTANCE_OPTIONS[
                            Number(event.target.value)
                          ] ?? 0,
                      }))
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
                    <span>{t("tuning.onlyReverse")}</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={tuneForm.removeSequentialBranches}
                      onChange={(event) =>
                        setTuneForm((prev) => ({ ...prev, removeSequentialBranches: event.target.checked }))
                      }
                    />
                    <span>{t("tuning.removeSequential")}</span>
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
                    <span>{t("tuning.highlightAnchor")}</span>
                  </label>
                </div>
              </div>
              <div id="tuning-panel-extras" className={tuningActiveTab === "extras" ? "" : "hidden"}>
                <div className="checkbox-row extras-checkbox-row">
                  <label>
                    <input
                      id="extras-enabled"
                      type="checkbox"
                      checked={extrasForm.branchStatsEnabled}
                      onChange={(event) =>
                        setExtrasForm((prev) => ({
                          ...prev,
                          branchStatsEnabled: event.target.checked,
                        }))
                      }
                      disabled={playMode !== "jukebox"}
                    />
                    <span>{t("tuning.showBranchStats")}</span>
                  </label>
                  <label>
                    <input
                      id="bring-home-enabled"
                      type="checkbox"
                      checked={extrasForm.bringItHomeMode}
                      onChange={(event) =>
                        setExtrasForm((prev) => ({
                          ...prev,
                          bringItHomeMode: event.target.checked,
                        }))
                      }
                      disabled={playMode !== "jukebox"}
                    />
                    <span>{t("tuning.bringItHome")}</span>
                  </label>
                </div>
                <div id="jukebox-audio-mode-group" className="audio-mode-group">
                  <div className="label-line">{t("tuning.audioMode")}</div>
                  <AudioModeOptions
                    selectedAudioMode={extrasForm.audioMode}
                    disabled={playMode !== "jukebox"}
                    onChange={(audioMode) =>
                      setExtrasForm((prev) => ({ ...prev, audioMode }))
                    }
                    intensityPct={extrasForm.audioIntensity}
                    onIntensityChange={(audioIntensity) =>
                      setExtrasForm((prev) => ({ ...prev, audioIntensity }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer tuning-footer">
              <button className="tab-btn" type="button" onClick={onResetTuningModal}>{t("common.reset")}</button>
              <button className="tab-btn" type="button" onClick={onApplyTuningModal}>{t("common.apply")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {isInfoOpen ? (
        <div className="modal open">
          <button
            className="modal-backdrop"
            type="button"
            onClick={() => setIsInfoOpen(false)}
            aria-label={t("listen.closeTrackInfoDialog")}
          />
          <div className="modal-panel">
            <div className="modal-header">
              <h2>{t("info.title")}</h2>
              <button className="modal-close" type="button" onClick={() => setIsInfoOpen(false)} aria-label={t("common.close")} title={t("common.close")}>
                <SymbolIcon className="modal-close-icon" name="close" />
              </button>
            </div>
            <div className="modal-body info-body">
              <div className="info-row">
                <span className="info-label">{t("info.trackLength")}</span>
                <span>{formatDuration(analysis?.track?.duration ?? 0)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.totalBeats")}</span>
                <span>{totalBeats}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.totalBranches")}</span>
                <span>{totalBranches}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.deletedBranches")}</span>
                <span>{deletedBranches}</span>
              </div>
              <h4>{t("info.keyboardCommands")}</h4>
              <div className="info-row">
                <span className="info-label">{t("info.space")}</span>
                <span>{t("info.spaceAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.shift")}</span>
                <span>{t("info.shiftAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.arrows")}</span>
                <span>{t("info.arrowsAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">
                  {t("info.velocity")}
                  <span
                    className="info-help"
                    role="img"
                    title={t("info.velocityNote")}
                    aria-label={t("info.velocityNote")}
                  >
                    <SymbolIcon className="info-help-icon" name="help" />
                  </span>
                </span>
                <span>{t("info.velocityAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.velocityReset")}</span>
                <span>{t("info.velocityResetAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.freeze")}</span>
                <span>{t("info.freezeAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.anchor")}</span>
                <span>{t("info.anchorAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.delete")}</span>
                <span>{t("info.deleteAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.extras")}</span>
                <span>{t("info.extrasAction")}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{t("info.home")}</span>
                <span>{t("info.homeAction")}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <ShortcutToastStack queue={shortcutToastQueue} />
      </section>
      {settingsModal}
    </>
  );
}

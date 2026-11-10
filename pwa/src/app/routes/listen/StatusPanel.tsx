import { useTranslation } from "react-i18next";
import {
  LOADING_STEPS,
  LoadingProgress,
  type LiveLoading,
  type LoadingStepId,
} from "@forever-jukebox/shared/ui/LoadingProgress";
import type { AnalyzeStage } from "@/core/application/usecases/analyzeAudio";
import type { PreparingAudioMode } from "./labels";

export type PreparingPhase = "download" | "separate" | null;

// "loading" and "cached" come before an analysis starts, so they are the whole cached-track task.
const STAGE_STEPS: Record<AnalyzeStage, LoadingStepId> = {
  loading: "track",
  cached: "track",
  decoding: "beats",
  beats: "beats",
  features: "features",
  segments: "features",
  building: "track",
  ready: "track",
};

const TITLE_KEYS = {
  localAnalysis: "loading.analyzing",
  serverAnalysis: "loading.analyzing",
  track: "loading.loadingTrack",
  pending: "loading.loadingTrack",
  swing: "listen.preparingSwing",
  instrumental: "listen.preparingInstrumental",
  instrumentalWithModel: "listen.preparingInstrumental",
  wubmachine: "listen.preparingWubMachine",
} as const;

// The real loading state: an audio-mode render, the analysis, or a finished analysis; null hides the panel.
export function liveLoading({
  fileKey,
  isAnalyzing,
  analysisDone,
  stage,
  stageProgress,
  preparingMode,
  preparingPhase,
  preparingProgress,
  modelDownloaded,
}: {
  fileKey: string;
  isAnalyzing: boolean;
  analysisDone: boolean;
  stage: AnalyzeStage;
  stageProgress: number | null;
  preparingMode: PreparingAudioMode;
  preparingPhase: PreparingPhase;
  preparingProgress: number;
  modelDownloaded: boolean;
}): LiveLoading | null {
  // Instrumental shows its steps from the first progress event, which tells whether the model is downloaded.
  if (!isAnalyzing && preparingMode && !(preparingMode === "instrumental" && preparingPhase === null)) {
    const task = preparingMode === "instrumental" && modelDownloaded ? "instrumentalWithModel" : preparingMode;
    return {
      task,
      key: fileKey,
      activeId: preparingPhase === "separate" ? "separate" : LOADING_STEPS[task][0],
      progress: preparingProgress / 100,
      finished: false,
    };
  }
  if (!isAnalyzing && !analysisDone) {
    return null;
  }
  return {
    task: stage === "loading" || stage === "cached" ? "track" : "localAnalysis",
    key: fileKey,
    activeId: STAGE_STEPS[stage],
    progress: stageProgress,
    finished: !isAnalyzing,
  };
}

export function StatusPanel({ shown, onFinished }: { shown: LiveLoading | null; onFinished: () => void }) {
  const { t } = useTranslation();
  if (!shown) {
    return null;
  }
  return (
    <div className="panel" id="play-status">
      <LoadingProgress
        key={`${shown.task}:${shown.key}`}
        task={shown.task}
        title={t(TITLE_KEYS[shown.task])}
        steps={LOADING_STEPS[shown.task].map((id) => ({ id, label: t(`loading.${id}`) }))}
        activeId={shown.activeId}
        progress={shown.progress}
        finished={shown.finished}
        onFinished={onFinished}
      />
    </div>
  );
}

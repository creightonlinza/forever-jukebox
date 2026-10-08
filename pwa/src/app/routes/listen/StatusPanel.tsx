import { useTranslation } from "react-i18next";
import { ProgressSteps, type ProgressStep } from "@/ui/components/ProgressSteps";
import type { PreparingAudioMode } from "./labels";

export type PreparingPhase = "download" | "separate" | null;

const PREPARING_TITLE_KEYS = {
  swing: "listen.preparingSwingPercent",
  instrumental: "listen.preparingInstrumentalPercent",
  wubmachine: "listen.preparingWubMachinePercent",
} as const;

function preparingMessageKey(
  preparingMode: PreparingAudioMode,
  preparingPhase: PreparingPhase,
) {
  if (preparingMode === "instrumental") {
    return preparingPhase === "download"
      ? "listen.instrumentalDownloading"
      : "listen.instrumentalSeparating";
  }
  return preparingMode === "wubmachine"
    ? "listen.buildingWubMachine"
    : "listen.addingSwing";
}

export function StatusPanel({
  isAnalyzing,
  steps,
  progressMessage,
  progressPercent,
  preparingMode,
  preparingPhase,
  preparingProgress,
}: {
  isAnalyzing: boolean;
  steps: ProgressStep[];
  progressMessage: string | null;
  progressPercent: number | null;
  preparingMode: PreparingAudioMode;
  preparingPhase: PreparingPhase;
  preparingProgress: number;
}) {
  const { t } = useTranslation();
  const preparingTitle = t(PREPARING_TITLE_KEYS[preparingMode ?? "swing"], {
    percent: preparingProgress,
  });
  const preparingMessage = t(preparingMessageKey(preparingMode, preparingPhase));
  return (
    <>
      {isAnalyzing ? (
        <div className="panel" id="play-status">
          <ProgressSteps
            steps={steps}
            currentMessage={progressMessage}
            currentProgress={progressPercent}
          />
        </div>
      ) : null}
      {!isAnalyzing && preparingMode ? (
        <div className="panel" id="play-status">
          <div className="progress">
            <div className="progress__header">
              <p className="progress__title">{preparingTitle}</p>
              <p className="progress__message">{preparingMessage}</p>
            </div>
            <div className="progress-bar" aria-hidden="true">
              <div
                className="progress-bar-fill"
                style={{ width: `${preparingProgress}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

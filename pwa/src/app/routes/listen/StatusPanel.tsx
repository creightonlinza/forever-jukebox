import { useTranslation } from "react-i18next";
import { ProgressSteps, type ProgressStep } from "@/ui/components/ProgressSteps";
import type { PreparingAudioMode } from "./labels";

export type PreparingPhase = "download" | "separate" | null;

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
  const preparingTitle =
    preparingMode === "instrumental"
      ? t("listen.preparingInstrumentalPercent", { percent: preparingProgress })
      : preparingMode === "wubmachine"
        ? t("listen.preparingWubMachinePercent", { percent: preparingProgress })
        : t("listen.preparingSwingPercent", { percent: preparingProgress });
  const preparingMessage =
    preparingMode === "instrumental"
      ? t(
          preparingPhase === "download"
            ? "listen.instrumentalDownloading"
            : "listen.instrumentalSeparating",
        )
      : preparingMode === "wubmachine"
        ? t("listen.buildingWubMachine")
        : t("listen.addingSwing");
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

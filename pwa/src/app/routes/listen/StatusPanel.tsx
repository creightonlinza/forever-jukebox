import { useTranslation } from "react-i18next";
import { ProgressSteps, type ProgressStep } from "@/ui/components/ProgressSteps";

export function StatusPanel({
  isAnalyzing,
  steps,
  progressMessage,
  progressPercent,
  swingPreparing,
  swingProgress,
}: {
  isAnalyzing: boolean;
  steps: ProgressStep[];
  progressMessage: string | null;
  progressPercent: number | null;
  swingPreparing: boolean;
  swingProgress: number;
}) {
  const { t } = useTranslation();
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
    </>
  );
}

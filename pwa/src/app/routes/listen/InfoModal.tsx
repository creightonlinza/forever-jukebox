import { useTranslation } from "react-i18next";
import { formatDuration } from "@/shared/utils/format";
import { SymbolIcon } from "@/ui/components/SymbolIcon";

export function InfoModal({
  trackDurationSeconds,
  totalBeats,
  totalBranches,
  deletedBranches,
  onClose,
}: {
  trackDurationSeconds: number;
  totalBeats: number;
  totalBranches: number;
  deletedBranches: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal open">
      <button
        className="modal-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t("listen.closeTrackInfoDialog")}
      />
      <div className="modal-panel">
        <div className="modal-header">
          <h2>{t("info.title")}</h2>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
            <SymbolIcon className="modal-close-icon" name="close" />
          </button>
        </div>
        <div className="modal-body info-body">
          <div className="info-row">
            <span className="info-label">{t("info.trackLength")}</span>
            <span>{formatDuration(trackDurationSeconds)}</span>
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
  );
}

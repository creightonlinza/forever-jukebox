import { useAppStore } from "../../store";
import { Modal } from "../Modal";
import { useTranslation } from "react-i18next";

export function InfoModal() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.infoModalOpen);
  const trackInfo = useAppStore((s) => s.trackInfo);
  const close = () => useAppStore.setState({ infoModalOpen: false });

  return (
    <Modal id="info-modal" open={open} onClose={close}>
      <div className="modal-header">
        <h2>{t("info.title")}</h2>
        <button
          id="info-close"
          className="modal-close"
          aria-label={t("common.close")}
          onClick={close}
        >
          <span
            className="material-symbols-outlined modal-close-icon"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </div>
      <div className="modal-body info-body">
        <div className="info-row">
          <span className="info-label">{t("info.trackLength")}</span>
          <span id="info-duration">{trackInfo.durationText}</span>
        </div>
        <div className="info-row">
          <span className="info-label">{t("info.totalBeats")}</span>
          <span id="info-beats">{trackInfo.totalBeats}</span>
        </div>
        <div className="info-row">
          <span className="info-label">{t("info.totalBranches")}</span>
          <span id="info-branches">{trackInfo.branchCount}</span>
        </div>
        <div className="info-row">
          <span className="info-label">{t("info.deletedBranches")}</span>
          <span id="info-deleted-branches">{trackInfo.deletedCount}</span>
        </div>
        <h4>{t("info.keyboardCommands")}</h4>
        {([
          [t("info.space"), t("info.spaceAction")],
          [t("info.shift"), t("info.shiftAction")],
          [t("info.arrows"), t("info.arrowsAction")],
          ["[ / ]:", "Decrease/increase play velocity"],
          ["Down/Up:", "Set play velocity to 0/+1"],
          ["Control (hold):", "Freeze on the current beat"],
          [t("info.anchor"), t("info.anchorAction")],
          [t("info.delete"), t("info.deleteAction")],
          [t("info.extras"), t("info.extrasAction")],
          [t("info.home"), t("info.homeAction")],
        ] as Array<[string, string]>).map(([label, text]) => (
          <div className="info-row" key={label}>
            <span className="info-label">{label}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

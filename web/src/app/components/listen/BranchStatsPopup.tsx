import { useAppStore } from "../../store";
import { deleteSelectedBranch } from "../../playback-ui";
import { useTranslation } from "react-i18next";

// Branch-stats popup over the jukebox viz; renders from store state written
// by the edge-select callbacks in playback-ui.
export function BranchStatsPopup() {
  const { t } = useTranslation();
  const stats = useAppStore((s) => s.branchStats);
  return (
    <div
      id="branch-stats-popup"
      className={
        stats ? "branch-stats-popup" : "branch-stats-popup hidden"
      }
    >
      <div className="branch-stats-popup-header">
        <div className="branch-stats-popup-title" id="branch-stats-title">
          {stats ? stats.title() : t("playback.branchStats")}
        </div>
        <button
          type="button"
          id="branch-stats-delete"
          className="branch-stats-delete"
          aria-label={t("delete.selectedBranch")}
          title={t("delete.selectedBranch")}
          disabled={stats?.deleteDisabled ?? true}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteSelectedBranch();
          }}
        >
          <span
            className="material-symbols-outlined branch-stats-delete-icon"
            aria-hidden="true"
          >
            delete
          </span>
        </button>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.direction")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-direction">
          {stats ? stats.direction() : t("playback.backward")}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.startTime")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-start">
          {stats?.startText ?? "00:00:00"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.endTime")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-end">
          {stats?.endText ?? "00:00:00"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.timeDifference")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-delta">
          {stats?.deltaText ?? "+00:00:00"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.startBeat")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-start-beat">
          {stats?.startBeatText ?? "0"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.endBeat")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-end-beat">
          {stats?.endBeatText ?? "0"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.beatDifference")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-beat-delta">
          {stats?.beatDeltaText ?? "+0"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("playback.branchMatch")}</span>
        <span className="branch-stats-popup-value" id="branch-stats-similarity">
          {stats?.similarityText ?? "0%"}
        </span>
      </div>
    </div>
  );
}

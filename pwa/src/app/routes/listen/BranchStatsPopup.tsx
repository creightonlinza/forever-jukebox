import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import type { BranchStats } from "./branches";

export function BranchStatsPopup({
  stats,
  deleteDisabled,
  onDelete,
}: {
  stats: BranchStats;
  deleteDisabled: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="branch-stats-popup">
      <div className="branch-stats-popup-header">
        <div className="branch-stats-popup-title">
          Branch #{stats.id} stats
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
            onDelete();
          }}
          disabled={deleteDisabled}
        >
          <SymbolIcon className="branch-stats-delete-icon" name="delete" />
        </button>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.direction")}</span>
        <span className="branch-stats-popup-value">{stats.direction}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.startTime")}</span>
        <span className="branch-stats-popup-value">{stats.start}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.endTime")}</span>
        <span className="branch-stats-popup-value">{stats.end}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.timeDifference")}</span>
        <span className="branch-stats-popup-value">{stats.delta}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.startBeat")}</span>
        <span className="branch-stats-popup-value">{stats.startBeat}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.endBeat")}</span>
        <span className="branch-stats-popup-value">{stats.endBeat}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.beatDifference")}</span>
        <span className="branch-stats-popup-value">{stats.beatDelta}</span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">{t("listen.branchMatch")}</span>
        <span className="branch-stats-popup-value">{stats.similarity}</span>
      </div>
    </div>
  );
}

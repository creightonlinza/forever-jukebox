import { useAppStore } from "../../store";
import { deleteSelectedBranch } from "../../playback-ui";

// Branch-stats popup over the jukebox viz; renders from store state written
// by the edge-select callbacks in playback-ui.
export function BranchStatsPopup() {
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
          {stats?.title ?? "Branch stats"}
        </div>
        <button
          id="branch-stats-delete"
          className="branch-stats-delete"
          aria-label="Delete selected branch"
          title="Delete selected branch"
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
        <span className="branch-stats-popup-label">Direction:</span>
        <span className="branch-stats-popup-value" id="branch-stats-direction">
          {stats?.direction ?? "Backward"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">Start:</span>
        <span className="branch-stats-popup-value" id="branch-stats-start">
          {stats?.startText ?? "00:00:00"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">End:</span>
        <span className="branch-stats-popup-value" id="branch-stats-end">
          {stats?.endText ?? "00:00:00"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">Difference:</span>
        <span className="branch-stats-popup-value" id="branch-stats-delta">
          {stats?.deltaText ?? "+00:00:00"}
        </span>
      </div>
      <div className="branch-stats-popup-row">
        <span className="branch-stats-popup-label">Branch Match:</span>
        <span className="branch-stats-popup-value" id="branch-stats-similarity">
          {stats?.similarityText ?? "0%"}
        </span>
      </div>
    </div>
  );
}

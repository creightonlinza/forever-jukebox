import { getResumeIndex, hasInactiveSavedPlaylist } from "../../playlist";
import { loadPlaylistIndex } from "../../playlist-actions";
import { useAppStore } from "../../store";
import { retryTrack } from "../../track-select";
import { useTranslation } from "react-i18next";

// The Listen-panel status row: spinner, loading progress, analysis status
// text and the saved-playlist shortcut. Hidden once a track is fully
// loaded.
export function StatusPanel() {
  const { t } = useTranslation();
  const statusText = useAppStore((s) => s.analysisStatusText);
  const spinning = useAppStore((s) => s.analysisSpinning);
  const progressText = useAppStore((s) => s.analysisProgressText);
  const retryJobId = useAppStore((s) => s.analysisRetryJobId);
  const playlist = useAppStore((s) => s.playlist);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioLoadInFlight = useAppStore((s) => s.audioLoadInFlight);
  const lastTrackId = useAppStore((s) => s.lastTrackId);
  const lastJobId = useAppStore((s) => s.lastJobId);

  const swingPreparing = useAppStore((s) => s.swingPreparing);

  const panelHidden = audioLoaded && analysisLoaded && !swingPreparing;
  const noTrackLoaded =
    !audioLoaded &&
    !analysisLoaded &&
    !audioLoadInFlight &&
    !lastTrackId &&
    !lastJobId;
  const showSavedPlaylist = hasInactiveSavedPlaylist(playlist) && noTrackLoaded;
  const resumeIndex = getResumeIndex(playlist);
  const resumeTrack = resumeIndex === null ? null : playlist.tracks[resumeIndex];
  const showContinue = resumeTrack !== null && noTrackLoaded;

  return (
    <div className={panelHidden ? "panel hidden" : "panel"} id="play-status">
      <div className="status-row">
      <div
        className={spinning ? "spinner" : "spinner hidden"}
        id="analysis-spinner"
        aria-hidden="true"
      ></div>
      <div className="status-progress" id="analysis-progress">
        {progressText}
      </div>
      <div className="status-text" id="analysis-status">
        {statusText()}
        {retryJobId && !spinning ? (
          <>
            {" "}
            <button
              type="button"
              className="status-retry-button"
              onClick={() => retryTrack(retryJobId)}
            >
              {t("common.retry")}
            </button>
          </>
        ) : null}
      </div>
      <button
        id="saved-playlist"
        className={
          showSavedPlaylist
            ? "saved-playlist-button"
            : "saved-playlist-button hidden"
        }
        type="button"
        onClick={() => useAppStore.setState({ playlistModalOpen: true })}
      >
        {t("playlist.saved")}
      </button>
      <button
        id="continue-listening"
        className={
          showContinue
            ? "saved-playlist-button"
            : "saved-playlist-button hidden"
        }
        type="button"
        onClick={() => {
          if (resumeIndex !== null) {
            void loadPlaylistIndex(resumeIndex);
          }
        }}
      >
        {t("playlist.continueListening", { title: resumeTrack?.title ?? "" })}
      </button>
      </div>
    </div>
  );
}

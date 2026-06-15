import { hasInactiveSavedPlaylist } from "../../playlist";
import { useAppStore } from "../../store";

// The Listen-panel status row: spinner, loading progress, analysis status
// text and the saved-playlist shortcut. Hidden once a track is fully
// loaded.
export function StatusPanel() {
  const statusText = useAppStore((s) => s.analysisStatusText);
  const spinning = useAppStore((s) => s.analysisSpinning);
  const progressText = useAppStore((s) => s.analysisProgressText);
  const playlist = useAppStore((s) => s.playlist);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioLoadInFlight = useAppStore((s) => s.audioLoadInFlight);
  const lastTrackId = useAppStore((s) => s.lastTrackId);
  const lastJobId = useAppStore((s) => s.lastJobId);

  const swingPreparing = useAppStore((s) => s.swingPreparing);

  const panelHidden = audioLoaded && analysisLoaded && !swingPreparing;
  const showSavedPlaylist =
    hasInactiveSavedPlaylist(playlist) &&
    !audioLoaded &&
    !analysisLoaded &&
    !audioLoadInFlight &&
    !lastTrackId &&
    !lastJobId;

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
        {statusText}
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
        Saved Playlist
      </button>
      </div>
    </div>
  );
}

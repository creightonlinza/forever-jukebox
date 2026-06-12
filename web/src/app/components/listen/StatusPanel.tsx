import { useEffect } from "react";
import { hasInactiveSavedPlaylist } from "../../playlist";
import { useAppStore } from "../../store";

// The Listen-panel status row: spinner, loading progress, analysis status
// text and the saved-playlist shortcut. Renders via portal into the legacy
// #play-status panel (which React exclusively owns, including its hidden
// class — formerly toggled by updateVizVisibility).
export function StatusPanel({ container }: { container: Element | null }) {
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
  useEffect(() => {
    container?.classList.toggle("hidden", panelHidden);
  }, [container, panelHidden]);

  const showSavedPlaylist =
    hasInactiveSavedPlaylist(playlist) &&
    !audioLoaded &&
    !analysisLoaded &&
    !audioLoadInFlight &&
    !lastTrackId &&
    !lastJobId;

  return (
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
  );
}

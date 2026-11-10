import { useEffect } from "react";
import {
  LOADING_STEPS,
  LoadingProgress,
  usePresentedLoading,
} from "@forever-jukebox/shared/ui/LoadingProgress";
import { getResumeIndex, hasInactiveSavedPlaylist } from "../../playlist";
import { loadPlaylistIndex } from "../../playlist-actions";
import { useAppStore } from "../../store";
import { retryTrack } from "../../track-select";
import { useTranslation } from "react-i18next";

const LOADING_TITLE_KEYS = {
  serverAnalysis: "loading.analyzing",
  localAnalysis: "loading.analyzing",
  track: "loading.loadingTrack",
  swing: "playback.preparingSwing",
  instrumental: "playback.preparingInstrumental",
  instrumentalWithModel: "playback.preparingInstrumental",
  wubmachine: "playback.preparingWubMachine",
} as const;

// The Listen panel: loading steps while a track or audio mode loads, otherwise
// the status text and the saved-playlist shortcuts. Hidden once a track is fully loaded.
export function StatusPanel() {
  const { t } = useTranslation();
  const statusText = useAppStore((s) => s.analysisStatusText);
  const loadingStep = useAppStore((s) => s.loadingStep);
  const retryJobId = useAppStore((s) => s.analysisRetryJobId);
  const playlist = useAppStore((s) => s.playlist);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioLoadInFlight = useAppStore((s) => s.audioLoadInFlight);
  const lastTrackId = useAppStore((s) => s.lastTrackId);
  const lastJobId = useAppStore((s) => s.lastJobId);

  const audioModePreparing = useAppStore((s) => s.audioModePreparing);

  const panelHidden = audioLoaded && analysisLoaded && !audioModePreparing;
  const { shown, done } = usePresentedLoading(
    loadingStep && {
      ...loadingStep,
      message: loadingStep.message?.(),
      key: lastTrackId ?? lastJobId ?? "",
      finished: panelHidden,
    },
  );
  // Playback controls stay hidden until the loading steps have played out.
  const loadingShown = shown !== null;
  useEffect(() => {
    useAppStore.setState({ loadingShown });
  }, [loadingShown]);
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
    <div className={panelHidden && !shown ? "panel hidden" : "panel"} id="play-status">
      {shown ? (
        <LoadingProgress
          key={`${shown.task}:${shown.key}`}
        task={shown.task}
          title={t(LOADING_TITLE_KEYS[shown.task])}
          steps={LOADING_STEPS[shown.task].map((id) => ({ id, label: t(`loading.${id}`) }))}
          activeId={shown.activeId}
          progress={shown.progress}
          message={shown.message}
          finished={shown.finished}
          onFinished={done}
        />
      ) : (
      <div className="status-row">
      <div className="status-text" id="analysis-status">
        {statusText()}
        {retryJobId ? (
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
      )}
    </div>
  );
}

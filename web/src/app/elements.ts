import { requireElement } from "./dom";

export type Elements = ReturnType<typeof getElements>;

export function getElements() {
  const listenTimeEl = requireElement(
    document.querySelector<HTMLSpanElement>("#listen-time"),
    "#listen-time"
  );
  const beatsPlayedEl = requireElement(
    document.querySelector<HTMLSpanElement>("#beats-played"),
    "#beats-played"
  );
  const beatsLabel = requireElement(
    document.querySelector<HTMLSpanElement>("#viz-beats-label"),
    "#viz-beats-label"
  );
  const beatsDivider = requireElement(
    document.querySelector<HTMLSpanElement>("#viz-beats-divider"),
    "#viz-beats-divider"
  );
  const vizNowPlayingEl = requireElement(
    document.querySelector<HTMLDivElement>("#viz-now-playing"),
    "#viz-now-playing"
  );
  const vizPanel = requireElement(
    document.querySelector<HTMLElement>("#viz-panel"),
    "#viz-panel"
  );
  const vizLayer = requireElement(
    document.querySelector<HTMLDivElement>("#viz-layer"),
    "#viz-layer"
  );
  const canonizerLayer = requireElement(
    document.querySelector<HTMLDivElement>("#canonizer-layer"),
    "#canonizer-layer"
  );
  const canonizerFinish = requireElement(
    document.querySelector<HTMLInputElement>("#canonizer-finish"),
    "#canonizer-finish"
  );
  const jukeboxViz = requireElement(
    document.querySelector<HTMLDivElement>("#jukebox-viz"),
    "#jukebox-viz"
  );
  const vizSelect = requireElement(
    document.querySelector<HTMLSelectElement>("#viz-select"),
    "#viz-select"
  );
  const playModeSelect = requireElement(
    document.querySelector<HTMLSelectElement>("#play-mode-select"),
    "#play-mode-select"
  );
  const playStatusPanel = requireElement(
    document.querySelector<HTMLDivElement>("#play-status"),
    "#play-status"
  );
  const analysisStatus = requireElement(
    document.querySelector<HTMLDivElement>("#analysis-status"),
    "#analysis-status"
  );
  const analysisSpinner = requireElement(
    document.querySelector<HTMLDivElement>("#analysis-spinner"),
    "#analysis-spinner"
  );
  const analysisProgress = requireElement(
    document.querySelector<HTMLDivElement>("#analysis-progress"),
    "#analysis-progress"
  );
  const playButton =
    document.querySelector<HTMLButtonElement>("#play") ??
    requireElement(
      document.querySelector<HTMLButtonElement>("#viz-play"),
      "#viz-play"
    );
  const bringHomeFullscreenLabel = requireElement(
    document.querySelector<HTMLSpanElement>("#bring-home-fullscreen-label"),
    "#bring-home-fullscreen-label"
  );
  const vizPlayButton = requireElement(
    document.querySelector<HTMLButtonElement>("#viz-play"),
    "#viz-play"
  );
  const playlistPreviousButton = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-previous"),
    "#playlist-previous"
  );
  const playlistNextButton = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-next"),
    "#playlist-next"
  );
  const playlistButton = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-open"),
    "#playlist-open"
  );
  const savedPlaylistButton = requireElement(
    document.querySelector<HTMLButtonElement>("#saved-playlist"),
    "#saved-playlist"
  );
  const fullscreenButton = requireElement(
    document.querySelector<HTMLButtonElement>("#fullscreen"),
    "#fullscreen"
  );
  const volumeInput = requireElement(
    document.querySelector<HTMLInputElement>("#volume"),
    "#volume"
  );
  const volumeVal = requireElement(
    document.querySelector<HTMLSpanElement>("#volume-val"),
    "#volume-val"
  );
  const branchStatsPopup = requireElement(
    document.querySelector<HTMLDivElement>("#branch-stats-popup"),
    "#branch-stats-popup"
  );
  const branchStatsTitleEl = requireElement(
    document.querySelector<HTMLDivElement>("#branch-stats-title"),
    "#branch-stats-title"
  );
  const branchStatsDeleteButton = requireElement(
    document.querySelector<HTMLButtonElement>("#branch-stats-delete"),
    "#branch-stats-delete"
  );
  const branchStatsStartEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-start"),
    "#branch-stats-start"
  );
  const branchStatsEndEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-end"),
    "#branch-stats-end"
  );
  const branchStatsDeltaEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-delta"),
    "#branch-stats-delta"
  );
  const branchStatsDirectionEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-direction"),
    "#branch-stats-direction"
  );
  const branchStatsSimilarityEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-similarity"),
    "#branch-stats-similarity"
  );
  const vizStats = document.querySelector<HTMLDivElement>("#viz-stats");
  const volumeButton = requireElement(
    document.querySelector<HTMLButtonElement>("#volume-button"),
    "#volume-button"
  );
  const volumeControlPanel = requireElement(
    document.querySelector<HTMLDivElement>("#volume-control-panel"),
    "#volume-control-panel"
  );

  return {
    listenTimeEl,
    beatsPlayedEl,
    beatsLabel,
    beatsDivider,
    vizNowPlayingEl,
    vizPanel,
    vizLayer,
    canonizerLayer,
    canonizerFinish,
    jukeboxViz,
    vizSelect,
    playModeSelect,
    playStatusPanel,
    analysisStatus,
    analysisSpinner,
    analysisProgress,
    playButton,
    bringHomeFullscreenLabel,
    vizPlayButton,
    playlistPreviousButton,
    playlistNextButton,
    playlistButton,
    savedPlaylistButton,
    fullscreenButton,
    volumeInput,
    volumeVal,
    branchStatsPopup,
    branchStatsTitleEl,
    branchStatsDeleteButton,
    branchStatsStartEl,
    branchStatsEndEl,
    branchStatsDeltaEl,
    branchStatsDirectionEl,
    branchStatsSimilarityEl,
    vizStats,
    volumeButton,
    volumeControlPanel,
  };
}

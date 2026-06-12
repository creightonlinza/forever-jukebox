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
  const playMenu = requireElement(
    document.querySelector<HTMLDivElement>("#play-menu"),
    "#play-menu"
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
  const bringHomeLabel = requireElement(
    document.querySelector<HTMLSpanElement>("#bring-home-label"),
    "#bring-home-label"
  );
  const bringHomeFullscreenLabel = requireElement(
    document.querySelector<HTMLSpanElement>("#bring-home-fullscreen-label"),
    "#bring-home-fullscreen-label"
  );
  const vizPlayButton = requireElement(
    document.querySelector<HTMLButtonElement>("#viz-play"),
    "#viz-play"
  );
  const shortUrlButton = requireElement(
    document.querySelector<HTMLButtonElement>("#short-url"),
    "#short-url"
  );
  const tuningButton = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning"),
    "#tuning"
  );
  const infoButton = requireElement(
    document.querySelector<HTMLButtonElement>("#track-info"),
    "#track-info"
  );
  const favoriteButton = requireElement(
    document.querySelector<HTMLButtonElement>("#favorite-toggle"),
    "#favorite-toggle"
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
  const playlistModal = requireElement(
    document.querySelector<HTMLDivElement>("#playlist-modal"),
    "#playlist-modal"
  );
  const playlistClose = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-close"),
    "#playlist-close"
  );
  const playlistList = requireElement(
    document.querySelector<HTMLDivElement>("#playlist-list"),
    "#playlist-list"
  );
  const playlistClearButton = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-clear"),
    "#playlist-clear"
  );
  const deleteButton = requireElement(
    document.querySelector<HTMLButtonElement>("#delete-job"),
    "#delete-job"
  );
  const deleteConfirmModal = requireElement(
    document.querySelector<HTMLDivElement>("#delete-confirm-modal"),
    "#delete-confirm-modal"
  );
  const deleteConfirmCancel = requireElement(
    document.querySelector<HTMLButtonElement>("#delete-confirm-cancel"),
    "#delete-confirm-cancel"
  );
  const deleteConfirmDelete = requireElement(
    document.querySelector<HTMLButtonElement>("#delete-confirm-delete"),
    "#delete-confirm-delete"
  );
  const playTitle = requireElement(
    document.querySelector<HTMLDivElement>("#play-title"),
    "#play-title"
  );
  const fullscreenButton = requireElement(
    document.querySelector<HTMLButtonElement>("#fullscreen"),
    "#fullscreen"
  );
  const tuningModal = requireElement(
    document.querySelector<HTMLDivElement>("#tuning-modal"),
    "#tuning-modal"
  );
  const infoModal = requireElement(
    document.querySelector<HTMLDivElement>("#info-modal"),
    "#info-modal"
  );
  const tuningClose = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning-close"),
    "#tuning-close"
  );
  const tuningTitle = requireElement(
    document.querySelector<HTMLHeadingElement>("#tuning-title"),
    "#tuning-title"
  );
  const tuningTitleText = requireElement(
    document.querySelector<HTMLSpanElement>("#tuning-title-text"),
    "#tuning-title-text"
  );
  const tuningTabToggle = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning-tab-toggle"),
    "#tuning-tab-toggle"
  );
  const tuningTabToggleIcon = requireElement(
    document.querySelector<HTMLSpanElement>("#tuning-tab-toggle-icon"),
    "#tuning-tab-toggle-icon"
  );
  const tuningTabToggleLabel = requireElement(
    document.querySelector<HTMLSpanElement>("#tuning-tab-toggle-label"),
    "#tuning-tab-toggle-label"
  );
  const sleepTimerOpen = requireElement(
    document.querySelector<HTMLButtonElement>("#sleep-timer-open"),
    "#sleep-timer-open"
  );
  const sleepTimerModal = requireElement(
    document.querySelector<HTMLDivElement>("#sleep-timer-modal"),
    "#sleep-timer-modal"
  );
  const sleepTimerClose = requireElement(
    document.querySelector<HTMLButtonElement>("#sleep-timer-close"),
    "#sleep-timer-close"
  );
  const sleepTimerCancel = requireElement(
    document.querySelector<HTMLButtonElement>("#sleep-timer-cancel"),
    "#sleep-timer-cancel"
  );
  const sleepTimerSet = requireElement(
    document.querySelector<HTMLButtonElement>("#sleep-timer-set"),
    "#sleep-timer-set"
  );
  const sleepTimerSelect = requireElement(
    document.querySelector<HTMLSelectElement>("#sleep-timer-select"),
    "#sleep-timer-select"
  );
  const sleepTimerCurrent = requireElement(
    document.querySelector<HTMLDivElement>("#sleep-timer-current"),
    "#sleep-timer-current"
  );
  const tuningPanelTuning = requireElement(
    document.querySelector<HTMLDivElement>("#tuning-panel-tuning"),
    "#tuning-panel-tuning"
  );
  const tuningPanelExtras = requireElement(
    document.querySelector<HTMLDivElement>("#tuning-panel-extras"),
    "#tuning-panel-extras"
  );
  const infoClose = requireElement(
    document.querySelector<HTMLButtonElement>("#info-close"),
    "#info-close"
  );
  const tuningApply = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning-apply"),
    "#tuning-apply"
  );
  const tuningReset = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning-reset"),
    "#tuning-reset"
  );
  const infoDurationEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-duration"),
    "#info-duration"
  );
  const infoBeatsEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-beats"),
    "#info-beats"
  );
  const infoBranchesEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-branches"),
    "#info-branches"
  );
  const infoDeletedBranchesEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-deleted-branches"),
    "#info-deleted-branches"
  );
  const thresholdInput = requireElement(
    document.querySelector<HTMLInputElement>("#threshold"),
    "#threshold"
  );
  const thresholdVal = requireElement(
    document.querySelector<HTMLSpanElement>("#threshold-val"),
    "#threshold-val"
  );
  const computedThresholdEl = requireElement(
    document.querySelector<HTMLSpanElement>("#computed-threshold"),
    "#computed-threshold"
  );
  const minProbInput = requireElement(
    document.querySelector<HTMLInputElement>("#min-prob"),
    "#min-prob"
  );
  const minProbVal = requireElement(
    document.querySelector<HTMLSpanElement>("#min-prob-val"),
    "#min-prob-val"
  );
  const maxProbInput = requireElement(
    document.querySelector<HTMLInputElement>("#max-prob"),
    "#max-prob"
  );
  const maxProbVal = requireElement(
    document.querySelector<HTMLSpanElement>("#max-prob-val"),
    "#max-prob-val"
  );
  const rampInput = requireElement(
    document.querySelector<HTMLInputElement>("#ramp"),
    "#ramp"
  );
  const rampVal = requireElement(
    document.querySelector<HTMLSpanElement>("#ramp-val"),
    "#ramp-val"
  );
  const volumeInput = requireElement(
    document.querySelector<HTMLInputElement>("#volume"),
    "#volume"
  );
  const volumeVal = requireElement(
    document.querySelector<HTMLSpanElement>("#volume-val"),
    "#volume-val"
  );
  const justBackwardsInput = requireElement(
    document.querySelector<HTMLInputElement>("#just-backwards"),
    "#just-backwards"
  );
  const justLongInput = requireElement(
    document.querySelector<HTMLInputElement>("#just-long"),
    "#just-long"
  );
  const removeSeqInput = requireElement(
    document.querySelector<HTMLInputElement>("#remove-seq"),
    "#remove-seq"
  );
  const highlightAnchorBranchInput = requireElement(
    document.querySelector<HTMLInputElement>("#highlight-anchor-branch"),
    "#highlight-anchor-branch"
  );
  const extrasEnabledInput = requireElement(
    document.querySelector<HTMLInputElement>("#extras-enabled"),
    "#extras-enabled"
  );
  const bringHomeEnabledInput = requireElement(
    document.querySelector<HTMLInputElement>("#bring-home-enabled"),
    "#bring-home-enabled"
  );
  const jukeboxAudioModeGroup = requireElement(
    document.querySelector<HTMLDivElement>("#jukebox-audio-mode-group"),
    "#jukebox-audio-mode-group"
  );
  const audioModeOffInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-off"),
    "#audio-mode-off"
  );
  const audioModeNightcoreInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-nightcore"),
    "#audio-mode-nightcore"
  );
  const audioModeDaycoreInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-daycore"),
    "#audio-mode-daycore"
  );
  const audioModeVaporwaveInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-vaporwave"),
    "#audio-mode-vaporwave"
  );
  const audioModeEightDInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-eight-d"),
    "#audio-mode-eight-d"
  );
  const audioModeEightBitInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-eight-bit"),
    "#audio-mode-eight-bit"
  );
  const audioModeLofiInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-lofi"),
    "#audio-mode-lofi"
  );
  const audioModeUnderwaterInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-underwater"),
    "#audio-mode-underwater"
  );
  const audioModeCathedralInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-cathedral"),
    "#audio-mode-cathedral"
  );
  const audioModeCowbellInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-cowbell"),
    "#audio-mode-cowbell"
  );
  const audioModeSwingInput = requireElement(
    document.querySelector<HTMLInputElement>("#audio-mode-swing"),
    "#audio-mode-swing"
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
    playMenu,
    analysisStatus,
    analysisSpinner,
    analysisProgress,
    playButton,
    bringHomeLabel,
    bringHomeFullscreenLabel,
    vizPlayButton,
    shortUrlButton,
    tuningButton,
    infoButton,
    favoriteButton,
    playlistPreviousButton,
    playlistNextButton,
    playlistButton,
    savedPlaylistButton,
    playlistModal,
    playlistClose,
    playlistList,
    playlistClearButton,
    deleteButton,
    deleteConfirmModal,
    deleteConfirmCancel,
    deleteConfirmDelete,
    playTitle,
    fullscreenButton,
    tuningModal,
    infoModal,
    tuningClose,
    tuningTitle,
    tuningTitleText,
    tuningTabToggle,
    tuningTabToggleIcon,
    tuningTabToggleLabel,
    sleepTimerOpen,
    sleepTimerModal,
    sleepTimerClose,
    sleepTimerCancel,
    sleepTimerSet,
    sleepTimerSelect,
    sleepTimerCurrent,
    tuningPanelTuning,
    tuningPanelExtras,
    infoClose,
    tuningApply,
    tuningReset,
    infoDurationEl,
    infoBeatsEl,
    infoBranchesEl,
    infoDeletedBranchesEl,
    thresholdInput,
    thresholdVal,
    computedThresholdEl,
    minProbInput,
    minProbVal,
    maxProbInput,
    maxProbVal,
    rampInput,
    rampVal,
    volumeInput,
    volumeVal,
    justBackwardsInput,
    justLongInput,
    removeSeqInput,
    highlightAnchorBranchInput,
    extrasEnabledInput,
    bringHomeEnabledInput,
    jukeboxAudioModeGroup,
    audioModeOffInput,
    audioModeNightcoreInput,
    audioModeDaycoreInput,
    audioModeVaporwaveInput,
    audioModeEightDInput,
    audioModeEightBitInput,
    audioModeLofiInput,
    audioModeUnderwaterInput,
    audioModeCathedralInput,
    audioModeCowbellInput,
    audioModeSwingInput,
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

import { requireElement, requireNonEmpty } from "./dom";

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
  const tabButtons = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab-button]")),
    "[data-tab-button]"
  );
  const tabPanels = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]")),
    "[data-tab-panel]"
  );
  const playTabButton = requireElement(
    document.querySelector<HTMLButtonElement>('[data-tab-button="play"]'),
    '[data-tab-button="play"]'
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
  const playButton = requireElement(
    document.querySelector<HTMLButtonElement>("#play"),
    "#play"
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
  const deleteButton = requireElement(
    document.querySelector<HTMLButtonElement>("#delete-job"),
    "#delete-job"
  );
  const playTitle = requireElement(
    document.querySelector<HTMLDivElement>("#play-title"),
    "#play-title"
  );
  const themeLinks = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme]")),
    "[data-theme]"
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
  const favoritesSyncEnterModal = requireElement(
    document.querySelector<HTMLDivElement>("#favorites-sync-enter-modal"),
    "#favorites-sync-enter-modal"
  );
  const favoritesSyncEnterClose = requireElement(
    document.querySelector<HTMLButtonElement>("#favorites-sync-enter-close"),
    "#favorites-sync-enter-close"
  );
  const favoritesSyncEnterInput = requireElement(
    document.querySelector<HTMLInputElement>("#favorites-sync-enter-input"),
    "#favorites-sync-enter-input"
  );
  const favoritesSyncEnterButton = requireElement(
    document.querySelector<HTMLButtonElement>("#favorites-sync-enter-button"),
    "#favorites-sync-enter-button"
  );
  const favoritesSyncEnterStatus = requireElement(
    document.querySelector<HTMLParagraphElement>("#favorites-sync-enter-status"),
    "#favorites-sync-enter-status"
  );
  const favoritesSyncCreateModal = requireElement(
    document.querySelector<HTMLDivElement>("#favorites-sync-create-modal"),
    "#favorites-sync-create-modal"
  );
  const favoritesSyncCreateClose = requireElement(
    document.querySelector<HTMLButtonElement>("#favorites-sync-create-close"),
    "#favorites-sync-create-close"
  );
  const favoritesSyncCreateButton = requireElement(
    document.querySelector<HTMLButtonElement>("#favorites-sync-create-button"),
    "#favorites-sync-create-button"
  );
  const favoritesSyncCreateHint = requireElement(
    document.querySelector<HTMLParagraphElement>("#favorites-sync-create-hint"),
    "#favorites-sync-create-hint"
  );
  const favoritesSyncCreateOutput = requireElement(
    document.querySelector<HTMLDivElement>("#favorites-sync-create-output"),
    "#favorites-sync-create-output"
  );
  const favoritesSyncCreateStatus = requireElement(
    document.querySelector<HTMLParagraphElement>(
      "#favorites-sync-create-status"
    ),
    "#favorites-sync-create-status"
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
  const searchInput = requireElement(
    document.querySelector<HTMLInputElement>("#search-input"),
    "#search-input"
  );
  const searchButton = requireElement(
    document.querySelector<HTMLButtonElement>("#search-button"),
    "#search-button"
  );
  const searchSubtabs = requireElement(
    document.querySelector<HTMLDivElement>("#search-subtabs"),
    "#search-subtabs"
  );
  const searchSubtabButtons = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-search-subtab]")),
    "[data-search-subtab]"
  );
  const searchPanelTitle = requireElement(
    document.querySelector<HTMLDivElement>("#search-panel-title"),
    "#search-panel-title"
  );
  const searchPanel = requireElement(
    document.querySelector<HTMLDivElement>("#search-panel"),
    "#search-panel"
  );
  const uploadPanel = requireElement(
    document.querySelector<HTMLDivElement>("#upload-panel"),
    "#upload-panel"
  );
  const uploadFileSection = requireElement(
    document.querySelector<HTMLDivElement>("#upload-file-section"),
    "#upload-file-section"
  );
  const uploadFileHint = requireElement(
    document.querySelector<HTMLDivElement>("#upload-file-hint"),
    "#upload-file-hint"
  );
  const uploadFileInput = requireElement(
    document.querySelector<HTMLInputElement>("#upload-file-input"),
    "#upload-file-input"
  );
  const uploadFileButton = requireElement(
    document.querySelector<HTMLButtonElement>("#upload-file-button"),
    "#upload-file-button"
  );
  const uploadYoutubeSection = requireElement(
    document.querySelector<HTMLDivElement>("#upload-youtube-section"),
    "#upload-youtube-section"
  );
  const uploadYoutubeInput = requireElement(
    document.querySelector<HTMLInputElement>("#upload-youtube-input"),
    "#upload-youtube-input"
  );
  const uploadYoutubeButton = requireElement(
    document.querySelector<HTMLButtonElement>("#upload-youtube-button"),
    "#upload-youtube-button"
  );
  const searchResults = requireElement(
    document.querySelector<HTMLDivElement>("#search-results"),
    "#search-results"
  );
  const searchHint = requireElement(
    document.querySelector<HTMLDivElement>("#search-hint"),
    "#search-hint"
  );
  const topSongsList = requireElement(
    document.querySelector<HTMLOListElement>("#top-songs"),
    "#top-songs"
  );
  const trendingSongsList = requireElement(
    document.querySelector<HTMLOListElement>("#trending-songs"),
    "#trending-songs"
  );
  const recentSongsList = requireElement(
    document.querySelector<HTMLOListElement>("#recent-songs"),
    "#recent-songs"
  );
  const favoritesList = requireElement(
    document.querySelector<HTMLOListElement>("#favorites-list"),
    "#favorites-list"
  );
  const topSongsTabs = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-top-subtab]")),
    "[data-top-subtab]"
  );
  const topListTitle = requireElement(
    document.querySelector<HTMLSpanElement>("#top-list-title"),
    "#top-list-title"
  );
  const favoritesSyncButton = requireElement(
    document.querySelector<HTMLButtonElement>("#favorites-sync-button"),
    "#favorites-sync-button"
  );
  const favoritesSyncIcon = requireElement(
    favoritesSyncButton.querySelector<HTMLSpanElement>(
      ".favorites-sync-icon"
    ),
    ".favorites-sync-icon"
  );
  const favoritesSyncMenu = requireElement(
    document.querySelector<HTMLDivElement>("#favorites-sync-menu"),
    "#favorites-sync-menu"
  );
  const favoritesSyncItems = requireNonEmpty(
    Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-favorites-sync]")
    ),
    "[data-favorites-sync]"
  );
  const toast = requireElement(
    document.querySelector<HTMLDivElement>("#toast"),
    "#toast"
  );
  const extrasPopup = requireElement(
    document.querySelector<HTMLDivElement>("#extras-popup"),
    "#extras-popup"
  );
  const extrasTitleEl = requireElement(
    document.querySelector<HTMLDivElement>("#extras-title"),
    "#extras-title"
  );
  const extrasStartEl = requireElement(
    document.querySelector<HTMLSpanElement>("#extras-start"),
    "#extras-start"
  );
  const extrasEndEl = requireElement(
    document.querySelector<HTMLSpanElement>("#extras-end"),
    "#extras-end"
  );
  const extrasDeltaEl = requireElement(
    document.querySelector<HTMLSpanElement>("#extras-delta"),
    "#extras-delta"
  );
  const extrasDirectionEl = requireElement(
    document.querySelector<HTMLSpanElement>("#extras-direction"),
    "#extras-direction"
  );
  const extrasSimilarityEl = requireElement(
    document.querySelector<HTMLSpanElement>("#extras-similarity"),
    "#extras-similarity"
  );
  const cachedAudioClearButton = requireElement(
    document.querySelector<HTMLButtonElement>("#cached-audio-clear"),
    "#cached-audio-clear"
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
    tabButtons,
    tabPanels,
    playTabButton,
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
    deleteButton,
    playTitle,
    themeLinks,
    fullscreenButton,
    tuningModal,
    infoModal,
    tuningClose,
    infoClose,
    tuningApply,
    tuningReset,
    favoritesSyncEnterModal,
    favoritesSyncEnterClose,
    favoritesSyncEnterInput,
    favoritesSyncEnterButton,
    favoritesSyncEnterStatus,
    favoritesSyncCreateModal,
    favoritesSyncCreateClose,
    favoritesSyncCreateButton,
    favoritesSyncCreateHint,
    favoritesSyncCreateOutput,
    favoritesSyncCreateStatus,
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
    searchInput,
    searchButton,
    searchSubtabs,
    searchSubtabButtons,
    searchPanelTitle,
    searchPanel,
    uploadPanel,
    uploadFileSection,
    uploadFileHint,
    uploadFileInput,
    uploadFileButton,
    uploadYoutubeSection,
    uploadYoutubeInput,
    uploadYoutubeButton,
    searchResults,
    searchHint,
    topSongsList,
    trendingSongsList,
    recentSongsList,
    favoritesList,
    topSongsTabs,
    topListTitle,
    favoritesSyncButton,
    favoritesSyncIcon,
    favoritesSyncMenu,
    favoritesSyncItems,
    toast,
    extrasPopup,
    extrasTitleEl,
    extrasStartEl,
    extrasEndEl,
    extrasDeltaEl,
    extrasDirectionEl,
    extrasSimilarityEl,
    cachedAudioClearButton,
    vizStats,
    volumeButton,
    volumeControlPanel,
  };
}

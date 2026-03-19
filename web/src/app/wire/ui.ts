import type { Elements } from "../elements";
import type { JukeboxController } from "../../jukebox/JukeboxController";
import type { FavoritesHandlers } from "./favorites";
import type { TabsHandlers } from "./tabs";
import type { SearchHandlers } from "./search";
import type { TuningHandlers } from "./tuning";
import type { PlaybackUiHandlers } from "./playback";
import type { FullscreenHandlers } from "./fullscreen";
import type { DeleteJobHandlers } from "./delete-job";
import type { ThemeHandlers } from "./theme";
import type { CacheHandlers } from "./cache";

type UiBindingsDeps = {
  elements: Elements;
  jukebox: JukeboxController;
  favoritesHandlers: FavoritesHandlers;
  tabsHandlers: TabsHandlers;
  searchHandlers: SearchHandlers;
  tuningHandlers: TuningHandlers;
  playbackHandlers: PlaybackUiHandlers;
  fullscreenHandlers: FullscreenHandlers;
  deleteJobHandlers: DeleteJobHandlers;
  themeHandlers: ThemeHandlers;
  cacheHandlers: CacheHandlers;
};

export function bindUiHandlers(deps: UiBindingsDeps) {
  const {
    elements,
    jukebox,
    favoritesHandlers,
    tabsHandlers,
    searchHandlers,
    tuningHandlers,
    playbackHandlers,
    fullscreenHandlers,
    deleteJobHandlers,
    themeHandlers,
    cacheHandlers,
  } = deps;

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", tabsHandlers.handleTabClick);
  });
  elements.topSongsTabs.forEach((button) => {
    button.addEventListener("click", tabsHandlers.handleTopSongsTabClick);
  });
  elements.searchButton.addEventListener("click", searchHandlers.handleSearchClick);
  elements.searchInput.addEventListener(
    "keydown",
    searchHandlers.handleSearchKeydown,
  );
  elements.searchSubtabButtons.forEach((button) => {
    button.addEventListener("click", tabsHandlers.handleSearchSubtabClick);
  });
  elements.favoritesSyncButton.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncToggle,
  );
  elements.favoritesSyncItems.forEach((button) => {
    button.addEventListener("click", favoritesHandlers.handleFavoritesSyncItem);
  });
  elements.favoritesSyncEnterClose.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncEnterClose,
  );
  elements.favoritesSyncCreateClose.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncCreateClose,
  );
  elements.favoritesSyncEnterButton.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncEnterSubmit,
  );
  elements.favoritesSyncCreateButton.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncCreateSubmit,
  );
  elements.favoritesSyncEnterInput.addEventListener(
    "keydown",
    favoritesHandlers.handleFavoritesSyncEnterKeydown,
  );
  elements.uploadFileButton.addEventListener(
    "click",
    searchHandlers.handleUploadFileClick,
  );
  elements.uploadYoutubeButton.addEventListener(
    "click",
    searchHandlers.handleUploadYoutubeClick,
  );
  elements.thresholdInput.addEventListener(
    "input",
    tuningHandlers.handleThresholdInput,
  );
  elements.minProbInput.addEventListener(
    "input",
    tuningHandlers.handleMinProbInput,
  );
  elements.maxProbInput.addEventListener(
    "input",
    tuningHandlers.handleMaxProbInput,
  );
  elements.rampInput.addEventListener("input", tuningHandlers.handleRampInput);
  elements.volumeInput.addEventListener(
    "input",
    tuningHandlers.handleVolumeInput,
  );
  elements.tuningButton.addEventListener("click", tuningHandlers.handleOpenTuning);
  elements.infoButton.addEventListener("click", tuningHandlers.handleOpenInfo);
  elements.favoriteButton.addEventListener(
    "click",
    favoritesHandlers.handleFavoriteToggle,
  );
  elements.deleteButton.addEventListener(
    "click",
    deleteJobHandlers.handleDeleteJobClick,
  );
  elements.fullscreenButton.addEventListener(
    "click",
    fullscreenHandlers.handleFullscreenToggle,
  );
  document.addEventListener(
    "fullscreenchange",
    fullscreenHandlers.handleFullscreenChange,
  );
  document.addEventListener(
    "visibilitychange",
    fullscreenHandlers.handleVisibilityChange,
  );
  elements.tuningClose.addEventListener("click", tuningHandlers.handleCloseTuning);
  elements.infoClose.addEventListener("click", tuningHandlers.handleCloseInfo);
  elements.tuningModal.addEventListener(
    "click",
    tuningHandlers.handleTuningModalClick,
  );
  elements.infoModal.addEventListener("click", tuningHandlers.handleInfoModalClick);
  elements.favoritesSyncEnterModal.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncEnterModalClick,
  );
  elements.favoritesSyncCreateModal.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncCreateModalClick,
  );
  elements.tuningApply.addEventListener("click", tuningHandlers.handleTuningApply);
  elements.tuningReset.addEventListener("click", tuningHandlers.handleTuningReset);
  elements.playButton.addEventListener("click", playbackHandlers.handlePlayClick);
  elements.vizPlayButton.addEventListener(
    "click",
    playbackHandlers.handlePlayClick,
  );
  elements.shortUrlButton.addEventListener(
    "click",
    playbackHandlers.handleShortUrlClick,
  );
  elements.cachedAudioClearButton.addEventListener(
    "click",
    cacheHandlers.handleClearCacheClick,
  );
  elements.volumeButton.addEventListener("click", tuningHandlers.handleVolumeButtonClick);

  tuningHandlers.syncInfoButton();
  tuningHandlers.syncTuneButton();
  tuningHandlers.syncCopyButton();
  fullscreenHandlers.updateFullscreenButton(Boolean(document.fullscreenElement));

  elements.vizSelect.addEventListener(
    "change",
    playbackHandlers.handleVizSelectChange,
  );
  elements.playModeSelect.addEventListener(
    "change",
    playbackHandlers.handleModeSelectChange,
  );
  elements.canonizerFinish.addEventListener(
    "change",
    playbackHandlers.handleCanonizerFinish,
  );
  themeHandlers.bindThemeLinks();
  document.addEventListener(
    "click",
    favoritesHandlers.handleFavoritesSyncDocumentClick,
  );
  document.addEventListener("click", tuningHandlers.handleVolumeDocumentClick);
  window.addEventListener("keydown", playbackHandlers.handleKeydown);
  window.addEventListener("keyup", playbackHandlers.handleKeyup);

  jukebox.setOnSelect(playbackHandlers.handleBeatSelect);
  jukebox.setOnEdgeSelect(playbackHandlers.handleEdgeSelect);
}

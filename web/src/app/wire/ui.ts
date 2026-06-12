import type { Elements } from "../elements";
import type { JukeboxController } from "../../jukebox/JukeboxController";
import type { FavoritesHandlers } from "./favorites";
import type { TabsHandlers } from "./tabs";
import type { SearchHandlers } from "./search";
import type { TuningHandlers } from "./tuning";
import type { PlaybackUiHandlers } from "./playback";
import type { FullscreenHandlers } from "./fullscreen";
import type { DeleteJobHandlers } from "./delete-job";
import type { PlaylistHandlers } from "./playlist";

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
  playlistHandlers: PlaylistHandlers;
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
    playlistHandlers,
  } = deps;

  elements.searchButton.addEventListener("click", searchHandlers.handleSearchClick);
  elements.searchInput.addEventListener(
    "keydown",
    searchHandlers.handleSearchKeydown,
  );
  elements.searchSubtabButtons.forEach((button) => {
    button.addEventListener("click", tabsHandlers.handleSearchSubtabClick);
  });
  elements.uploadFileButton.addEventListener(
    "click",
    searchHandlers.handleUploadFileClick,
  );
  elements.uploadYoutubeForm.addEventListener(
    "submit",
    searchHandlers.handleUploadYoutubeSubmit,
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
  elements.sleepTimerOpen.addEventListener(
    "click",
    tuningHandlers.handleOpenSleepTimer,
  );
  elements.sleepTimerClose.addEventListener(
    "click",
    tuningHandlers.handleCloseSleepTimer,
  );
  elements.sleepTimerCancel.addEventListener(
    "click",
    tuningHandlers.handleCloseSleepTimer,
  );
  elements.sleepTimerSet.addEventListener(
    "click",
    tuningHandlers.handleSleepTimerSet,
  );
  elements.sleepTimerSelect.addEventListener(
    "change",
    tuningHandlers.handleSleepTimerSelectChange,
  );
  elements.sleepTimerModal.addEventListener(
    "click",
    tuningHandlers.handleSleepTimerModalClick,
  );
  elements.tuningTabToggle.addEventListener("click", tuningHandlers.handleTuningTabToggle);
  elements.infoButton.addEventListener("click", tuningHandlers.handleOpenInfo);
  elements.favoriteButton.addEventListener(
    "click",
    favoritesHandlers.handleFavoriteToggle,
  );
  elements.playlistButton.addEventListener(
    "click",
    playlistHandlers.handleOpenPlaylist,
  );
  elements.playlistPreviousButton.addEventListener(
    "click",
    playlistHandlers.handlePlaylistPrevious,
  );
  elements.playlistNextButton.addEventListener(
    "click",
    playlistHandlers.handlePlaylistNext,
  );
  elements.savedPlaylistButton.addEventListener(
    "click",
    playlistHandlers.handleSavedPlaylistClick,
  );
  elements.playlistClose.addEventListener(
    "click",
    playlistHandlers.handleClosePlaylist,
  );
  elements.playlistModal.addEventListener(
    "click",
    playlistHandlers.handlePlaylistModalClick,
  );
  elements.playlistClearButton.addEventListener(
    "click",
    playlistHandlers.handleClearPlaylist,
  );
  elements.deleteButton.addEventListener(
    "click",
    deleteJobHandlers.handleDeleteJobClick,
  );
  elements.deleteConfirmCancel.addEventListener(
    "click",
    deleteJobHandlers.handleDeleteConfirmCancel,
  );
  elements.deleteConfirmDelete.addEventListener(
    "click",
    deleteJobHandlers.handleDeleteConfirmDelete,
  );
  elements.deleteConfirmModal.addEventListener(
    "click",
    deleteJobHandlers.handleDeleteConfirmModalClick,
  );
  elements.branchStatsDeleteButton.addEventListener(
    "click",
    playbackHandlers.handleBranchStatsDeleteClick,
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
  elements.tuningApply.addEventListener("click", tuningHandlers.handleTuningApply);
  elements.tuningReset.addEventListener("click", tuningHandlers.handleTuningReset);
  elements.playButton.addEventListener("click", playbackHandlers.handlePlayClick);
  if (elements.vizPlayButton !== elements.playButton) {
    elements.vizPlayButton.addEventListener(
      "click",
      playbackHandlers.handlePlayClick,
    );
  }
  elements.shortUrlButton.addEventListener(
    "click",
    playbackHandlers.handleShortUrlClick,
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
  document.addEventListener("click", tuningHandlers.handleVolumeDocumentClick);
  window.addEventListener("keydown", deleteJobHandlers.handleDeleteConfirmKeydown);
  window.addEventListener("keydown", playlistHandlers.handlePlaylistModalKeydown);
  window.addEventListener("keydown", playbackHandlers.handleKeydown);
  window.addEventListener("keyup", playbackHandlers.handleKeyup);

  jukebox.setOnSelect(playbackHandlers.handleBeatSelect);
  jukebox.setOnEdgeSelect(playbackHandlers.handleEdgeSelect);
}

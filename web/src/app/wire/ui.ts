import type { Elements } from "../elements";
import type { JukeboxController } from "../../jukebox/JukeboxController";
import type { PlaybackUiHandlers } from "./playback";
import type { FullscreenHandlers } from "./fullscreen";
import type { VolumeHandlers } from "./volume";
import type { PlaylistHandlers } from "./playlist";

type UiBindingsDeps = {
  elements: Elements;
  jukebox: JukeboxController;
  playbackHandlers: PlaybackUiHandlers;
  fullscreenHandlers: FullscreenHandlers;
  volumeHandlers: VolumeHandlers;
  playlistHandlers: PlaylistHandlers;
};

// Remaining legacy Listen-panel listeners: transport/mode controls (8d),
// volume + fullscreen (8b), branch-stats popup + viz callbacks (8e),
// playlist transport buttons (8d).
export function bindUiHandlers(deps: UiBindingsDeps) {
  const {
    elements,
    jukebox,
    playbackHandlers,
    fullscreenHandlers,
    volumeHandlers,
    playlistHandlers,
  } = deps;

  elements.volumeInput.addEventListener(
    "input",
    volumeHandlers.handleVolumeInput,
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
  elements.playButton.addEventListener("click", playbackHandlers.handlePlayClick);
  if (elements.vizPlayButton !== elements.playButton) {
    elements.vizPlayButton.addEventListener(
      "click",
      playbackHandlers.handlePlayClick,
    );
  }
  elements.volumeButton.addEventListener(
    "click",
    volumeHandlers.handleVolumeButtonClick,
  );

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
  document.addEventListener("click", volumeHandlers.handleVolumeDocumentClick);

  jukebox.setOnSelect(playbackHandlers.handleBeatSelect);
  jukebox.setOnEdgeSelect(playbackHandlers.handleEdgeSelect);
}

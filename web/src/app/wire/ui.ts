import type { Elements } from "../elements";
import type { JukeboxController } from "../../jukebox/JukeboxController";
import type { PlaybackUiHandlers } from "./playback";
import type { FullscreenHandlers } from "./fullscreen";

type UiBindingsDeps = {
  elements: Elements;
  jukebox: JukeboxController;
  playbackHandlers: PlaybackUiHandlers;
  fullscreenHandlers: FullscreenHandlers;
};

// Remaining legacy Listen-panel listeners: branch-stats popup + viz
// callbacks (8e) and the document-level fullscreen/visibility hooks.
export function bindUiHandlers(deps: UiBindingsDeps) {
  const { elements, jukebox, playbackHandlers, fullscreenHandlers } = deps;

  elements.branchStatsDeleteButton.addEventListener(
    "click",
    playbackHandlers.handleBranchStatsDeleteClick,
  );
  document.addEventListener(
    "fullscreenchange",
    fullscreenHandlers.handleFullscreenChange,
  );
  document.addEventListener(
    "visibilitychange",
    fullscreenHandlers.handleVisibilityChange,
  );

  fullscreenHandlers.updateFullscreenButton(Boolean(document.fullscreenElement));

  jukebox.setOnSelect(playbackHandlers.handleBeatSelect);
  jukebox.setOnEdgeSelect(playbackHandlers.handleEdgeSelect);
}

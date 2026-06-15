import type { JukeboxController } from "@forever-jukebox/engine/viz/JukeboxController";
import { releaseWakeLock, requestWakeLock } from "../playback/wake-lock";
import { useAppStore } from "../store";

type FullscreenDeps = {
  jukebox: JukeboxController;
  getVizPanel: () => HTMLElement;
};

export type FullscreenHandlers = ReturnType<typeof createFullscreenHandlers>;

export function createFullscreenHandlers(deps: FullscreenDeps) {
  const { jukebox, getVizPanel } = deps;

  function handleFullscreenToggle() {
    if (!document.fullscreenElement) {
      getVizPanel()
        .requestFullscreen()
        .then(() => {
          requestWakeLock();
        })
        .catch(() => {
          console.warn("Failed to enter fullscreen");
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          releaseWakeLock();
        })
        .catch(() => {
          console.warn("Failed to exit fullscreen");
        });
    }
  }

  function handleFullscreenChange() {
    if (document.fullscreenElement) {
      updateFullscreenButton(true);
      requestWakeLock();
    } else {
      updateFullscreenButton(false);
      releaseWakeLock();
    }
    jukebox.resizeActive();
  }

  // The React fullscreen button renders from this store flag.
  function updateFullscreenButton(isFullscreen: boolean) {
    useAppStore.setState({ isFullscreen });
  }

  function handleVisibilityChange() {
    if (!document.hidden && document.fullscreenElement) {
      requestWakeLock();
    } else if (document.hidden) {
      releaseWakeLock();
    }
  }

  return {
    handleFullscreenToggle,
    handleFullscreenChange,
    updateFullscreenButton,
    handleVisibilityChange,
  };
}

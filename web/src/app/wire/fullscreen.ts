import type { AppContext } from "../context";
import type { Elements } from "../elements";
import type { JukeboxController } from "../../jukebox/JukeboxController";
import { useAppStore } from "../store";

type FullscreenDeps = {
  context: AppContext;
  elements: Elements;
  jukebox: JukeboxController;
  requestWakeLock: (context: AppContext) => void;
  releaseWakeLock: (context: AppContext) => void;
};

export type FullscreenHandlers = ReturnType<typeof createFullscreenHandlers>;

export function createFullscreenHandlers(deps: FullscreenDeps) {
  const { context, elements, jukebox, requestWakeLock, releaseWakeLock } = deps;

  function handleFullscreenToggle() {
    if (!document.fullscreenElement) {
      elements.vizPanel
        .requestFullscreen()
        .then(() => {
          requestWakeLock(context);
        })
        .catch(() => {
          console.warn("Failed to enter fullscreen");
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          releaseWakeLock(context);
        })
        .catch(() => {
          console.warn("Failed to exit fullscreen");
        });
    }
  }

  function handleFullscreenChange() {
    if (document.fullscreenElement) {
      updateFullscreenButton(true);
      requestWakeLock(context);
    } else {
      updateFullscreenButton(false);
      releaseWakeLock(context);
    }
    jukebox.resizeActive();
  }

  // The React fullscreen button renders from this store flag.
  function updateFullscreenButton(isFullscreen: boolean) {
    useAppStore.setState({ isFullscreen });
  }

  function handleVisibilityChange() {
    if (!document.hidden && document.fullscreenElement) {
      requestWakeLock(context);
    } else if (document.hidden) {
      releaseWakeLock(context);
    }
  }

  return {
    handleFullscreenToggle,
    handleFullscreenChange,
    updateFullscreenButton,
    handleVisibilityChange,
  };
}

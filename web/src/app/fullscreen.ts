import { releaseWakeLock, requestWakeLock } from "./playback/wake-lock";
import { getAttachedAppContext, getVizPanel } from "./runtime";
import { useAppStore } from "./store";

export function toggleFullscreen(): void {
  const vizPanel = getVizPanel();
  if (!vizPanel) {
    return;
  }
  if (!document.fullscreenElement) {
    vizPanel
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

export function handleFullscreenChange(): void {
  if (document.fullscreenElement) {
    updateFullscreenButton(true);
    requestWakeLock();
  } else {
    updateFullscreenButton(false);
    releaseWakeLock();
  }
  getAttachedAppContext()?.jukebox.resizeActive();
}

// The React fullscreen button renders from this store flag.
export function updateFullscreenButton(isFullscreen: boolean): void {
  useAppStore.setState({ isFullscreen });
}

export function handleVisibilityChange(): void {
  if (!document.hidden && document.fullscreenElement) {
    requestWakeLock();
  } else if (document.hidden) {
    releaseWakeLock();
  }
}

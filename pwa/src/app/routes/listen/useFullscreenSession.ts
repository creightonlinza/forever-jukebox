import React from "react";
import type { AutocanonizerController } from "@forever-jukebox/shared/autocanonizer/AutocanonizerController";
import type { JukeboxController } from "@forever-jukebox/shared/viz/JukeboxController";
import type { PlayMode } from "./types";
import { useWakeLock } from "./useWakeLock";

// Fullscreen state for the viz panel plus the wake lock that is only held
// while the panel is fullscreen and visible.
export function useFullscreenSession({
  vizPanelRef,
  vizControllerRef,
  autocanonizerRef,
  playModeRef,
}: {
  vizPanelRef: React.RefObject<HTMLDivElement>;
  vizControllerRef: React.RefObject<JukeboxController>;
  autocanonizerRef: React.RefObject<AutocanonizerController>;
  playModeRef: React.MutableRefObject<PlayMode>;
}) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const { requestWakeLock, releaseWakeLock } = useWakeLock();

  const requestWakeLockSafely = React.useCallback(() => {
    requestWakeLock().catch((err) => {
      console.warn(`Wake lock request failed: ${String(err)}`);
    });
  }, [requestWakeLock]);

  const releaseWakeLockSafely = React.useCallback(() => {
    releaseWakeLock().catch((err) => {
      console.warn(`Wake lock release failed: ${String(err)}`);
    });
  }, [releaseWakeLock]);

  React.useEffect(() => {
    const onFullscreen = () => {
      const active = document.fullscreenElement === vizPanelRef.current;
      setIsFullscreen(active);
      if (playModeRef.current === "autocanonizer") {
        autocanonizerRef.current?.resizeNow();
      } else {
        vizControllerRef.current?.resizeActive();
      }
      if (active) {
        requestWakeLockSafely();
      } else {
        releaseWakeLockSafely();
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        releaseWakeLockSafely();
        return;
      }
      if (document.fullscreenElement === vizPanelRef.current) {
        requestWakeLockSafely();
      }
    };

    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [releaseWakeLockSafely, requestWakeLockSafely]);

  const onToggleFullscreen = async () => {
    if (!vizPanelRef.current) {
      return;
    }
    if (document.fullscreenElement !== vizPanelRef.current) {
      try {
        await vizPanelRef.current.requestFullscreen();
      } catch {
        // ignore
      }
      return;
    }
    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    }
  };

  const requestWakeLockIfFullscreen = () => {
    if (document.fullscreenElement === vizPanelRef.current) {
      requestWakeLockSafely();
    }
  };

  return { isFullscreen, onToggleFullscreen, requestWakeLockIfFullscreen };
}

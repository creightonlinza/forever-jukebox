import React from "react";
import type { PlayMode } from "./types";

// Volume and pan popovers: mutually exclusive, closed by outside clicks.
export function useVizPopovers({ playMode }: { playMode: PlayMode }) {
  const [isVolumeOpen, setIsVolumeOpen] = React.useState(false);
  const [isPanOpen, setIsPanOpen] = React.useState(false);
  const volumeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const volumePanelRef = React.useRef<HTMLDivElement | null>(null);
  const panButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const panPanelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isVolumeOpen && !isPanOpen) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (volumePanelRef.current?.contains(target)) {
        return;
      }
      if (volumeButtonRef.current?.contains(target)) {
        return;
      }
      if (panPanelRef.current?.contains(target)) {
        return;
      }
      if (panButtonRef.current?.contains(target)) {
        return;
      }
      setIsVolumeOpen(false);
      setIsPanOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => {
      document.removeEventListener("click", onDocumentClick);
    };
  }, [isVolumeOpen, isPanOpen]);

  React.useEffect(() => {
    if (playMode !== "autocanonizer") {
      setIsPanOpen(false);
    }
  }, [playMode]);

  const toggleVolume = () => {
    setIsPanOpen(false);
    setIsVolumeOpen((prev) => !prev);
  };

  const togglePan = () => {
    setIsVolumeOpen(false);
    setIsPanOpen((prev) => !prev);
  };

  return {
    isVolumeOpen,
    isPanOpen,
    toggleVolume,
    togglePan,
    volumeButtonRef,
    volumePanelRef,
    panButtonRef,
    panPanelRef,
  };
}

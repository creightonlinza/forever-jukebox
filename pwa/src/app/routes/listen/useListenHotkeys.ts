import React from "react";
import type { TFunction } from "i18next";
import type { Edge, JukeboxEngine } from "@forever-jukebox/shared";
import { isEditableTarget } from "./browser";
import { formatPlayVelocity } from "./labels";
import type { PlayMode, TuningModalTab } from "./types";

// Global keyboard shortcuts for the listen route. The effect re-registers
// on every dep change and its cleanup releases the held modifier modes.
export function useListenHotkeys({
  isActive,
  playMode,
  selectedEdge,
  isRunning,
  isPaused,
  isTuningOpen,
  isInfoOpen,
  isExportOpen,
  engineRef,
  bringItHomeModeRef,
  setBringItHomeMode,
  showShortcutToast,
  t,
  openTuningModalTab,
  togglePlayback,
  selectAdjacentBranch,
  deleteSelectedBranch,
  toggleSelectedAnchorBranch,
}: {
  isActive: boolean;
  playMode: PlayMode;
  selectedEdge: Edge | null;
  isRunning: boolean;
  isPaused: boolean;
  isTuningOpen: boolean;
  isInfoOpen: boolean;
  isExportOpen: boolean;
  engineRef: React.RefObject<JukeboxEngine>;
  bringItHomeModeRef: React.MutableRefObject<boolean>;
  setBringItHomeMode: (value: boolean) => void;
  showShortcutToast: (message: string, key?: string) => void;
  t: TFunction;
  openTuningModalTab: (tab: TuningModalTab) => void;
  togglePlayback: () => void;
  selectAdjacentBranch: (direction: -1 | 1) => void;
  deleteSelectedBranch: () => void;
  toggleSelectedAnchorBranch: () => boolean;
}) {
  const [forceBranchActive, setForceBranchActive] = React.useState(false);
  const [freezeBeatActive, setFreezeBeatActive] = React.useState(false);

  React.useEffect(() => {
    if (!isActive) {
      engineRef.current?.setForceBranch(false);
      engineRef.current?.setFreezeCurrentBeat(false);
      setForceBranchActive(false);
      setFreezeBeatActive(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTuningOpen || isInfoOpen || isExportOpen) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "e" || event.key === "E") &&
        !event.repeat
      ) {
        event.preventDefault();
        openTuningModalTab("extras");
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        selectedEdge
      ) {
        event.preventDefault();
        selectAdjacentBranch(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedEdge &&
        !selectedEdge.deleted
      ) {
        event.preventDefault();
        deleteSelectedBranch();
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "h" || event.key === "H") &&
        !event.repeat
      ) {
        event.preventDefault();
        const nextValue = !bringItHomeModeRef.current;
        bringItHomeModeRef.current = nextValue;
        setBringItHomeMode(nextValue);
        engineRef.current?.setBringItHomeMode(nextValue);
        if (nextValue) {
          engineRef.current?.setForceBranch(false);
          setForceBranchActive(false);
        }
        showShortcutToast(
          nextValue
            ? t("listen.bringHomeEnabled")
            : t("listen.bringHomeDisabled"),
        );
        return;
      }
      if (
        playMode === "jukebox" &&
        (event.key === "a" || event.key === "A") &&
        !event.repeat
      ) {
        if (toggleSelectedAnchorBranch()) {
          event.preventDefault();
        }
        return;
      }
      // Match brackets by typed character first, then by physical key
      // position so layouts without direct bracket keys still work.
      let bracketDirection = 0;
      if (event.key === "[") {
        bracketDirection = -1;
      } else if (event.key === "]") {
        bracketDirection = 1;
      } else if (event.code === "BracketLeft") {
        bracketDirection = -1;
      } else if (event.code === "BracketRight") {
        bracketDirection = 1;
      }
      if (playMode === "jukebox" && bracketDirection !== 0) {
        event.preventDefault();
        const engine = engineRef.current;
        if (!engine) {
          return;
        }
        const direction = bracketDirection;
        const velocity = engine.getPlayVelocity() + direction;
        engine.setPlayVelocity(velocity);
        showShortcutToast(
          t("listen.playVelocity", {
            value: formatPlayVelocity(engine.getPlayVelocity()),
          }),
          "play-velocity",
        );
        return;
      }
      if (playMode === "jukebox" && event.key === "ArrowDown") {
        event.preventDefault();
        engineRef.current?.setPlayVelocity(0);
        showShortcutToast(
          t("listen.playVelocity", { value: "0" }),
          "play-velocity",
        );
        return;
      }
      if (playMode === "jukebox" && event.key === "ArrowUp") {
        event.preventDefault();
        engineRef.current?.setPlayVelocity(1);
        showShortcutToast(
          t("listen.playVelocity", { value: "+1" }),
          "play-velocity",
        );
        return;
      }
      if (playMode === "jukebox" && event.key === "Control") {
        event.preventDefault();
        engineRef.current?.setFreezeCurrentBeat(true);
        setFreezeBeatActive(true);
        return;
      }
      if (
        playMode === "jukebox" &&
        event.key === "Shift" &&
        isRunning &&
        !bringItHomeModeRef.current
      ) {
        engineRef.current?.setForceBranch(true);
        setForceBranchActive(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        engineRef.current?.setFreezeCurrentBeat(false);
        setFreezeBeatActive(false);
      }
      if (playMode === "jukebox" && event.key === "Shift") {
        engineRef.current?.setForceBranch(false);
        setForceBranchActive(false);
      }
    };
    const onBlur = () => {
      engineRef.current?.setFreezeCurrentBeat(false);
      engineRef.current?.setForceBranch(false);
      setFreezeBeatActive(false);
      setForceBranchActive(false);
    };
    // Blur alone can be missed on tab switches (e.g. Ctrl+T), leaving
    // freeze/branch modes stuck; visibilitychange covers that path.
    const onHotkeyVisibilityChange = () => {
      if (document.hidden) {
        onBlur();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHotkeyVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener(
        "visibilitychange",
        onHotkeyVisibilityChange,
      );
      engineRef.current?.setFreezeCurrentBeat(false);
      engineRef.current?.setForceBranch(false);
      setFreezeBeatActive(false);
      setForceBranchActive(false);
    };
  }, [
    selectedEdge,
    isRunning,
    isPaused,
    isTuningOpen,
    isInfoOpen,
    isExportOpen,
    playMode,
    isActive,
    showShortcutToast,
  ]);

  return { forceBranchActive, freezeBeatActive };
}

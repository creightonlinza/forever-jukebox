import { useTranslation } from "react-i18next";
import {
  CustomAnchorButton as SharedButton,
  CustomAnchorInfo as SharedInfo,
  CustomAnchorToolbar as SharedToolbar,
  type CustomAnchorLabels,
} from "@forever-jukebox/shared/ui/CustomAnchorEditor";
import { formatDuration } from "../../format";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import {
  exitCustomAnchorEdit,
  resetCustomAnchor,
  selectCustomAnchorEnd,
  snapCustomAnchor,
  startCustomAnchorEdit,
} from "../../playback/custom-anchor";

function useCustomAnchorLabels(): CustomAnchorLabels {
  const { t } = useTranslation();
  return {
    setCustomAnchor: t("playback.setCustomAnchor"),
    title: t("playback.customAnchorTitle"),
    hint: t("playback.customAnchorHint"),
    from: t("playback.customAnchorFrom"),
    to: t("playback.customAnchorTo"),
    beat: (beat, seconds) =>
      t("playback.customAnchorBeat", { beat, time: formatDuration(seconds) }),
    snap: t("playback.customAnchorSnap"),
    snapHint: t("playback.customAnchorSnapHint"),
    reset: t("playback.customAnchorReset"),
    done: t("playback.customAnchorDone"),
    match: t("playback.customAnchorMatch"),
    barPosition: t("playback.customAnchorBarPosition"),
    loopLabel: t("playback.customAnchorLoopLabel"),
    loop: (beats, seconds, bars) => {
      const time = formatDuration(seconds);
      return bars === null
        ? t("playback.customAnchorLoop", { beats, time })
        : t("playback.customAnchorLoopBars", { bars, beats, time });
    },
  };
}

// The viz-top button that opens the editor; the Extras toggle shows it.
export function CustomAnchorButton() {
  const labels = useCustomAnchorLabels();
  const enabled = useAppStore((s) => s.customAnchorEnabled);
  const playMode = useAppStore((s) => s.playMode);
  const editing = useAppStore((s) => s.customAnchorEdit !== null);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  if (!enabled || playMode !== "jukebox" || editing) {
    return null;
  }
  return (
    <SharedButton
      labels={labels}
      disabled={!analysisLoaded}
      onStart={() => startCustomAnchorEdit(getAppContext())}
    />
  );
}

export function CustomAnchorToolbar() {
  const labels = useCustomAnchorLabels();
  const edit = useAppStore((s) => s.customAnchorEdit);
  const beats = useAppStore((s) => s.vizData?.beats);
  if (!edit || !beats) {
    return null;
  }
  return (
    <SharedToolbar
      edit={edit}
      beats={beats}
      labels={labels}
      onSelectEnd={(end) => selectCustomAnchorEnd(getAppContext(), end)}
      onSnap={() => snapCustomAnchor(getAppContext())}
      onReset={() => resetCustomAnchor(getAppContext())}
      onDone={() => exitCustomAnchorEdit(getAppContext())}
    />
  );
}

export function CustomAnchorInfo() {
  const labels = useCustomAnchorLabels();
  const edit = useAppStore((s) => s.customAnchorEdit);
  const beats = useAppStore((s) => s.vizData?.beats);
  if (!edit || !beats) {
    return null;
  }
  return <SharedInfo edit={edit} beats={beats} labels={labels} />;
}

import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CustomAnchorEnd } from "@forever-jukebox/shared";
import { formatDuration } from "../../format";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import {
  exitCustomAnchorEdit,
  resetCustomAnchor,
  selectCustomAnchorEnd,
  startCustomAnchorEdit,
} from "../../playback/custom-anchor";

// The hotkey handler skips focused buttons, so a mouse click must not leave focus behind.
function releaseMouseFocus(event: MouseEvent<HTMLButtonElement>) {
  if (event.detail > 0) {
    event.currentTarget.blur();
  }
}

// The viz-top button that opens the editor; the Extras toggle shows it.
export function CustomAnchorButton() {
  const { t } = useTranslation();
  const enabled = useAppStore((s) => s.customAnchorEnabled);
  const playMode = useAppStore((s) => s.playMode);
  const editing = useAppStore((s) => s.customAnchorEdit !== null);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  if (!enabled || playMode !== "jukebox" || editing) {
    return null;
  }
  return (
    <button
      type="button"
      id="custom-anchor-start"
      className="custom-anchor-button"
      disabled={!analysisLoaded}
      onClick={(event) => {
        releaseMouseFocus(event);
        startCustomAnchorEdit(getAppContext());
      }}
    >
      {t("playback.setCustomAnchor")}
    </button>
  );
}

// Takes over the viz-top row while editing, so it never covers a beat in any layout.
export function CustomAnchorToolbar() {
  const { t } = useTranslation();
  const edit = useAppStore((s) => s.customAnchorEdit);
  const beats = useAppStore((s) => s.vizData?.beats);
  if (!edit || !beats) {
    return null;
  }
  const time = (index: number) => formatDuration(beats[index]?.start ?? 0);
  const loopSeconds = (beats[edit.src]?.start ?? 0) - (beats[edit.dest]?.start ?? 0);
  const ends: Array<[CustomAnchorEnd, string]> = [
    ["src", t("playback.customAnchorFrom")],
    ["dest", t("playback.customAnchorTo")],
  ];
  return (
    <div
      id="custom-anchor-toolbar"
      className="custom-anchor-toolbar"
      role="toolbar"
      aria-label={t("playback.customAnchorTitle")}
      title={t("playback.customAnchorHint")}
    >
      {ends.map(([end, label]) => (
        <button
          key={end}
          type="button"
          className={
            edit.active === end
              ? "custom-anchor-end is-active"
              : "custom-anchor-end"
          }
          aria-pressed={edit.active === end}
          title={t("playback.customAnchorBeat", { beat: edit[end], time: time(edit[end]) })}
          onClick={(event) => {
            releaseMouseFocus(event);
            selectCustomAnchorEnd(getAppContext(), end);
          }}
        >
          <span className="custom-anchor-label">{label}</span> {edit[end]}
        </button>
      ))}
      <span className="custom-anchor-loop">
        {t("playback.customAnchorLoop", {
          beats: edit.src - edit.dest,
          time: formatDuration(Math.max(0, loopSeconds)),
        })}
      </span>
      <span className="custom-anchor-actions">
        <button
          type="button"
          id="custom-anchor-reset"
          onClick={(event) => {
            releaseMouseFocus(event);
            resetCustomAnchor(getAppContext());
          }}
        >
          {t("playback.customAnchorReset")}
        </button>
        <button
          type="button"
          id="custom-anchor-done"
          className="is-primary"
          onClick={() => exitCustomAnchorEdit(getAppContext())}
        >
          {t("playback.customAnchorDone")}
        </button>
      </span>
    </div>
  );
}

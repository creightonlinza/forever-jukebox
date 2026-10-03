import { useState } from "react";
import {
  CANONIZER_FINISH_KEY,
  VISUALIZATION_LABELS,
  WUB_MACHINE_LOOP_KEY,
} from "../../constants";
import { trackEvent } from "../../analytics";
import { getAppContext } from "../../runtime";
import type { PlayMode } from "../../context";
import { useAppStore } from "../../store";
import {
  setActiveVisualization,
  setCanonizerFinish,
  setPlayMode,
  setWubMachineLoop,
} from "../../playback-ui";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function getVisualizationLabel(index: number, t: TFunction) {
  return VISUALIZATION_LABELS[index] ??
    t("playback.visualizationNumber", { number: index + 1 });
}

function getVisualizationSelectEntries(count: number, t: TFunction) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    label: getVisualizationLabel(index, t),
  })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

// The viz-top controls: play-mode select, visualization select, the
// autocanonizer finish-out checkbox and the Wub Machine loop checkbox. Rendered into the .viz-top container.
export function VizTop() {
  const { t } = useTranslation();
  const playMode = useAppStore((s) => s.playMode);
  const activeVizIndex = useAppStore((s) => s.activeVizIndex);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioModePreparing = useAppStore((s) => s.audioModePreparing);
  const [finishOutSong, setFinishOutSong] = useState(
    () => localStorage.getItem(CANONIZER_FINISH_KEY) === "true",
  );
  const [loopTrack, setLoopTrack] = useState(
    () => localStorage.getItem(WUB_MACHINE_LOOP_KEY) === "true",
  );

  const vizSelectDisabled =
    !(audioLoaded && analysisLoaded) ||
    audioModePreparing ||
    playMode !== "jukebox";
  // On the very first render the controllers are not constructed yet (the
  // ref handoff happens at commit); fall back to the static label count.
  const entries = getVisualizationSelectEntries(
    getAppContext().jukebox?.getCount() ?? VISUALIZATION_LABELS.length,
    t,
  );

  return (
    <>
      <div className="viz-actions">
        <label className="viz-select-group" htmlFor="play-mode-select">
          <span className="viz-select-wrap">
            <select
              id="play-mode-select"
              className="viz-select"
              aria-label={t("playback.mode")}
              value={playMode}
              onChange={(event) => setPlayMode(event.target.value as PlayMode)}
            >
              <option value="autocanonizer">{t("playback.autocanonizer")}</option>
              <option value="jukebox">{t("playback.jukebox")}</option>
              <option value="wubmachine">{t("playback.wubMachine")}</option>
            </select>
            <span
              className="material-symbols-outlined viz-select-arrow"
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
          </span>
        </label>
      </div>
      <div className="viz-controls">
        <label className="viz-select-group" htmlFor="viz-select">
          <span className="viz-select-wrap">
            <select
              id="viz-select"
              className="viz-select"
              aria-label={t("playback.visualization")}
              disabled={vizSelectDisabled}
              value={String(activeVizIndex)}
              onChange={(event) => {
                const idx = Number(event.target.value);
                if (Number.isFinite(idx)) {
                  // Report the label, not the index: reordering the label list
                  // would otherwise silently remap historical data.
                  trackEvent("select_viz", {
                    viz: VISUALIZATION_LABELS[idx] ?? String(idx),
                  });
                  setActiveVisualization(idx);
                }
              }}
            >
              {entries.map((entry) => (
                <option key={entry.index} value={String(entry.index)}>
                  {entry.label}
                </option>
              ))}
            </select>
            <span
              className="material-symbols-outlined viz-select-arrow"
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
          </span>
        </label>
      </div>
      <label className="canonizer-finish">
        <input
          type="checkbox"
          id="canonizer-finish"
          checked={finishOutSong}
          onChange={(event) => {
            setFinishOutSong(event.target.checked);
            setCanonizerFinish(event.target.checked);
          }}
        />
        <span>{t("playback.finishTrack")}</span>
      </label>
      <label className="wubmachine-loop">
        <input
          type="checkbox"
          id="wubmachine-loop"
          checked={loopTrack}
          onChange={(event) => {
            setLoopTrack(event.target.checked);
            setWubMachineLoop(event.target.checked);
          }}
        />
        <span>{t("playback.loopTrack")}</span>
      </label>
    </>
  );
}

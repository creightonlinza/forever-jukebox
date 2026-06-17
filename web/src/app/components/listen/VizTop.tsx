import { useState } from "react";
import { CANONIZER_FINISH_KEY, VISUALIZATION_LABELS } from "../../constants";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import {
  setActiveVisualization,
  setCanonizerFinish,
  setPlayMode,
} from "../../playback-ui";

function getVisualizationLabel(index: number) {
  return VISUALIZATION_LABELS[index] ?? `Visualization ${index + 1}`;
}

function getVisualizationSelectEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    label: getVisualizationLabel(index),
  })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

// The viz-top controls: play-mode select, visualization select and the
// autocanonizer finish-out checkbox. Rendered into the .viz-top container.
export function VizTop() {
  const playMode = useAppStore((s) => s.playMode);
  const activeVizIndex = useAppStore((s) => s.activeVizIndex);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const swingPreparing = useAppStore((s) => s.swingPreparing);
  const [finishOutSong, setFinishOutSong] = useState(
    () => localStorage.getItem(CANONIZER_FINISH_KEY) === "true",
  );

  const vizSelectDisabled =
    !(audioLoaded && analysisLoaded) ||
    swingPreparing ||
    playMode === "autocanonizer";
  // On the very first render the controllers are not constructed yet (the
  // ref handoff happens at commit); fall back to the static label count.
  const entries = getVisualizationSelectEntries(
    getAppContext().jukebox?.getCount() ?? VISUALIZATION_LABELS.length,
  );

  return (
    <>
      <div className="viz-actions">
        <label className="viz-select-group" htmlFor="play-mode-select">
          <span className="viz-select-wrap">
            <select
              id="play-mode-select"
              className="viz-select"
              aria-label="Mode"
              value={playMode}
              onChange={(event) =>
                setPlayMode(
                  event.target.value === "autocanonizer"
                    ? "autocanonizer"
                    : "jukebox",
                )
              }
            >
              <option value="autocanonizer">Autocanonizer</option>
              <option value="jukebox">Jukebox</option>
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
              aria-label="Visualization"
              disabled={vizSelectDisabled}
              value={String(activeVizIndex)}
              onChange={(event) => {
                const idx = Number(event.target.value);
                if (Number.isFinite(idx)) {
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
      <div className="canonizer-finish">
        <input
          type="checkbox"
          id="canonizer-finish"
          checked={finishOutSong}
          onChange={(event) => {
            setFinishOutSong(event.target.checked);
            setCanonizerFinish(event.target.checked);
          }}
        />
        <span>Finish out the track</span>
      </div>
    </>
  );
}

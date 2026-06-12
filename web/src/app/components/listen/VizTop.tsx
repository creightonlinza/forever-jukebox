import { useState } from "react";
import type { AppBridge } from "../../bridge";
import { VISUALIZATION_LABELS } from "../../constants";
import { useAppStore } from "../../store";

const CANONIZER_FINISH_KEY = "fj-canonizer-finish";

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
// autocanonizer finish-out checkbox. Renders via portal into the legacy
// .viz-top container.
export function VizTop({ bridge }: { bridge: AppBridge }) {
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
  const entries = getVisualizationSelectEntries(
    bridge.context.jukebox.getCount(),
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
                bridge.listenPanel.setPlayMode(
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
                  bridge.listenPanel.setActiveVisualization(idx);
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
            bridge.listenPanel.setCanonizerFinish(event.target.checked);
          }}
        />
        <span>Finish out the track</span>
      </div>
    </>
  );
}

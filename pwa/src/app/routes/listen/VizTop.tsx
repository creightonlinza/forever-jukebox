import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { getVisualizationLabel } from "./labels";
import type { PlayMode } from "./types";

export function VizTop({
  playMode,
  onPlayModeChange,
  activeVizIndex,
  vizCount,
  onActiveVizChange,
  finishOutSong,
  onFinishOutSongChange,
}: {
  playMode: PlayMode;
  onPlayModeChange: (mode: PlayMode) => void;
  activeVizIndex: number;
  vizCount: number;
  onActiveVizChange: (index: number) => void;
  finishOutSong: boolean;
  onFinishOutSongChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="viz-top">
      <div className="viz-actions">
        <label className="viz-select-group" htmlFor="play-mode-select">
          <span className="viz-select-wrap">
            <select
              id="play-mode-select"
              className="viz-select"
              aria-label={t("listen.mode")}
              value={playMode}
              onChange={(event) =>
                onPlayModeChange(
                  event.target.value === "autocanonizer"
                    ? "autocanonizer"
                    : "jukebox"
                )
              }
            >
              <option value="autocanonizer">{t("listen.autocanonizer")}</option>
              <option value="jukebox">{t("listen.jukebox")}</option>
            </select>
            <SymbolIcon className="viz-select-arrow" name="arrow_drop_down" />
          </span>
        </label>
      </div>
      <div className="viz-controls">
        <label className="viz-select-group" htmlFor="viz-select">
          <span className="viz-select-wrap">
            <select
              id="viz-select"
              className="viz-select"
              aria-label={t("listen.visualization")}
              value={String(activeVizIndex)}
              onChange={(event) => onActiveVizChange(Number(event.target.value))}
              disabled={playMode === "autocanonizer"}
            >
              {Array.from({ length: vizCount }, (_, index) => (
                <option key={index} value={index}>
                  {getVisualizationLabel(index, t)}
                </option>
              ))}
            </select>
            <SymbolIcon className="viz-select-arrow" name="arrow_drop_down" />
          </span>
        </label>
      </div>
      <label className="canonizer-finish">
        <input
          id="canonizer-finish"
          type="checkbox"
          checked={finishOutSong}
          onChange={(event) => onFinishOutSongChange(event.target.checked)}
        />
        <span>{t("listen.finishTrack")}</span>
      </label>
    </div>
  );
}

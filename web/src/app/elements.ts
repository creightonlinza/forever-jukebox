import { requireElement } from "./dom";

export type Elements = ReturnType<typeof getElements>;

export function getElements() {
  const vizPanel = requireElement(
    document.querySelector<HTMLElement>("#viz-panel"),
    "#viz-panel"
  );
  const vizLayer = requireElement(
    document.querySelector<HTMLDivElement>("#viz-layer"),
    "#viz-layer"
  );
  const canonizerLayer = requireElement(
    document.querySelector<HTMLDivElement>("#canonizer-layer"),
    "#canonizer-layer"
  );
  const canonizerFinish = requireElement(
    document.querySelector<HTMLInputElement>("#canonizer-finish"),
    "#canonizer-finish"
  );
  const jukeboxViz = requireElement(
    document.querySelector<HTMLDivElement>("#jukebox-viz"),
    "#jukebox-viz"
  );
  const vizSelect = requireElement(
    document.querySelector<HTMLSelectElement>("#viz-select"),
    "#viz-select"
  );
  const playModeSelect = requireElement(
    document.querySelector<HTMLSelectElement>("#play-mode-select"),
    "#play-mode-select"
  );
  const playButton =
    document.querySelector<HTMLButtonElement>("#play") ??
    requireElement(
      document.querySelector<HTMLButtonElement>("#viz-play"),
      "#viz-play"
    );
  const vizPlayButton = requireElement(
    document.querySelector<HTMLButtonElement>("#viz-play"),
    "#viz-play"
  );
  const playlistPreviousButton = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-previous"),
    "#playlist-previous"
  );
  const playlistNextButton = requireElement(
    document.querySelector<HTMLButtonElement>("#playlist-next"),
    "#playlist-next"
  );
  const branchStatsPopup = requireElement(
    document.querySelector<HTMLDivElement>("#branch-stats-popup"),
    "#branch-stats-popup"
  );
  const branchStatsTitleEl = requireElement(
    document.querySelector<HTMLDivElement>("#branch-stats-title"),
    "#branch-stats-title"
  );
  const branchStatsDeleteButton = requireElement(
    document.querySelector<HTMLButtonElement>("#branch-stats-delete"),
    "#branch-stats-delete"
  );
  const branchStatsStartEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-start"),
    "#branch-stats-start"
  );
  const branchStatsEndEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-end"),
    "#branch-stats-end"
  );
  const branchStatsDeltaEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-delta"),
    "#branch-stats-delta"
  );
  const branchStatsDirectionEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-direction"),
    "#branch-stats-direction"
  );
  const branchStatsSimilarityEl = requireElement(
    document.querySelector<HTMLSpanElement>("#branch-stats-similarity"),
    "#branch-stats-similarity"
  );
  const vizStats = document.querySelector<HTMLDivElement>("#viz-stats");

  return {
    vizPanel,
    vizLayer,
    canonizerLayer,
    canonizerFinish,
    jukeboxViz,
    vizSelect,
    playModeSelect,
    playButton,
    vizPlayButton,
    playlistPreviousButton,
    playlistNextButton,
    branchStatsPopup,
    branchStatsTitleEl,
    branchStatsDeleteButton,
    branchStatsStartEl,
    branchStatsEndEl,
    branchStatsDeltaEl,
    branchStatsDirectionEl,
    branchStatsSimilarityEl,
    vizStats,
  };
}

import type { AppContext } from "../context";
import { formatDuration } from "../format";
import { useAppStore } from "../store";

export type TuningModalTab = "tuning" | "extras";

export function updateListenTimeDisplay() {
  const { playTimerMs, lastPlayStamp } = useAppStore.getState();
  const now = performance.now();
  const totalMs = playTimerMs + (lastPlayStamp !== null ? now - lastPlayStamp : 0);
  useAppStore.setState({ listenTimeText: formatDuration(totalMs / 1000) });
}

export function updateTrackInfo(context: AppContext) {
  const { engine, player } = context;
  const { trackDurationSec, vizData, deletedEdgeIds } = useAppStore.getState();
  const graph = engine.getGraphState();
  const resolvedDuration =
    typeof trackDurationSec === "number" && Number.isFinite(trackDurationSec)
      ? trackDurationSec
      : player.getDuration();
  const durationText =
    typeof resolvedDuration === "number" && Number.isFinite(resolvedDuration)
      ? formatDuration(resolvedDuration)
      : "00:00:00";
  const branchCount = vizData
    ? vizData.edges.length
    : graph
      ? graph.allEdges.filter((edge) => !edge.deleted).length
      : 0;
  const deletedCount = graph
    ? graph.allEdges.filter((edge) => edge.deleted).length
    : deletedEdgeIds.length;
  // The React info modal renders this store state.
  useAppStore.setState({
    trackInfo: {
      durationText,
      totalBeats: graph ? graph.totalBeats : 0,
      branchCount,
      deletedCount,
    },
  });
}

// Restarts the CSS pulse animation on the viz-bottom bar. Kept imperative:
// the remove/reflow/add trick cannot be expressed as rendered state.
export function pulseVizStats() {
  if (typeof document === "undefined" || !document.getElementById) {
    return;
  }
  const vizStats = document.getElementById("viz-stats");
  if (!vizStats) {
    return;
  }
  vizStats.classList.remove("pulse");
  void vizStats.offsetWidth;
  vizStats.classList.add("pulse");
}

// The React transport buttons derive icon/label/disabled from the store;
// only the play-tab pulse needs an explicit write here.
export function updatePlayButton() {
  const { isRunning, activeTabId, setPlayTabPulsing } = useAppStore.getState();
  setPlayTabPulsing(isRunning && activeTabId !== "play");
}

export function updateVizVisibility() {
  // Panel visibility and resize-on-reveal are derived in <VizContainer>;
  // only the play-tab pulse remains imperative.
  updatePlayButton();
}

// The React volume panel renders this store value.
export function syncVolumeUI(context: AppContext) {
  const { player } = context;
  useAppStore.setState({ volumePct: Math.round(player.getVolume() * 100) });
}

function openTuningTab(context: AppContext, tab: "tuning" | "extras") {
  syncVolumeUI(context);
  const hasExtrasTab = useAppStore.getState().playMode === "jukebox";
  useAppStore.setState({
    tuningModalOpen: true,
    tuningModalTab: tab === "extras" && hasExtrasTab ? "extras" : "tuning",
  });
}

export function openTuning(context: AppContext) {
  openTuningTab(context, "tuning");
}

export function openExtras(context: AppContext) {
  openTuningTab(context, "extras");
}

export function closeTuning() {
  useAppStore.setState({ tuningModalOpen: false });
}

export function openInfo(context: AppContext) {
  updateTrackInfo(context);
  useAppStore.setState({ infoModalOpen: true });
}

export function closeInfo() {
  useAppStore.setState({ infoModalOpen: false });
}

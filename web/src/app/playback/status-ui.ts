import type { AppContext } from "../context";
import { formatDuration } from "../format";
import { useAppStore } from "../store";

export type TuningModalTab = "tuning" | "extras";

export function updateListenTimeDisplay(context: AppContext) {
  const { state } = context;
  const now = performance.now();
  const totalMs =
    state.playTimerMs +
    (state.lastPlayStamp !== null ? now - state.lastPlayStamp : 0);
  useAppStore.setState({ listenTimeText: formatDuration(totalMs / 1000) });
}

export function updateTrackInfo(context: AppContext) {
  const { engine, player, state } = context;
  const graph = engine.getGraphState();
  const resolvedDuration =
    typeof state.trackDurationSec === "number" &&
    Number.isFinite(state.trackDurationSec)
      ? state.trackDurationSec
      : player.getDuration();
  const durationText =
    typeof resolvedDuration === "number" && Number.isFinite(resolvedDuration)
      ? formatDuration(resolvedDuration)
      : "00:00:00";
  const branchCount = state.vizData
    ? state.vizData.edges.length
    : graph
      ? graph.allEdges.filter((edge) => !edge.deleted).length
      : 0;
  const deletedCount = graph
    ? graph.allEdges.filter((edge) => edge.deleted).length
    : state.deletedEdgeIds.length;
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
export function updatePlayButton(context: AppContext) {
  const { state } = context;
  const shouldPulse = state.isRunning && state.activeTabId !== "play";
  useAppStore.getState().setPlayTabPulsing(shouldPulse);
}

export function updateVizVisibility(context: AppContext) {
  // Panel visibility and resize-on-reveal are derived in <VizContainer>;
  // only the play-tab pulse remains imperative.
  updatePlayButton(context);
}

// The React volume panel renders this store value.

// The React volume panel renders this store value.
export function syncVolumeUI(context: AppContext) {
  const { player } = context;
  useAppStore.setState({ volumePct: Math.round(player.getVolume() * 100) });
}

function openTuningTab(context: AppContext, tab: "tuning" | "extras") {
  syncVolumeUI(context);
  const hasExtrasTab = context.state.playMode === "jukebox";
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

export function closeTuning(context: AppContext) {
  void context;
  useAppStore.setState({ tuningModalOpen: false });
}

export function openInfo(context: AppContext) {
  updateTrackInfo(context);
  useAppStore.setState({ infoModalOpen: true });
}

export function closeInfo(context: AppContext) {
  void context;
  useAppStore.setState({ infoModalOpen: false });
}

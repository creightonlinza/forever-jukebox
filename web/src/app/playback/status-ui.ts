import type { AppContext } from "../context";
import { formatDuration } from "../format";
import { useAppStore } from "../store";

export type TuningModalTab = "tuning" | "extras";

export function updateListenTimeDisplay() {
  const { playTimerMs, lastPlayStamp } = useAppStore.getState();
  const now = performance.now();
  const totalMs = playTimerMs + (lastPlayStamp !== null ? now - lastPlayStamp : 0);
  // Polled ~5Hz but the displayed value only changes per second; skip the
  // redundant writes so subscribers aren't woken four times a second for the
  // same string.
  const listenTimeText = formatDuration(totalMs / 1000);
  if (useAppStore.getState().listenTimeText !== listenTimeText) {
    useAppStore.setState({ listenTimeText });
  }
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
  const branchCount =
    vizData?.edges.length ??
    graph?.allEdges.filter((edge) => !edge.deleted).length ??
    0;
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

// React renders this pulse marker onto #viz-stats.
export function pulseVizStats() {
  useAppStore.setState({
    vizStatsPulseId: useAppStore.getState().vizStatsPulseId + 1,
  });
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

// Fan a 0–100 volume percentage out to every audio sink: the main player, the
// autocanonizer (only once its viz controller is attached), and the cowbell
// overlay. Centralised so the pct→fraction conversion can't drift — a missing
// /100 here ships audio 100x too loud.
export function setMasterVolume(context: AppContext, volumePct: number) {
  const volume = volumePct / 100;
  context.player.setVolume(volume);
  context.autocanonizer?.setVolume(volume);
  context.cowbellOverlay.setVolume(volume);
}

export function setAutocanonizerStreamPans(
  context: AppContext,
  mainPan: number,
  otherPan: number,
) {
  context.autocanonizer?.setStreamPans(mainPan / 100, otherPan / 100);
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

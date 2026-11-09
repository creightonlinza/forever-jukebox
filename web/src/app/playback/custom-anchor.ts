import {
  isValidCustomAnchor,
  moveCustomAnchorEnd,
  MIN_CUSTOM_ANCHOR_GAP,
  type CustomAnchorEnd,
} from "@forever-jukebox/shared";
import type { AnchorEditState } from "@forever-jukebox/shared/viz/JukeboxViz";
import type { AppContext } from "../context";
import { useAppStore } from "../store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "../tuning";
import { updateTrackInfo } from "./status-ui";

// Each commit re-arms the player's anchor swap, so key repeats commit once they settle.
const NUDGE_COMMIT_DELAY_MS = 300;
const DEFAULT_BEATS_PER_BAR = 4;

let pendingNudgeCommit: ReturnType<typeof setTimeout> | null = null;

function cancelPendingNudgeCommit() {
  if (pendingNudgeCommit !== null) {
    clearTimeout(pendingNudgeCommit);
    pendingNudgeCommit = null;
  }
}

function showEditState(context: AppContext, state: AnchorEditState | null) {
  useAppStore.setState({ customAnchorEdit: state });
  context.jukebox?.setAnchorEdit(state);
}

// Starts from the anchor in force, or the widest loop when the track has none.
function initialEditState(context: AppContext): AnchorEditState | null {
  const beatCount = useAppStore.getState().vizData?.beats.length ?? 0;
  const active = context.engine.getActiveAnchor();
  if (active && isValidCustomAnchor(beatCount, active.src, active.dest)) {
    return { ...active, active: "src" };
  }
  if (beatCount <= MIN_CUSTOM_ANCHOR_GAP) {
    return null;
  }
  return { src: beatCount - 1, dest: 0, active: "src" };
}

export function canEditCustomAnchor(context: AppContext): boolean {
  const { playMode, analysisLoaded } = useAppStore.getState();
  return playMode === "jukebox" && analysisLoaded && initialEditState(context) !== null;
}

export function startCustomAnchorEdit(context: AppContext): boolean {
  if (!canEditCustomAnchor(context)) {
    return false;
  }
  // Edge selection is off while editing, so a stale selection would only confuse.
  useAppStore.setState({ selectedEdge: null, branchStats: null });
  context.jukebox?.setSelectedEdge(null);
  showEditState(context, initialEditState(context));
  return true;
}

// Leaves edit mode; a nudge still waiting for its commit lands first.
export function exitCustomAnchorEdit(context: AppContext) {
  const state = useAppStore.getState().customAnchorEdit;
  const nudgePending = pendingNudgeCommit !== null;
  cancelPendingNudgeCommit();
  if (!state) {
    return;
  }
  if (nudgePending) {
    commitCustomAnchor(context, state);
  }
  showEditState(context, null);
}

// Drops edit mode without committing, for track loads and resets that replace the anchor.
export function discardCustomAnchorEdit(context: AppContext) {
  cancelPendingNudgeCommit();
  if (useAppStore.getState().customAnchorEdit) {
    showEditState(context, null);
  }
}

export function commitCustomAnchor(context: AppContext, state: AnchorEditState) {
  const current = context.engine.getCustomAnchor();
  if (current && current.src === state.src && current.dest === state.dest) {
    return;
  }
  if (!context.engine.setCustomAnchor(state.src, state.dest)) {
    return;
  }
  refreshAfterAnchorChange(context);
}

function refreshAfterAnchorChange(context: AppContext) {
  const vizData = context.engine.getVisualizationData();
  useAppStore.setState({ vizData });
  if (vizData) {
    context.jukebox?.setData(vizData);
  }
  updateTrackInfo(context);
  syncTuningParamsState(context);
  writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
}

// Viz drag updates arrive here; the viz already shows them, so only the store follows.
export function handleAnchorEditChange(state: AnchorEditState) {
  if (useAppStore.getState().customAnchorEdit) {
    useAppStore.setState({ customAnchorEdit: state });
  }
}

export function handleAnchorEditCommit(context: AppContext, state: AnchorEditState) {
  if (!useAppStore.getState().customAnchorEdit) {
    return;
  }
  cancelPendingNudgeCommit();
  useAppStore.setState({ customAnchorEdit: state });
  commitCustomAnchor(context, state);
}

export function selectCustomAnchorEnd(context: AppContext, end: CustomAnchorEnd) {
  const state = useAppStore.getState().customAnchorEdit;
  if (state && state.active !== end) {
    showEditState(context, { ...state, active: end });
  }
}

function beatsPerBarAt(index: number): number {
  const beat = useAppStore.getState().vizData?.beats[index];
  const length = beat?.parent?.children?.length ?? 0;
  return length > 0 ? length : DEFAULT_BEATS_PER_BAR;
}

// Moves the selected end by one beat, or by one bar when byBar is set.
export function nudgeCustomAnchor(
  context: AppContext,
  direction: -1 | 1,
  byBar: boolean,
) {
  const state = useAppStore.getState().customAnchorEdit;
  const beatCount = useAppStore.getState().vizData?.beats.length ?? 0;
  if (!state || beatCount === 0) {
    return;
  }
  const from = state[state.active];
  const step = byBar ? beatsPerBarAt(from) : 1;
  const next = moveCustomAnchorEnd(beatCount, state, state.active, from + direction * step);
  if (next.src === state.src && next.dest === state.dest) {
    return;
  }
  const nextState = { ...next, active: state.active };
  showEditState(context, nextState);
  cancelPendingNudgeCommit();
  pendingNudgeCommit = setTimeout(() => {
    pendingNudgeCommit = null;
    const latest = useAppStore.getState().customAnchorEdit;
    if (latest) {
      commitCustomAnchor(context, latest);
    }
  }, NUDGE_COMMIT_DELAY_MS);
}

// Returns to the track's default anchor and keeps the editor open on it.
export function resetCustomAnchor(context: AppContext) {
  cancelPendingNudgeCommit();
  context.engine.setUserAnchorEdge(null);
  refreshAfterAnchorChange(context);
  if (useAppStore.getState().customAnchorEdit) {
    showEditState(context, initialEditState(context));
  }
}

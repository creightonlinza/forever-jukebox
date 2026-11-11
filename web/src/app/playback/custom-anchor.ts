import type { CustomAnchorEnd } from "@forever-jukebox/shared";
import {
  CustomAnchorEditing,
  type CustomAnchorEditHost,
} from "@forever-jukebox/shared/viz/CustomAnchorEditing";
import type { AnchorEditState } from "@forever-jukebox/shared/viz/JukeboxViz";
import type { AppContext } from "../context";
import { useAppStore } from "../store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "../tuning";
import { updateTrackInfo } from "./status-ui";

const editing = new CustomAnchorEditing();

// The store holds the edit state; the viz mirrors it for the handles.
function hostFor(context: AppContext): CustomAnchorEditHost {
  return {
    engine: context.engine,
    beats: () => useAppStore.getState().vizData?.beats ?? [],
    getEdit: () => useAppStore.getState().customAnchorEdit,
    setEdit: (state: AnchorEditState | null) => {
      useAppStore.setState({ customAnchorEdit: state });
      context.jukebox?.setAnchorEdit(state);
    },
    onAnchorChanged: () => {
      const vizData = context.engine.getVisualizationData();
      useAppStore.setState({ vizData });
      if (vizData) {
        context.jukebox?.setData(vizData);
      }
      updateTrackInfo(context);
      syncTuningParamsState(context);
      writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
    },
  };
}

export function startCustomAnchorEdit(context: AppContext): boolean {
  const { playMode, analysisLoaded } = useAppStore.getState();
  if (playMode !== "jukebox" || !analysisLoaded) {
    return false;
  }
  const host = hostFor(context);
  if (!editing.canStart(host)) {
    return false;
  }
  // Edge selection is off while editing, so a stale selection would only confuse.
  useAppStore.setState({ selectedEdge: null, branchStats: null });
  context.jukebox?.setSelectedEdge(null);
  return editing.start(host);
}

export function exitCustomAnchorEdit(context: AppContext) {
  editing.exit(hostFor(context));
}

export function discardCustomAnchorEdit(context: AppContext) {
  editing.discard(hostFor(context));
}

export function handleAnchorEditChange(context: AppContext, state: AnchorEditState) {
  editing.dragChanged(hostFor(context), state);
}

export function handleAnchorEditCommit(context: AppContext, state: AnchorEditState) {
  editing.dragCommitted(hostFor(context), state);
}

export function selectCustomAnchorEnd(context: AppContext, end: CustomAnchorEnd) {
  editing.selectEnd(hostFor(context), end);
}

export function nudgeCustomAnchor(context: AppContext, direction: -1 | 1, byBar: boolean) {
  editing.nudge(hostFor(context), direction, byBar);
}

export function snapCustomAnchor(context: AppContext) {
  editing.snap(hostFor(context));
}

export function resetCustomAnchor(context: AppContext) {
  editing.reset(hostFor(context));
}

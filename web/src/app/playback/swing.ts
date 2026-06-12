import type { AppContext } from "../context";
import { getOrCreateSwingBuffer } from "../../audio/swingBufferCache";
import { renderSwingBuffer } from "../../audio/swingRenderer";
import { useAppStore } from "../store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "../tuning";
import { showToast } from "../ui";
import { updatePlayButton, updateVizVisibility } from "./status-ui";
import { pausePlayback, startJukeboxPlayback } from "./transport";

function getCurrentSwingSourceIdentity(context: AppContext): string | null {
  const { state } = context;
  return state.lastTrackId ?? state.lastJobId ?? null;
}

export function canPrepareSwingMode(context: AppContext) {
  return (
    context.state.playMode === "jukebox" &&
    context.state.audioLoaded &&
    context.state.analysisLoaded &&
    context.player.getSourceBuffer() !== null &&
    context.state.vizData !== null &&
    context.state.vizData.beats.length > 0
  );
}

export function prepareSwingMode(context: AppContext) {
  if (context.state.jukeboxAudioMode !== "swing") {
    return;
  }
  const sourceBuffer = context.player.getSourceBuffer();
  const beats = context.state.vizData?.beats;
  if (!sourceBuffer || !beats || beats.length === 0) {
    return;
  }
  const resumeAfterPrepare = context.state.isRunning;
  if (context.state.isRunning) {
    pausePlayback(context);
  }
  const renderToken = context.state.swingRenderToken + 1;
  context.state.swingRenderToken = renderToken;
  context.state.swingPreparing = true;
  useAppStore.setState({
    analysisStatusText: "Adding swing to the track...",
    analysisSpinning: true,
    analysisProgressText: "0%",
  });
  updateVizVisibility();
  updatePlayButton();

  const sourceIdentity = getCurrentSwingSourceIdentity(context);
  void getOrCreateSwingBuffer(sourceBuffer, sourceIdentity, () =>
    renderSwingBuffer(sourceBuffer, beats, {
      onProgress: (progress) => {
        if (
          context.state.swingRenderToken !== renderToken ||
          context.state.jukeboxAudioMode !== "swing"
        ) {
          return;
        }
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        useAppStore.setState({ analysisProgressText: `${percent}%` });
      },
    }),
  )
    .then((buffer) => {
      if (
        context.state.swingRenderToken !== renderToken ||
        context.state.jukeboxAudioMode !== "swing"
      ) {
        return;
      }
      context.state.swingPreparing = false;
      context.player.setRenderedJukeboxAudioBuffer("swing", buffer);
      context.player.setJukeboxAudioMode("swing");
      useAppStore.setState({
        analysisStatusText: "Swing mode ready.",
        analysisSpinning: false,
        analysisProgressText: "",
      });
      updateVizVisibility();
      if (context.state.isRunning || context.state.isPaused) {
        context.engine.syncToPlaybackPosition();
      }
      updatePlayButton();
      if (
        resumeAfterPrepare &&
        context.state.playMode === "jukebox" &&
        context.state.jukeboxAudioMode === "swing" &&
        !context.state.isRunning
      ) {
        startJukeboxPlayback(context, false);
      }
    })
    .catch((err: unknown) => {
      if (context.state.swingRenderToken !== renderToken) {
        return;
      }
      console.warn(`Swing render failed: ${String(err)}`);
      context.state.swingPreparing = false;
      context.state.jukeboxAudioMode = "off";
      context.player.setJukeboxAudioMode("off");
      useAppStore.setState({
        analysisStatusText: "Swing mode failed.",
        analysisSpinning: false,
        analysisProgressText: "",
      });
      updateVizVisibility();
      syncTuningParamsState(context);
      writeTuningParamsToUrl(context.state.tuningParams, true);
      updatePlayButton();
      showToast(context, "Swing mode failed. Using Normal mode.", {
        icon: "error",
        tone: "error",
      });
    });
}

export function maybePrepareSwingMode(context: AppContext) {
  if (context.state.jukeboxAudioMode !== "swing") {
    return;
  }
  if (!canPrepareSwingMode(context)) {
    return;
  }
  prepareSwingMode(context);
}

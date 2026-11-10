import type { AppContext } from "../context";
import { useAppStore } from "../store";
import {
  resetAudioModeToOff,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "../tuning";
import { showToast } from "../ui";
import { renderInstrumentalBuffer } from "@forever-jukebox/shared/audio/instrumentalRenderer";
import { updatePlayButton, updateVizVisibility } from "./status-ui";
import { pausePlayback, startJukeboxPlayback } from "./transport";
import i18n from "../i18n";

function getCurrentTrackId(): string | null {
  const { lastTrackId, lastJobId } = useAppStore.getState();
  return lastTrackId ?? lastJobId ?? null;
}

// Requires analysis as well as audio so a track load prepares only once.
export function canPrepareInstrumentalMode(context: AppContext) {
  const { playMode, audioLoaded, analysisLoaded } = useAppStore.getState();
  return (
    playMode === "jukebox" &&
    audioLoaded &&
    analysisLoaded &&
    context.player.getSourceBuffer() !== null
  );
}

export function prepareInstrumentalMode(context: AppContext) {
  if (useAppStore.getState().jukeboxAudioMode !== "instrumental") {
    return;
  }
  const sourceBuffer = context.player.getSourceBuffer();
  if (!sourceBuffer) {
    return;
  }
  const resumeAfterPrepare = useAppStore.getState().isRunning;
  if (useAppStore.getState().isRunning) {
    pausePlayback(context);
  }
  // The preparing flag and render token are shared with swing; the two modes
  // are mutually exclusive.
  const renderToken = useAppStore.getState().audioModeRenderToken + 1;
  useAppStore.setState({ audioModeRenderToken: renderToken });
  useAppStore.setState({ audioModePreparing: true });
  useAppStore.setState({
    loadingStep: { task: "instrumental", activeId: "model", progress: null },
  });
  updateVizVisibility();
  updatePlayButton();

  const isStale = () =>
    useAppStore.getState().audioModeRenderToken !== renderToken ||
    useAppStore.getState().jukeboxAudioMode !== "instrumental";

  renderInstrumentalBuffer(
    sourceBuffer,
    getCurrentTrackId(),
    ({ phase, progress }) => {
      if (isStale()) {
        return;
      }
      const activeId = phase === "download" ? "model" : "separate";
      useAppStore.setState({ loadingStep: { task: "instrumental", activeId, progress } });
    },
  )
    .then((buffer) => {
      if (isStale()) {
        return;
      }
      useAppStore.setState({ audioModePreparing: false });
      context.player.setRenderedJukeboxAudioBuffer("instrumental", buffer);
      context.player.setJukeboxAudioMode("instrumental");
      updateVizVisibility();
      if (useAppStore.getState().isRunning || useAppStore.getState().isPaused) {
        context.engine.syncToPlaybackPosition();
      }
      updatePlayButton();
      if (
        resumeAfterPrepare &&
        useAppStore.getState().isPaused &&
        useAppStore.getState().playMode === "jukebox" &&
        !useAppStore.getState().isRunning
      ) {
        startJukeboxPlayback(context, false);
      }
    })
    .catch((err: unknown) => {
      if (isStale()) {
        return;
      }
      console.warn(`Instrumental render failed: ${String(err)}`);
      useAppStore.setState({ audioModePreparing: false });
      resetAudioModeToOff(context.player);
      useAppStore.setState({
        analysisStatusText: () => i18n.t("playback.instrumentalFailed"),
        loadingStep: null,
      });
      updateVizVisibility();
      syncTuningParamsState(context);
      writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
      updatePlayButton();
      showToast(i18n.t("playback.instrumentalFailed"), {
        icon: "error",
        tone: "error",
      });
    });
}

export function maybePrepareInstrumentalMode(context: AppContext) {
  if (useAppStore.getState().jukeboxAudioMode !== "instrumental") {
    return;
  }
  if (!canPrepareInstrumentalMode(context)) {
    return;
  }
  prepareInstrumentalMode(context);
}

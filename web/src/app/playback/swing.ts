import type { AppContext } from "../context";
import { getOrCreateSwingBuffer } from "@forever-jukebox/engine/audio/swingBufferCache";
import { renderSwingBuffer } from "@forever-jukebox/engine/audio/swingRenderer";
import { useAppStore } from "../store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "../tuning";
import { showToast } from "../ui";
import { updatePlayButton, updateVizVisibility } from "./status-ui";
import { pausePlayback, startJukeboxPlayback } from "./transport";
import i18n from "../i18n";

function getCurrentSwingSourceIdentity(): string | null {
  const { lastTrackId, lastJobId } = useAppStore.getState();
  return lastTrackId ?? lastJobId ?? null;
}

export function canPrepareSwingMode(context: AppContext) {
  const { playMode, audioLoaded, analysisLoaded, vizData } =
    useAppStore.getState();
  return (
    playMode === "jukebox" &&
    audioLoaded &&
    analysisLoaded &&
    context.player.getSourceBuffer() !== null &&
    vizData !== null &&
    vizData.beats.length > 0
  );
}

export function prepareSwingMode(context: AppContext) {
  if (useAppStore.getState().jukeboxAudioMode !== "swing") {
    return;
  }
  const sourceBuffer = context.player.getSourceBuffer();
  const beats = useAppStore.getState().vizData?.beats;
  if (!sourceBuffer || !beats || beats.length === 0) {
    return;
  }
  const resumeAfterPrepare = useAppStore.getState().isRunning;
  if (useAppStore.getState().isRunning) {
    pausePlayback(context);
  }
  const renderToken = useAppStore.getState().swingRenderToken + 1;
  useAppStore.setState({ swingRenderToken: renderToken });
  useAppStore.setState({ swingPreparing: true });
  useAppStore.setState({
    analysisStatusText: () => i18n.t("playback.swingAdding"),
    analysisSpinning: true,
    analysisProgressText: "0%",
  });
  updateVizVisibility();
  updatePlayButton();

  const sourceIdentity = getCurrentSwingSourceIdentity();
  getOrCreateSwingBuffer(sourceBuffer, sourceIdentity, () =>
    renderSwingBuffer(sourceBuffer, beats, {
      onProgress: (progress) => {
        if (
          useAppStore.getState().swingRenderToken !== renderToken ||
          useAppStore.getState().jukeboxAudioMode !== "swing"
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
        useAppStore.getState().swingRenderToken !== renderToken ||
        useAppStore.getState().jukeboxAudioMode !== "swing"
      ) {
        return;
      }
      useAppStore.setState({ swingPreparing: false });
      context.player.setRenderedJukeboxAudioBuffer("swing", buffer);
      context.player.setJukeboxAudioMode("swing");
      useAppStore.setState({
        analysisStatusText: () => i18n.t("playback.swingReady"),
        analysisSpinning: false,
        analysisProgressText: "",
      });
      updateVizVisibility();
      if (useAppStore.getState().isRunning || useAppStore.getState().isPaused) {
        context.engine.syncToPlaybackPosition();
      }
      updatePlayButton();
      if (
        resumeAfterPrepare &&
        useAppStore.getState().isPaused &&
        useAppStore.getState().playMode === "jukebox" &&
        useAppStore.getState().jukeboxAudioMode === "swing" &&
        !useAppStore.getState().isRunning
      ) {
        startJukeboxPlayback(context, false);
      }
    })
    .catch((err: unknown) => {
      if (useAppStore.getState().swingRenderToken !== renderToken) {
        return;
      }
      console.warn(`Swing render failed: ${String(err)}`);
      useAppStore.setState({ swingPreparing: false });
      useAppStore.setState({ jukeboxAudioMode: "off" });
      context.player.setJukeboxAudioMode("off");
      useAppStore.setState({
        analysisStatusText: () => i18n.t("playback.swingFailedStatus"),
        analysisSpinning: false,
        analysisProgressText: "",
      });
      updateVizVisibility();
      syncTuningParamsState(context);
      writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
      updatePlayButton();
      showToast(i18n.t("playback.swingFailed"), {
        icon: "error",
        tone: "error",
      });
    });
}

export function maybePrepareSwingMode(context: AppContext) {
  if (useAppStore.getState().jukeboxAudioMode !== "swing") {
    return;
  }
  if (!canPrepareSwingMode(context)) {
    return;
  }
  prepareSwingMode(context);
}

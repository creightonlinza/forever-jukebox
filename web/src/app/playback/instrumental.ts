import type { AppContext } from "../context";
import { useAppStore } from "../store";
import {
  resetAudioModeToOff,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "../tuning";
import { showToast } from "../ui";
import {
  renderInstrumentalBuffer,
  type InstrumentalProgress,
} from "@forever-jukebox/shared/audio/instrumentalRenderer";
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

function phaseStatusText(phase: InstrumentalProgress["phase"]) {
  return phase === "download"
    ? () => i18n.t("playback.instrumentalDownloading")
    : () => i18n.t("playback.instrumentalSeparating");
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
    analysisStatusText: () => i18n.t("playback.preparingInstrumental"),
    analysisSpinning: true,
    analysisProgressText: "",
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
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      useAppStore.setState({
        analysisStatusText: phaseStatusText(phase),
        analysisProgressText: `${percent}%`,
      });
    },
  )
    .then((buffer) => {
      if (isStale()) {
        return;
      }
      useAppStore.setState({ audioModePreparing: false });
      context.player.setRenderedJukeboxAudioBuffer("instrumental", buffer);
      context.player.setJukeboxAudioMode("instrumental");
      useAppStore.setState({
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
        analysisSpinning: false,
        analysisProgressText: "",
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

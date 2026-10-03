import { renderWubMachineBuffer } from "@forever-jukebox/shared/wubmachine/wubMachineRender";
import type { AppContext } from "../context";
import i18n from "../i18n";
import { useAppStore } from "../store";
import { showToast } from "../ui";
import { updatePlayButton, updateVizVisibility } from "./status-ui";

// Raw analysis of the loaded track, kept for rendering its remix on demand.
let analysisResult: unknown = null;
let activeRender: AbortController | null = null;

export function setWubMachineAnalysis(result: unknown) {
  analysisResult = result;
}

// Stops an in-flight render; the remix of the loaded track, if any, is kept.
export function cancelWubMachineRender() {
  if (!activeRender) {
    return;
  }
  activeRender.abort();
  activeRender = null;
  useAppStore.setState({ audioModePreparing: false });
}

export function resetWubMachine(context: AppContext) {
  cancelWubMachineRender();
  analysisResult = null;
  context.wubmachine?.setRemix(null, null);
  useAppStore.setState({ wubMachineSeconds: 0, wubMachineDurationSec: 0 });
}

// Renders the loaded track's remix once, while Wub Machine mode is selected.
export function maybePrepareWubMachine(context: AppContext) {
  const { player, wubmachine } = context;
  const { playMode, audioLoaded, analysisLoaded } = useAppStore.getState();
  if (playMode !== "wubmachine") {
    return;
  }
  const sourceBuffer = player.getSourceBuffer();
  if (
    !audioLoaded ||
    !analysisLoaded ||
    !analysisResult ||
    !sourceBuffer ||
    !wubmachine ||
    wubmachine.isReady() ||
    activeRender
  ) {
    return;
  }
  const render = new AbortController();
  activeRender = render;
  useAppStore.setState({
    audioModePreparing: true,
    analysisStatusText: () => i18n.t("playback.preparingWubMachineEllipsis"),
    analysisSpinning: true,
    analysisProgressText: "0%",
  });
  updateVizVisibility();
  updatePlayButton();

  const audioContext = player.getContext();
  const finish = (statusKey: "wubMachineReady" | "wubMachineFailedStatus") => {
    activeRender = null;
    useAppStore.setState({
      audioModePreparing: false,
      analysisStatusText: () => i18n.t(`playback.${statusKey}`),
      analysisSpinning: false,
      analysisProgressText: "",
    });
    updateVizVisibility();
    updatePlayButton();
  };
  renderWubMachineBuffer(sourceBuffer, audioContext, analysisResult, {
    signal: render.signal,
    trackId:
      useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId,
    onProgress: (progress) => {
      if (activeRender === render) {
        useAppStore.setState({
          analysisProgressText: `${Math.round(progress * 100)}%`,
        });
      }
    },
  })
    .then(({ buffer, parts }) => {
      if (activeRender !== render) {
        return;
      }
      wubmachine.setRemix(buffer, audioContext, parts);
      useAppStore.setState({
        wubMachineSeconds: 0,
        wubMachineDurationSec: buffer.duration,
      });
      finish("wubMachineReady");
    })
    .catch((err: unknown) => {
      if (activeRender !== render) {
        return;
      }
      console.warn(`Wub Machine render failed: ${String(err)}`);
      finish("wubMachineFailedStatus");
      showToast(i18n.t("playback.wubMachineFailed"), {
        icon: "error",
        tone: "error",
      });
    });
}

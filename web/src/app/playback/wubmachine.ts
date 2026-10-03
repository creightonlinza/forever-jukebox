import { parseAnalysis } from "@forever-jukebox/shared";
import { RubberBandWorkerAdapter } from "@forever-jukebox/shared/audio/rubberBandAdapter";
import { renderDubstepRemix } from "@forever-jukebox/shared/wubmachine/dubstepRenderer";
import { dubstepSampleUrl } from "@forever-jukebox/shared/wubmachine/dubstepSamples";
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

function channelsOf(buffer: AudioBuffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
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
  const adapter = new RubberBandWorkerAdapter();
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
  // The source and the decoded samples share the context's sample rate.
  renderDubstepRemix(
    channelsOf(sourceBuffer),
    sourceBuffer.sampleRate,
    parseAnalysis(analysisResult),
    {
      adapter,
      signal: render.signal,
      trackId:
        useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId,
      loadSample: async (name) => {
        const response = await fetch(dubstepSampleUrl(name));
        if (!response.ok) {
          throw new Error(`Sample download failed (${response.status})`);
        }
        return channelsOf(
          await audioContext.decodeAudioData(await response.arrayBuffer()),
        );
      },
      onProgress: (progress) => {
        if (activeRender === render) {
          useAppStore.setState({
            analysisProgressText: `${Math.round(progress * 100)}%`,
          });
        }
      },
    },
  )
    .then(({ channels, sampleRate, parts }) => {
      if (activeRender !== render) {
        return;
      }
      const buffer = new AudioBuffer({
        length: channels[0].length,
        numberOfChannels: 2,
        sampleRate,
      });
      buffer.copyToChannel(channels[0] as Float32Array<ArrayBuffer>, 0);
      buffer.copyToChannel(channels[1] as Float32Array<ArrayBuffer>, 1);
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
    })
    .finally(() => {
      adapter.dispose();
    });
}

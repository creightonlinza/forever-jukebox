import { parseAnalysis } from "../engine/analysis";
import { markStoredCopy } from "../audio/renderedTrackCache";
import { RubberBandWorkerAdapter } from "../audio/rubberBandAdapter";
import type { TimeStretchAdapter } from "../audio/timeStretch";
import {
  renderDubstepRemix,
  type DubstepRenderedPart,
  type RenderDubstepOptions,
} from "./dubstepRenderer";
import { dubstepSampleUrl } from "./dubstepSamples";

// The house arrangement; each option is described on DubstepPlanOptions.
export const WUB_MACHINE_ARRANGEMENT = {
  contiguous: true,
  beatGrid: true,
  sectionBudget: true,
  skipQuiet: true,
  contrast: true,
  fills: true,
} satisfies Partial<RenderDubstepOptions>;

export type WubMachineRender = {
  buffer: AudioBuffer;
  parts: DubstepRenderedPart[];
};

export type RenderWubMachineOptions = {
  // Keys the stored render so a track is only remixed once; omitted skips storage.
  trackId?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  // Defaults to a Rubber Band worker owned for the duration of the render.
  adapter?: TimeStretchAdapter;
};

function channelsOf(buffer: AudioBuffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
}

async function fetchSample(
  context: BaseAudioContext,
  name: string,
  signal: AbortSignal | undefined,
) {
  const response = await fetch(dubstepSampleUrl(name), { signal });
  if (!response.ok) {
    throw new Error(`Sample download failed (${response.status}): ${name}`);
  }
  return channelsOf(await context.decodeAudioData(await response.arrayBuffer()));
}

// Renders the track's remix as an AudioBuffer on `context`, whose sample rate
// the source buffer and the decoded samples share.
export async function renderWubMachineBuffer(
  sourceBuffer: AudioBuffer,
  context: BaseAudioContext,
  analysis: unknown,
  options: RenderWubMachineOptions = {},
): Promise<WubMachineRender> {
  if (sourceBuffer.length === 0 || sourceBuffer.numberOfChannels === 0) {
    throw new Error("Wub Machine needs decoded audio to remix.");
  }
  if (sourceBuffer.sampleRate !== context.sampleRate) {
    throw new Error("Wub Machine source must match the context sample rate.");
  }
  const ownsAdapter = !options.adapter;
  const adapter = options.adapter ?? new RubberBandWorkerAdapter();
  try {
    const { channels, sampleRate, parts, stored } = await renderDubstepRemix(
      channelsOf(sourceBuffer),
      sourceBuffer.sampleRate,
      parseAnalysis(analysis),
      {
        ...WUB_MACHINE_ARRANGEMENT,
        adapter,
        signal: options.signal,
        trackId: options.trackId,
        onProgress: options.onProgress,
        loadSample: (name) => fetchSample(context, name, options.signal),
      },
    );
    const buffer = context.createBuffer(2, channels[0].length, sampleRate);
    buffer.copyToChannel(channels[0] as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(channels[1] as Float32Array<ArrayBuffer>, 1);
    if (stored) {
      markStoredCopy(buffer);
    }
    return { buffer, parts };
  } finally {
    if (ownsAdapter && adapter instanceof RubberBandWorkerAdapter) {
      adapter.dispose();
    }
  }
}

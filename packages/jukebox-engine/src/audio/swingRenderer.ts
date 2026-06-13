import { RubberBandWorkerAdapter } from "./rubberBandAdapter";
import {
  DEFAULT_SWING_AMOUNT,
  getSwingSegmentsForBeat,
  type BeatLike,
} from "./swingTiming";
import type { TimeStretchAdapter } from "./timeStretch";

export type RenderSwingOptions = {
  adapter?: TimeStretchAdapter;
  signal?: AbortSignal;
  swingAmount?: number;
  onProgress?: (progress: number) => void;
};

type FrameSegment = {
  inputStartFrame: number;
  inputFrameCount: number;
  outputStartFrame: number;
  outputFrameCount: number;
};

const JOIN_FADE_SECONDS = 0.004;
const MAX_JOIN_FADE_FRACTION = 0.25;

export async function renderSwingBuffer(
  sourceBuffer: AudioBuffer,
  beats: BeatLike[],
  options: RenderSwingOptions = {},
): Promise<AudioBuffer> {
  const sourceChannels = Array.from(
    { length: sourceBuffer.numberOfChannels },
    (_, channelIndex) =>
      new Float32Array(sourceBuffer.getChannelData(channelIndex)),
  );
  const renderedChannels = await renderSwingChannels(
    sourceChannels,
    sourceBuffer.sampleRate,
    beats,
    options,
  );
  throwIfAborted(options.signal);
  const renderedBuffer = new AudioBuffer({
    length: sourceBuffer.length,
    numberOfChannels: sourceBuffer.numberOfChannels,
    sampleRate: sourceBuffer.sampleRate,
  });
  renderedChannels.forEach((channel, channelIndex) => {
    renderedBuffer.copyToChannel(
      channel as Float32Array<ArrayBuffer>,
      channelIndex,
    );
  });
  return renderedBuffer;
}

export async function renderSwingChannels(
  sourceChannels: Float32Array[],
  sampleRate: number,
  beats: BeatLike[],
  options: RenderSwingOptions = {},
): Promise<Float32Array[]> {
  const sourceLength = sourceChannels[0]?.length ?? 0;
  const outputChannels = sourceChannels.map((channel) => new Float32Array(channel));
  if (sourceLength === 0 || sourceChannels.length === 0) {
    return outputChannels;
  }

  const shouldDisposeAdapter = !options.adapter;
  const adapter: TimeStretchAdapter =
    options.adapter ?? new RubberBandWorkerAdapter();
  const beatSegments = beats
    .map((beat) =>
      getBeatFrameSegments(
        beat,
        sampleRate,
        sourceLength,
        options.swingAmount ?? DEFAULT_SWING_AMOUNT,
      ),
    )
    .filter((segments): segments is [FrameSegment, FrameSegment] =>
      segments !== null,
    );
  const totalSegments = beatSegments.length * 2;
  let completedSegments = 0;
  options.onProgress?.(0);
  try {
    for (let beatIndex = 0; beatIndex < beatSegments.length; beatIndex += 1) {
      const segments = beatSegments[beatIndex] as [FrameSegment, FrameSegment];
      throwIfAborted(options.signal);
      for (const segment of segments) {
        throwIfAborted(options.signal);
        const inputChannels = sourceChannels.map((channel) =>
          channel.slice(
            segment.inputStartFrame,
            segment.inputStartFrame + segment.inputFrameCount,
          ),
        );
        const stretched = await adapter.stretchSegment(
          inputChannels,
          sampleRate,
          segment.outputFrameCount,
        );
        writeSegment(outputChannels, stretched, segment.outputStartFrame);
        completedSegments += 1;
        options.onProgress?.(
          totalSegments > 0 ? completedSegments / totalSegments : 1,
        );
      }
      applyJoinFade(
        outputChannels,
        segments[1].outputStartFrame,
        sampleRate,
        segments[0].outputFrameCount,
        segments[1].outputFrameCount,
      );
      applyBeatBoundaryFades(outputChannels, beatSegments, beatIndex, sampleRate);
    }
    options.onProgress?.(1);
    return outputChannels;
  } finally {
    if (shouldDisposeAdapter && adapter instanceof RubberBandWorkerAdapter) {
      adapter.dispose();
    }
  }
}

function applyBeatBoundaryFades(
  outputChannels: Float32Array[],
  beatSegments: Array<[FrameSegment, FrameSegment]>,
  beatIndex: number,
  sampleRate: number,
) {
  const segments = beatSegments[beatIndex];
  if (!segments) {
    return;
  }
  const beatStartFrame = segments[0].outputStartFrame;
  const beatFrameCount = segments[0].outputFrameCount + segments[1].outputFrameCount;
  const previousSegments = beatSegments[beatIndex - 1];
  const nextSegments = beatSegments[beatIndex + 1];
  const hasContiguousPreviousBeat =
    previousSegments !== undefined &&
    previousSegments[0].outputStartFrame +
      previousSegments[0].outputFrameCount +
      previousSegments[1].outputFrameCount ===
      beatStartFrame;
  const hasContiguousNextBeat =
    nextSegments !== undefined &&
    beatStartFrame + beatFrameCount === nextSegments[0].outputStartFrame;

  if (hasContiguousPreviousBeat) {
    applyJoinFade(
      outputChannels,
      beatStartFrame,
      sampleRate,
      previousSegments[0].outputFrameCount + previousSegments[1].outputFrameCount,
      beatFrameCount,
    );
  } else if (beatStartFrame > 0) {
    applyJoinFade(
      outputChannels,
      beatStartFrame,
      sampleRate,
      beatStartFrame,
      beatFrameCount,
    );
  }

  if (hasContiguousNextBeat) {
    return;
  }
  const remainingFrameCount =
    (outputChannels[0]?.length ?? 0) - (beatStartFrame + beatFrameCount);
  if (remainingFrameCount > 0) {
    applyJoinFade(
      outputChannels,
      beatStartFrame + beatFrameCount,
      sampleRate,
      beatFrameCount,
      remainingFrameCount,
    );
  }
}

function applyJoinFade(
  outputChannels: Float32Array[],
  boundaryFrame: number,
  sampleRate: number,
  previousFrameCount: number,
  nextFrameCount: number,
) {
  const outputLength = outputChannels[0]?.length ?? 0;
  if (
    boundaryFrame <= 0 ||
    boundaryFrame >= outputLength ||
    previousFrameCount <= 0 ||
    nextFrameCount <= 0
  ) {
    return;
  }
  const fadeFrames = Math.max(
    1,
    Math.min(
      Math.round(JOIN_FADE_SECONDS * sampleRate),
      Math.floor(previousFrameCount * MAX_JOIN_FADE_FRACTION),
      Math.floor(nextFrameCount * MAX_JOIN_FADE_FRACTION),
      boundaryFrame,
      outputLength - boundaryFrame,
    ),
  );
  if (fadeFrames <= 1) {
    return;
  }
  const startFrame = boundaryFrame - fadeFrames;
  outputChannels.forEach((outputChannel) => {
    for (let index = 0; index < fadeFrames; index += 1) {
      const t = (index + 1) / (fadeFrames + 1);
      const fadeOut = Math.cos((t * Math.PI) / 2);
      const fadeIn = Math.sin((t * Math.PI) / 2);
      const outFrame = startFrame + index;
      const inFrame = boundaryFrame + index;
      outputChannel[outFrame] = (outputChannel[outFrame] ?? 0) * fadeOut;
      outputChannel[inFrame] = (outputChannel[inFrame] ?? 0) * fadeIn;
    }
  });
}

function getBeatFrameSegments(
  beat: BeatLike,
  sampleRate: number,
  sourceLength: number,
  swingAmount: number,
): [FrameSegment, FrameSegment] | null {
  const beatStartFrame = Math.round(beat.start * sampleRate);
  const beatEndFrame = Math.round((beat.start + beat.duration) * sampleRate);
  if (
    beatStartFrame < 0 ||
    beatEndFrame > sourceLength ||
    beatEndFrame - beatStartFrame < 2
  ) {
    return null;
  }

  const beatFrameCount = beatEndFrame - beatStartFrame;
  const inputAFrameCount = Math.floor(beatFrameCount / 2);
  const inputBFrameCount = beatFrameCount - inputAFrameCount;
  const [segmentA] = getSwingSegmentsForBeat(beat, swingAmount);
  const outputAFrameCount = Math.max(
    1,
    Math.min(
      beatFrameCount - 1,
      Math.round(segmentA.outputDuration * sampleRate),
    ),
  );
  const outputBFrameCount = beatFrameCount - outputAFrameCount;

  return [
    {
      inputStartFrame: beatStartFrame,
      inputFrameCount: inputAFrameCount,
      outputStartFrame: beatStartFrame,
      outputFrameCount: outputAFrameCount,
    },
    {
      inputStartFrame: beatStartFrame + inputAFrameCount,
      inputFrameCount: inputBFrameCount,
      outputStartFrame: beatStartFrame + outputAFrameCount,
      outputFrameCount: outputBFrameCount,
    },
  ];
}

function writeSegment(
  outputChannels: Float32Array[],
  stretchedChannels: Float32Array[],
  outputStartFrame: number,
) {
  outputChannels.forEach((outputChannel, channelIndex) => {
    const stretched = stretchedChannels[channelIndex];
    if (!stretched) {
      return;
    }
    outputChannel.set(
      stretched.subarray(0, outputChannel.length - outputStartFrame),
      outputStartFrame,
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException("Swing rendering was cancelled", "AbortError");
  }
}

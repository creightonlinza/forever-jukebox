import { fitStereoToSource, type StereoChannels } from "./audioResample";
import {
  markStoredCopy,
  readRenderedTrack,
  writeRenderedTrack,
  type RenderedTrackKey,
} from "./renderedTrackCache";
import { RubberBandWorkerAdapter } from "./rubberBandAdapter";
import {
  DEFAULT_SWING_AMOUNT,
  getSwingSegmentsForBeat,
  getSwingSignature,
  type BeatLike,
} from "./swingTiming";
import type { TimeStretchAdapter } from "./timeStretch";

export type RenderSwingOptions = {
  adapter?: TimeStretchAdapter;
  signal?: AbortSignal;
  swingAmount?: number;
  // Keys the stored render so a track is only swung once; omitted skips storage.
  trackId?: string | null;
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
// Segments Rubber Band fails on are linearly resampled instead, up to these
// limits; past them the render fails rather than sounding wrong throughout.
const MAX_FALLBACK_FRACTION = 0.05;
const MAX_CONSECUTIVE_FALLBACKS = 3;

// Stored renders hold stereo, so sources with more channels are not stored.
function storedTrackKey(
  sourceBuffer: AudioBuffer,
  beats: BeatLike[],
  options: RenderSwingOptions,
): RenderedTrackKey | null {
  if (!options.trackId || sourceBuffer.numberOfChannels > 2) {
    return null;
  }
  return {
    kind: "swing",
    trackId: options.trackId,
    signature: getSwingSignature(beats, options.swingAmount),
  };
}

function toAudioBuffer(sourceBuffer: AudioBuffer, channels: Float32Array[]) {
  const renderedBuffer = new AudioBuffer({
    length: sourceBuffer.length,
    numberOfChannels: sourceBuffer.numberOfChannels,
    sampleRate: sourceBuffer.sampleRate,
  });
  channels.forEach((channel, channelIndex) => {
    renderedBuffer.copyToChannel(
      channel as Float32Array<ArrayBuffer>,
      channelIndex,
    );
  });
  return renderedBuffer;
}

// Reuses the track's stored swing render when there is one; otherwise renders
// and stores the result. Storage failures never fail a render.
export async function renderSwingBuffer(
  sourceBuffer: AudioBuffer,
  beats: BeatLike[],
  options: RenderSwingOptions = {},
): Promise<AudioBuffer> {
  const { length, numberOfChannels, sampleRate } = sourceBuffer;
  const storedKey = storedTrackKey(sourceBuffer, beats, options);
  if (storedKey) {
    const stored = await readRenderedTrack(storedKey, length, sampleRate).catch(
      () => null,
    );
    throwIfAborted(options.signal);
    if (stored) {
      options.onProgress?.(1);
      const buffer = toAudioBuffer(
        sourceBuffer,
        fitStereoToSource(length, numberOfChannels, stored[0], stored[1]),
      );
      markStoredCopy(buffer);
      return buffer;
    }
  }
  const sourceChannels = Array.from(
    { length: sourceBuffer.numberOfChannels },
    (_, channelIndex) =>
      new Float32Array(sourceBuffer.getChannelData(channelIndex)),
  );
  const { channels: renderedChannels, usedFallback } = await stretchBeats(
    sourceChannels,
    sourceBuffer.sampleRate,
    beats,
    options,
  );
  throwIfAborted(options.signal);
  // A render patched with fallback segments is played but not stored, so a
  // passing worker failure doesn't stick to the track.
  if (storedKey && !usedFallback) {
    const stereo = [
      renderedChannels[0],
      renderedChannels[1] ?? renderedChannels[0],
    ] as StereoChannels;
    writeRenderedTrack(storedKey, stereo, sampleRate).catch((err: unknown) => {
      console.warn(`Swing cache save failed: ${String(err)}`);
    });
  }
  return toAudioBuffer(sourceBuffer, renderedChannels);
}

export async function renderSwingChannels(
  sourceChannels: Float32Array[],
  sampleRate: number,
  beats: BeatLike[],
  options: RenderSwingOptions = {},
): Promise<Float32Array[]> {
  return (await stretchBeats(sourceChannels, sampleRate, beats, options))
    .channels;
}

async function stretchBeats(
  sourceChannels: Float32Array[],
  sampleRate: number,
  beats: BeatLike[],
  options: RenderSwingOptions,
): Promise<{ channels: Float32Array[]; usedFallback: boolean }> {
  const sourceLength = sourceChannels[0]?.length ?? 0;
  const outputChannels = sourceChannels.map((channel) => new Float32Array(channel));
  if (sourceLength === 0 || sourceChannels.length === 0) {
    return { channels: outputChannels, usedFallback: false };
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
  const maxFallbacks = Math.floor(totalSegments * MAX_FALLBACK_FRACTION);
  let completedSegments = 0;
  let fallbackCount = 0;
  let consecutiveFallbacks = 0;
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
        let stretched: Float32Array[];
        try {
          stretched = await adapter.stretchSegment(
            inputChannels,
            sampleRate,
            segment.outputFrameCount,
          );
          consecutiveFallbacks = 0;
        } catch (err) {
          throwIfAborted(options.signal);
          fallbackCount += 1;
          consecutiveFallbacks += 1;
          if (
            fallbackCount > maxFallbacks ||
            consecutiveFallbacks >= MAX_CONSECUTIVE_FALLBACKS
          ) {
            throw err;
          }
          console.warn(
            `Swing stretch failed at frame ${segment.inputStartFrame}; resampling instead: ${String(err)}`,
          );
          if (shouldDisposeAdapter && adapter instanceof RubberBandWorkerAdapter) {
            adapter.dispose();
          }
          stretched = resampleChannels(inputChannels, segment.outputFrameCount);
        }
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
    return { channels: outputChannels, usedFallback: fallbackCount > 0 };
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
  const previousBeatEndFrame =
    previousSegments === undefined
      ? null
      : previousSegments[0].outputStartFrame +
        previousSegments[0].outputFrameCount +
        previousSegments[1].outputFrameCount;
  const hasContiguousPreviousBeat =
    previousBeatEndFrame === beatStartFrame;
  const hasContiguousNextBeat =
    beatStartFrame + beatFrameCount === nextSegments?.[0].outputStartFrame;

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

// Linear stand-in for a segment Rubber Band could not stretch.
function resampleChannels(
  channels: Float32Array[],
  targetFrameCount: number,
): Float32Array[] {
  return channels.map((channel) => {
    const output = new Float32Array(targetFrameCount);
    if (channel.length === 0 || targetFrameCount === 0) {
      return output;
    }
    const ratio = channel.length / targetFrameCount;
    for (let index = 0; index < targetFrameCount; index += 1) {
      const position = index * ratio;
      const lower = Math.floor(position);
      const from = channel[lower] ?? 0;
      const to = channel[lower + 1] ?? from;
      output[index] = from + (to - from) * (position - lower);
    }
    return output;
  });
}

// A beat running past either end of the source is trimmed to it and swung
// over what remains.
function getBeatFrameSegments(
  beat: BeatLike,
  sampleRate: number,
  sourceLength: number,
  swingAmount: number,
): [FrameSegment, FrameSegment] | null {
  if (
    !Number.isFinite(beat.start) ||
    !Number.isFinite(beat.duration) ||
    beat.duration <= 0
  ) {
    return null;
  }
  const rawStartFrame = Math.round(beat.start * sampleRate);
  const rawEndFrame = Math.round((beat.start + beat.duration) * sampleRate);
  const beatStartFrame = Math.max(0, rawStartFrame);
  const beatEndFrame = Math.min(sourceLength, rawEndFrame);
  if (beatEndFrame - beatStartFrame < 2) {
    return null;
  }

  const beatFrameCount = beatEndFrame - beatStartFrame;
  const inputAFrameCount = Math.floor(beatFrameCount / 2);
  const inputBFrameCount = beatFrameCount - inputAFrameCount;
  const trimmed =
    beatStartFrame !== rawStartFrame || beatEndFrame !== rawEndFrame;
  const [segmentA] = getSwingSegmentsForBeat(
    trimmed
      ? {
          start: beatStartFrame / sampleRate,
          duration: beatFrameCount / sampleRate,
        }
      : beat,
    swingAmount,
  );
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

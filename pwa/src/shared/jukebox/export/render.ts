import type { PlannedJukeboxSegment } from "./plan";

export interface RenderJukeboxAudioOptions {
  sourceBuffer: AudioBuffer;
  segments: PlannedJukeboxSegment[];
  durationSeconds: number;
  gain: number;
  onProgress?: (progress: number) => void;
}

function createOfflineContext(
  channels: number,
  length: number,
  sampleRate: number,
): OfflineAudioContext {
  const safeChannels = Math.max(1, Math.min(8, channels));
  const safeLength = Math.max(1, Math.ceil(length));
  const safeRate = Math.max(8000, Math.round(sampleRate));

  try {
    return new OfflineAudioContext({
      numberOfChannels: safeChannels,
      length: safeLength,
      sampleRate: safeRate,
    });
  } catch {
    return new OfflineAudioContext(safeChannels, safeLength, safeRate);
  }
}

function createOutputBuffer(
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const safeChannels = Math.max(1, Math.min(8, channels));
  const safeLength = Math.max(1, Math.ceil(length));
  const safeRate = Math.max(8000, Math.round(sampleRate));
  try {
    return new AudioBuffer({
      numberOfChannels: safeChannels,
      length: safeLength,
      sampleRate: safeRate,
    });
  } catch {
    const context = createOfflineContext(safeChannels, safeLength, safeRate);
    return context.createBuffer(safeChannels, safeLength, safeRate);
  }
}

function clampGain(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function copySegment(
  sourceBuffer: AudioBuffer,
  outputBuffer: AudioBuffer,
  segment: PlannedJukeboxSegment,
  gain: number,
): number {
  const sampleRate = outputBuffer.sampleRate;
  const outputStart = Math.max(0, Math.round(segment.outputStart * sampleRate));
  const sourceStart = Math.max(0, Math.round(segment.sourceStart * sampleRate));
  const requestedFrames = Math.max(0, Math.round(segment.duration * sampleRate));
  const availableOutput = outputBuffer.length - outputStart;
  const availableSource = sourceBuffer.length - sourceStart;
  const frameCount = Math.max(
    0,
    Math.min(requestedFrames, availableOutput, availableSource),
  );
  if (frameCount === 0) {
    return 0;
  }

  const channels = outputBuffer.numberOfChannels;
  const sourceChannels = sourceBuffer.numberOfChannels;

  for (let channel = 0; channel < channels; channel += 1) {
    const sourceChannel = Math.min(channel, sourceChannels - 1);
    const src = sourceBuffer.getChannelData(sourceChannel);
    const dst = outputBuffer.getChannelData(channel);
    if (gain === 1) {
      const chunk = src.subarray(sourceStart, sourceStart + frameCount);
      dst.set(chunk, outputStart);
      continue;
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      dst[outputStart + frame] = src[sourceStart + frame] * gain;
    }
  }

  return frameCount;
}

export async function renderJukeboxAudio(
  options: RenderJukeboxAudioOptions,
): Promise<AudioBuffer> {
  const channels = options.sourceBuffer.numberOfChannels;
  const sampleRate = options.sourceBuffer.sampleRate;
  const frameLength = options.durationSeconds * sampleRate;
  const output = createOutputBuffer(channels, frameLength, sampleRate);
  const gain = clampGain(options.gain);

  const targetSeconds = Math.max(0.001, options.durationSeconds);
  let renderedSeconds = 0;
  let lastReportedPercent = -1;

  options.onProgress?.(0);

  for (let i = 0; i < options.segments.length; i += 1) {
    const segment = options.segments[i];
    const frames = copySegment(options.sourceBuffer, output, segment, gain);
    renderedSeconds += frames / sampleRate;

    const progress = Math.min(1, renderedSeconds / targetSeconds);
    const percent = Math.floor(progress * 100);
    if (percent > lastReportedPercent) {
      lastReportedPercent = percent;
      options.onProgress?.(progress);
    }

    if (i % 24 === 0) {
      await Promise.resolve();
    }
  }

  options.onProgress?.(1);
  return output;
}

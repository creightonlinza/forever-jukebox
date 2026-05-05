import {
  AUDIO_MODE_SETTINGS,
  PAN_STEP,
  REVERB_SECONDS,
  type JukeboxAudioMode,
} from "@/shared/jukebox/audio/audioModes";
import type { PlannedJukeboxSegment } from "./plan";

export type CowbellRenderEvent = {
  outputStart: number;
  buffer: AudioBuffer;
  gain: number;
  pan: number;
};

export interface RenderJukeboxAudioOptions {
  sourceBuffer: AudioBuffer;
  segments: PlannedJukeboxSegment[];
  durationSeconds: number;
  gain: number;
  audioMode?: JukeboxAudioMode;
  cowbellEvents?: CowbellRenderEvent[];
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
  const audioMode = options.audioMode ?? "off";
  const settings = AUDIO_MODE_SETTINGS[audioMode];
  const channels = options.sourceBuffer.numberOfChannels;
  const sampleRate = options.sourceBuffer.sampleRate;
  const rate = settings.rate;
  const sourceTimelineSeconds = options.durationSeconds * rate;
  const sourceFrameLength = sourceTimelineSeconds * sampleRate;
  const mainGain = clampGain(options.gain);
  const hasCowbell = (options.cowbellEvents?.length ?? 0) > 0;
  const needsOfflineGraph = audioMode !== "off" || hasCowbell;
  const assembled = createOutputBuffer(channels, sourceFrameLength, sampleRate);

  const targetSeconds = Math.max(0.001, sourceTimelineSeconds);
  let renderedSeconds = 0;
  let lastReportedPercent = -1;

  options.onProgress?.(0);

  for (let i = 0; i < options.segments.length; i += 1) {
    const segment = options.segments[i];
    const frames = copySegment(
      options.sourceBuffer,
      assembled,
      segment,
      needsOfflineGraph ? 1 : mainGain,
    );
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

  if (!needsOfflineGraph) {
    return assembled;
  }

  return renderModeGraph({
    assembled,
    audioMode,
    durationSeconds: options.durationSeconds,
    gain: mainGain,
    cowbellEvents: options.cowbellEvents ?? [],
  });
}

async function renderModeGraph(options: {
  assembled: AudioBuffer;
  audioMode: JukeboxAudioMode;
  durationSeconds: number;
  gain: number;
  cowbellEvents: CowbellRenderEvent[];
}): Promise<AudioBuffer> {
  const channels = options.assembled.numberOfChannels;
  const sampleRate = options.assembled.sampleRate;
  const outputFrameLength = options.durationSeconds * sampleRate;
  const context = createOfflineContext(channels, outputFrameLength, sampleRate);
  const settings = AUDIO_MODE_SETTINGS[options.audioMode];
  const source = context.createBufferSource();
  source.buffer = options.assembled;
  source.playbackRate.value = settings.rate;

  const modeOutput = connectAudioModeChain(context, source, options.audioMode);
  const mainGain = context.createGain();
  mainGain.gain.value = options.gain;
  modeOutput.connect(mainGain);
  mainGain.connect(context.destination);

  schedulePanAutomation(context, modeOutput, options.audioMode);
  scheduleCowbellEvents(context, options.cowbellEvents);

  source.start(0, 0, Math.max(0, options.durationSeconds * settings.rate));
  return await context.startRendering();
}

function connectAudioModeChain(
  context: OfflineAudioContext,
  source: AudioBufferSourceNode,
  audioMode: JukeboxAudioMode,
): AudioNode {
  const settings = AUDIO_MODE_SETTINGS[audioMode];
  const chainOutput = context.createGain();
  let lastNode: AudioNode = source;

  if (settings.highPassFrequency !== null) {
    const highPass = context.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = settings.highPassFrequency;
    lastNode.connect(highPass);
    lastNode = highPass;
  }

  if (settings.lowPassFrequency !== null) {
    const lowPass = context.createBiquadFilter();
    lowPass.type = settings.useBandPass ? "bandpass" : "lowpass";
    lowPass.frequency.value = settings.lowPassFrequency;
    lastNode.connect(lowPass);
    lastNode = lowPass;
  }

  if (settings.reverbMix > 0) {
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const reverb = context.createConvolver();
    wetGain.gain.value = settings.reverbMix;
    reverb.buffer = createReverbImpulseBuffer(context);
    lastNode.connect(dryGain);
    dryGain.connect(chainOutput);
    lastNode.connect(reverb);
    reverb.connect(wetGain);
    wetGain.connect(chainOutput);
  } else {
    lastNode.connect(chainOutput);
  }

  if (!settings.pan || typeof context.createStereoPanner !== "function") {
    return chainOutput;
  }

  const panner = context.createStereoPanner();
  chainOutput.connect(panner);
  return panner;
}

function schedulePanAutomation(
  context: OfflineAudioContext,
  modeOutput: AudioNode,
  audioMode: JukeboxAudioMode,
) {
  const settings = AUDIO_MODE_SETTINGS[audioMode];
  if (!settings.pan || !("pan" in modeOutput)) {
    return;
  }
  const panParam = (modeOutput as StereoPannerNode).pan;
  if (typeof panParam.setValueAtTime !== "function") {
    panParam.value = 0;
    return;
  }
  let angle = 0;
  const frameSeconds = 1 / 60;
  for (let time = 0; time <= context.length / context.sampleRate; time += frameSeconds) {
    panParam.setValueAtTime(Math.sin(angle), time);
    angle += PAN_STEP;
  }
}

function scheduleCowbellEvents(
  context: OfflineAudioContext,
  events: CowbellRenderEvent[],
) {
  for (const event of events) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = event.buffer;
    gain.gain.value = Math.max(0, event.gain);
    source.connect(gain);

    let output: AudioNode = gain;
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.value = event.pan;
      gain.connect(panner);
      output = panner;
    }
    output.connect(context.destination);

    const offset = Math.max(0, -event.outputStart);
    const startTime = Math.max(0, event.outputStart);
    const duration = Math.max(0, event.buffer.duration - offset);
    if (duration > 0) {
      source.start(startTime, offset, duration);
    }
  }
}

function createReverbImpulseBuffer(context: OfflineAudioContext) {
  const length = Math.floor(context.sampleRate * REVERB_SECONDS);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  let seed = 123456789;
  const random = () => {
    seed += 0x6d2b79f5;
    let x = seed;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = impulse.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
      channel[sampleIndex] =
        (random() * 2 - 1) * Math.pow(1 - sampleIndex / length, 2);
    }
  }
  return impulse;
}

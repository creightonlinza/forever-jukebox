import {
  DUBSTEP_PART_BEATS,
  DUBSTEP_TEMPO,
  planDubstepRemix,
  type DubstepAnalysis,
  type DubstepPartKind,
  type DubstepPlan,
  type SourceSlice,
} from "./dubstepArrangement";
import {
  readRenderedTrack,
  writeRenderedTrack,
  type RenderedTrackKey,
} from "../audio/renderedTrackCache";
import type { StereoChannels } from "../audio/audioResample";
import type { TimeStretchAdapter } from "../audio/timeStretch";

type Stereo = [Float32Array, Float32Array];

export type RenderDubstepOptions = {
  adapter: TimeStretchAdapter;
  // Resolves a sample path from the plan to PCM at the render sample rate.
  loadSample: (path: string) => Promise<Float32Array[]>;
  signal?: AbortSignal;
  // Keys the stored render so a track is only remixed once; omitted skips storage.
  trackId?: string | null;
  onProgress?: (progress: number) => void;
};

export type DubstepRenderedPart = {
  kind: DubstepPartKind;
  label: string;
  // Seconds into the render.
  start: number;
  duration: number;
};

export type DubstepRender = {
  channels: Stereo;
  sampleRate: number;
  plan: DubstepPlan;
  parts: DubstepRenderedPart[];
};

const SLICE_FADE_SECONDS = 0.002;

function toStereo(channels: Float32Array[]): Stereo {
  const left = channels[0] ?? new Float32Array(0);
  return [left, channels[1] ?? left];
}

// Lays the slices end to end, with a short fade at each edge to avoid clicks.
function concatSlices(
  source: Stereo,
  sampleRate: number,
  slices: SourceSlice[],
): Stereo {
  const sourceLength = source[0].length;
  const ranges = slices.map((slice) => {
    const start = Math.min(sourceLength, Math.floor(slice.start * sampleRate));
    const stop = Math.min(
      sourceLength,
      Math.floor((slice.start + slice.duration) * sampleRate),
    );
    return [start, Math.max(start, stop)] as const;
  });
  const total = ranges.reduce((sum, [start, stop]) => sum + stop - start, 0);
  const out: Stereo = [new Float32Array(total), new Float32Array(total)];
  const maxFade = Math.round(SLICE_FADE_SECONDS * sampleRate);
  let offset = 0;
  for (const [start, stop] of ranges) {
    const length = stop - start;
    const fade = Math.min(maxFade, Math.floor(length / 4));
    for (let channel = 0; channel < 2; channel += 1) {
      const target = out[channel as 0 | 1];
      target.set(source[channel as 0 | 1].subarray(start, stop), offset);
      for (let i = 0; i < fade; i += 1) {
        const gain = i / fade;
        target[offset + i] = (target[offset + i] as number) * gain;
        const tail = offset + length - 1 - i;
        target[tail] = (target[tail] as number) * gain;
      }
    }
    offset += length;
  }
  return out;
}

// Averages the samples into a bed of `length` frames.
function mixBed(samples: Stereo[], length: number): Stereo {
  const bed: Stereo = [new Float32Array(length), new Float32Array(length)];
  const gain = 1 / samples.length;
  for (const sample of samples) {
    for (let channel = 0; channel < 2; channel += 1) {
      const target = bed[channel as 0 | 1];
      const data = sample[channel as 0 | 1];
      const frames = Math.min(length, data.length);
      for (let i = 0; i < frames; i += 1) {
        target[i] = (target[i] as number) + (data[i] as number) * gain;
      }
    }
  }
  return bed;
}

// Identifies the arrangement a render was made from.
function planSignature(plan: DubstepPlan): string {
  let hash = 2166136261;
  const mix = (value: number) => {
    hash = Math.imul(hash ^ Math.round(value * 1000), 16777619) >>> 0;
  };
  mix(plan.tonic);
  mix(plan.timeRatio ?? 0);
  for (const part of plan.parts) {
    mix(part.mix);
    for (const slice of part.slices) {
      mix(slice.start);
      mix(slice.duration);
    }
  }
  return `1:${plan.parts.length}:${hash.toString(16)}`;
}

// Parts over source audio are 8 bars each; the ending takes what remains.
function layoutParts(
  plan: DubstepPlan,
  sampleRate: number,
  partFrames: number,
  totalFrames: number,
): DubstepRenderedPart[] {
  let offset = 0;
  return plan.parts.map(({ kind, label, slices }) => {
    const frames =
      slices.length > 0 ? partFrames : Math.max(0, totalFrames - offset);
    const part = {
      kind,
      label,
      start: offset / sampleRate,
      duration: frames / sampleRate,
    };
    offset += frames;
    return part;
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException("Dubstep rendering was cancelled", "AbortError");
  }
}

export async function renderDubstepRemix(
  sourceChannels: Float32Array[],
  sampleRate: number,
  analysis: DubstepAnalysis,
  options: RenderDubstepOptions,
): Promise<DubstepRender> {
  const plan = planDubstepRemix(analysis);
  // Parts over source audio are exactly 8 bars, whatever the decoded samples'
  // lengths; the ending keeps its sample's length.
  const partFrames = Math.round(
    (sampleRate * DUBSTEP_PART_BEATS * 60) / DUBSTEP_TEMPO,
  );
  const storedKey: RenderedTrackKey | null = options.trackId
    ? {
        kind: "dubstep",
        trackId: options.trackId,
        signature: planSignature(plan),
      }
    : null;
  if (storedKey) {
    const stored = await readRenderedTrack(storedKey, null, sampleRate).catch(
      () => null,
    );
    throwIfAborted(options.signal);
    if (stored) {
      options.onProgress?.(1);
      return {
        channels: stored,
        sampleRate,
        plan,
        parts: layoutParts(plan, sampleRate, partFrames, stored[0].length),
      };
    }
  }
  const source = toStereo(sourceChannels);
  const samples = new Map<string, Promise<Stereo>>();
  const loadSample = (path: string) => {
    let sample = samples.get(path);
    if (!sample) {
      sample = options.loadSample(path).then(toStereo);
      samples.set(path, sample);
    }
    return sample;
  };
  const stretched = new Map<SourceSlice[], Stereo>();
  const stretchSlices = async (slices: SourceSlice[]) => {
    const cached = stretched.get(slices);
    if (cached) {
      return cached;
    }
    const pieces = concatSlices(source, sampleRate, slices);
    const targetFrameCount =
      plan.timeRatio === null
        ? partFrames
        : Math.round(pieces[0].length * plan.timeRatio);
    const result = toStereo(
      await options.adapter.stretchSegment(pieces, sampleRate, targetFrameCount),
    );
    stretched.set(slices, result);
    return result;
  };

  const rendered: Stereo[] = [];
  options.onProgress?.(0);
  for (const part of plan.parts) {
    throwIfAborted(options.signal);
    const samples = await Promise.all(part.samples.map(loadSample));
    const bed = mixBed(
      samples,
      part.slices.length > 0
        ? partFrames
        : Math.max(...samples.map((sample) => sample[0].length)),
    );
    if (part.slices.length > 0) {
      const under = await stretchSlices(part.slices);
      const overlap = Math.min(bed[0].length, under[0].length);
      for (let channel = 0; channel < 2; channel += 1) {
        const target = bed[channel as 0 | 1];
        const data = under[channel as 0 | 1];
        for (let i = 0; i < target.length; i += 1) {
          target[i] =
            (target[i] as number) * part.mix +
            (i < overlap ? (data[i] as number) * (1 - part.mix) : 0);
        }
      }
    }
    rendered.push(bed);
    options.onProgress?.(rendered.length / plan.parts.length);
  }
  throwIfAborted(options.signal);

  const total = rendered.reduce((sum, part) => sum + part[0].length, 0);
  const channels: Stereo = [new Float32Array(total), new Float32Array(total)];
  let offset = 0;
  for (const part of rendered) {
    channels[0].set(part[0], offset);
    channels[1].set(part[1], offset);
    offset += part[0].length;
  }
  if (storedKey) {
    writeRenderedTrack(
      storedKey,
      channels as StereoChannels,
      sampleRate,
    ).catch((err: unknown) => {
      console.warn(`Dubstep cache save failed: ${String(err)}`);
    });
  }
  return {
    channels,
    sampleRate,
    plan,
    parts: layoutParts(plan, sampleRate, partFrames, total),
  };
}

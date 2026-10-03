import {
  DUBSTEP_PART_BEATS,
  DUBSTEP_TEMPO,
  planDubstepRemix,
  type DubstepAnalysis,
  type DubstepPartKind,
  type DubstepPlan,
  type DubstepPlanOptions,
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

export type RenderDubstepOptions = DubstepPlanOptions & {
  adapter: TimeStretchAdapter;
  // Stretch each slice onto the 140 BPM grid instead of each part as a whole.
  beatGrid?: boolean;
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
  // True when decoded from the stored (lossy) copy instead of rendered.
  stored: boolean;
};

const SLICE_FADE_SECONDS = 0.002;

function toStereo(channels: Float32Array[]): Stereo {
  const left = channels[0] ?? new Float32Array(0);
  return [left, channels[1] ?? left];
}

function sliceFrames(slice: SourceSlice, sampleRate: number, length: number) {
  const start = Math.min(length, Math.floor(slice.start * sampleRate));
  const stop = Math.min(
    length,
    Math.floor((slice.start + slice.duration) * sampleRate),
  );
  return [start, Math.max(start, stop)] as const;
}

// Short fades at both ends of `[offset, offset + length)` to avoid clicks.
function fadeEdges(
  channels: Stereo,
  sampleRate: number,
  offset: number,
  length: number,
) {
  const fade = Math.min(
    Math.round(SLICE_FADE_SECONDS * sampleRate),
    Math.floor(length / 4),
  );
  for (const channel of channels) {
    for (let i = 0; i < fade; i += 1) {
      const gain = i / fade;
      channel[offset + i] = (channel[offset + i] as number) * gain;
      const tail = offset + length - 1 - i;
      channel[tail] = (channel[tail] as number) * gain;
    }
  }
}

// Lays the slices end to end, unstretched.
function concatSlices(
  source: Stereo,
  sampleRate: number,
  slices: SourceSlice[],
): Stereo {
  const ranges = slices.map((slice) =>
    sliceFrames(slice, sampleRate, source[0].length),
  );
  const total = ranges.reduce((sum, [start, stop]) => sum + stop - start, 0);
  const out: Stereo = [new Float32Array(total), new Float32Array(total)];
  let offset = 0;
  for (const [start, stop] of ranges) {
    out[0].set(source[0].subarray(start, stop), offset);
    out[1].set(source[1].subarray(start, stop), offset);
    fadeEdges(out, sampleRate, offset, stop - start);
    offset += stop - start;
  }
  return out;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException("Dubstep rendering was cancelled", "AbortError");
  }
}

// Pads with silence or trims so the piece is exactly `frames` long.
function fitLength(channels: Stereo, frames: number): Stereo {
  return channels.map((channel) => {
    if (channel.length === frames) {
      return channel;
    }
    const fitted = new Float32Array(frames);
    fitted.set(channel.subarray(0, frames));
    return fitted;
  }) as Stereo;
}

// Stretches `[start, stop)` of the source to `frames`; silence when empty.
async function stretchRange(
  source: Stereo,
  sampleRate: number,
  start: number,
  stop: number,
  frames: number,
  adapter: TimeStretchAdapter,
): Promise<Stereo> {
  if (stop <= start || frames <= 0) {
    return [new Float32Array(frames), new Float32Array(frames)];
  }
  const stretched = await adapter.stretchSegment(
    [source[0].slice(start, stop), source[1].slice(start, stop)],
    sampleRate,
    frames,
  );
  return fitLength(toStereo(stretched), frames);
}

// Stretches every slice to its own share of the 140 BPM grid, so each beat
// lands where the samples expect it. Identical slices are stretched once.
async function stretchToGrid(
  source: Stereo,
  sampleRate: number,
  slices: SourceSlice[],
  adapter: TimeStretchAdapter,
  signal: AbortSignal | undefined,
  onSlice: () => void,
): Promise<Stereo> {
  const beatFrames = (sampleRate * 60) / DUBSTEP_TEMPO;
  const pieces = new Map<string, Promise<Stereo>>();
  const stretchSlice = (slice: SourceSlice) => {
    const key = `${slice.start}:${slice.duration}:${slice.beats}`;
    let piece = pieces.get(key);
    if (!piece) {
      const [start, stop] = sliceFrames(slice, sampleRate, source[0].length);
      piece = stretchRange(
        source,
        sampleRate,
        start,
        stop,
        Math.round(slice.beats * beatFrames),
        adapter,
      );
      pieces.set(key, piece);
    }
    return piece;
  };
  const stretched: Stereo[] = [];
  for (const slice of slices) {
    throwIfAborted(signal);
    stretched.push(await stretchSlice(slice));
    onSlice();
  }
  const total = stretched.reduce((sum, piece) => sum + piece[0].length, 0);
  const out: Stereo = [new Float32Array(total), new Float32Array(total)];
  let offset = 0;
  for (const piece of stretched) {
    out[0].set(piece[0], offset);
    out[1].set(piece[1], offset);
    fadeEdges(out, sampleRate, offset, piece[0].length);
    offset += piece[0].length;
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

export async function renderDubstepRemix(
  sourceChannels: Float32Array[],
  sampleRate: number,
  analysis: DubstepAnalysis,
  options: RenderDubstepOptions,
): Promise<DubstepRender> {
  const plan = planDubstepRemix(analysis, options);
  const beatGrid = options.beatGrid ?? false;
  // Parts over source audio are exactly 8 bars, whatever the decoded samples'
  // lengths; the ending keeps its sample's length.
  const partFrames = Math.round(
    (sampleRate * DUBSTEP_PART_BEATS * 60) / DUBSTEP_TEMPO,
  );
  const storedKey: RenderedTrackKey | null = options.trackId
    ? {
        kind: "dubstep",
        trackId: options.trackId,
        signature: `${beatGrid ? "g" : "w"}:${planSignature(plan)}`,
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
        stored: true,
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
  let partsDone = 0;
  const reportProgress = (withinPart: number) => {
    options.onProgress?.((partsDone + withinPart) / plan.parts.length);
  };
  const stretchSlices = async (slices: SourceSlice[]) => {
    const cached = stretched.get(slices);
    if (cached) {
      return cached;
    }
    let result: Stereo;
    if (beatGrid) {
      let done = 0;
      result = await stretchToGrid(
        source,
        sampleRate,
        slices,
        options.adapter,
        options.signal,
        () => {
          done += 1;
          reportProgress(done / slices.length);
        },
      );
    } else {
      const pieces = concatSlices(source, sampleRate, slices);
      const targetFrameCount =
        plan.timeRatio === null
          ? partFrames
          : Math.round(pieces[0].length * plan.timeRatio);
      result = await stretchRange(
        pieces,
        sampleRate,
        0,
        pieces[0].length,
        targetFrameCount,
        options.adapter,
      );
    }
    stretched.set(slices, result);
    return result;
  };

  const rendered: Stereo[] = [];
  reportProgress(0);
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
    partsDone += 1;
    reportProgress(0);
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
    stored: false,
  };
}

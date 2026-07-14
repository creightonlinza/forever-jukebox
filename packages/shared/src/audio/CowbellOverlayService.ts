import type { QuantumBase } from "../engine/types";

const SOUND_URLS = import.meta.glob("./cowbell/sounds/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function sortSoundEntries([left]: [string, string], [right]: [string, string]) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getSoundUrls(prefix: string) {
  return Object.entries(SOUND_URLS)
    .filter(([path]) => {
      const fileName = path.split("/").pop() ?? "";
      return fileName.startsWith(prefix);
    })
    .sort(sortSoundEntries)
    .map(([, url]) => url);
}

export const DEFAULT_COWBELL_SAMPLE_URLS = getSoundUrls("cowbell");
export const DEFAULT_WALKEN_SAMPLE_URLS = getSoundUrls("walken");
export const DEFAULT_TRILL_SAMPLE_URLS = getSoundUrls("trill");

export const BASE_COWBELL_GAIN = 0.50;
export const ACCENT_GAIN_MIN = 0.85;
export const ACCENT_GAIN_MAX = 1.15;
export const SUBDIVISION_GAIN_MIN = 0.55;
export const SUBDIVISION_GAIN_MAX = 0.80;
export const WALKEN_GAIN = 2.5;
export const TRILL_GAIN = 1.35;
export const WALKEN_EFFECT_PROBABILITY = 0.75;
export const PAN_RANGE = 0.25;
export const SUBDIVISION_BURST_PROBABILITY = 0.05;
export const SUBDIVISION_BURST_TIMINGS = [0.25, 0.5, 0.75];
export const MIN_SUBDIVISION_BEAT_SECONDS = 0.30;
const STOP_FUTURE_EPSILON_SECONDS = 0.015;

type FetchLike = (url: string) => Promise<Pick<Response, "arrayBuffer" | "ok">>;

type ScheduledCowbellSource = {
  source: AudioBufferSourceNode;
  startTime: number;
};

export type CowbellOverlayOptions = {
  sampleUrls?: string[];
  walkenSampleUrls?: string[];
  trillSampleUrls?: string[];
  fetch?: FetchLike;
  random?: () => number;
  getPlaybackRate?: () => number;
  destination?: AudioNode;
};

export class CowbellOverlayService {
  private readonly context: AudioContext;
  private readonly sampleUrls: string[];
  private readonly walkenSampleUrls: string[];
  private readonly trillSampleUrls: string[];
  private readonly fetchFn: FetchLike;
  private readonly random: () => number;
  private readonly getPlaybackRate: () => number;
  private readonly masterGain: GainNode;
  private cowbellBuffers: AudioBuffer[] = [];
  private walkenBuffers: AudioBuffer[] = [];
  private trillBuffers: AudioBuffer[] = [];
  private loadPromise: Promise<void> | null = null;
  private enabled = false;
  private disposed = false;
  private loadFailed = false;
  private scheduledSources: ScheduledCowbellSource[] = [];
  private sectionStartBeatIndices = new Set<number>();
  private volume = 1;

  constructor(context: AudioContext, options: CowbellOverlayOptions = {}) {
    this.context = context;
    this.sampleUrls = options.sampleUrls ?? DEFAULT_COWBELL_SAMPLE_URLS;
    this.walkenSampleUrls = options.walkenSampleUrls ?? DEFAULT_WALKEN_SAMPLE_URLS;
    this.trillSampleUrls = options.trillSampleUrls ?? DEFAULT_TRILL_SAMPLE_URLS;
    const fetchFn = options.fetch ?? globalThis.fetch;
    this.fetchFn = (url) => fetchFn(url);
    this.random = options.random ?? Math.random;
    this.getPlaybackRate = options.getPlaybackRate ?? (() => 1);
    this.masterGain = this.context.createGain();
    this.updateMasterGain();
    this.masterGain.connect(options.destination ?? this.context.destination);
  }

  enable() {
    if (this.disposed) {
      return;
    }
    this.enabled = true;
    void this.preload();
  }

  disable() {
    this.enabled = false;
    this.cancelScheduledHits();
  }

  isEnabled() {
    return this.enabled;
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateMasterGain();
  }

  setSectionStartBeatIndices(indices: number[]) {
    this.sectionStartBeatIndices = new Set(
      indices.filter((index) => Number.isInteger(index) && index > 0),
    );
  }

  handleBeatEnter(
    beatIndex: number,
    beat: Pick<QuantumBase, "start" | "duration">,
    nextBeat?: Pick<QuantumBase, "start">,
  ) {
    this.cancelScheduledHits();
    if (!this.enabled || this.disposed) {
      return;
    }
    if (this.cowbellBuffers.length === 0) {
      void this.preload();
      return;
    }

    const now = this.context.currentTime;
    this.scheduleHit(now, this.randomGain(ACCENT_GAIN_MIN, ACCENT_GAIN_MAX));
    const beatSeconds = this.getRealtimeBeatDuration(beat, nextBeat);
    if (
      beatSeconds >= MIN_SUBDIVISION_BEAT_SECONDS &&
      this.random() < SUBDIVISION_BURST_PROBABILITY
    ) {
      for (const timing of SUBDIVISION_BURST_TIMINGS) {
        this.scheduleHit(
          now + beatSeconds * timing,
          this.randomGain(SUBDIVISION_GAIN_MIN, SUBDIVISION_GAIN_MAX),
        );
      }
    }
    this.maybeScheduleSectionEffect(now, beatIndex);
  }

  cancelScheduledHits() {
    const now = this.context.currentTime;
    const remaining: ScheduledCowbellSource[] = [];
    for (const scheduled of this.scheduledSources) {
      if (scheduled.startTime <= now + STOP_FUTURE_EPSILON_SECONDS) {
        remaining.push(scheduled);
        continue;
      }
      try {
        scheduled.source.stop(0);
      } catch {
        // no-op
      }
      try {
        scheduled.source.disconnect();
      } catch {
        // no-op
      }
    }
    this.scheduledSources = remaining;
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disable();
    this.disposed = true;
    this.cowbellBuffers = [];
    this.walkenBuffers = [];
    this.trillBuffers = [];
    this.loadPromise = null;
    try {
      this.masterGain.disconnect();
    } catch {
      // no-op
    }
  }

  private async preload() {
    if (this.cowbellBuffers.length > 0 || this.loadFailed || this.disposed) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadSamples();
    }
    await this.loadPromise;
  }

  private async loadSamples() {
    const [cowbells, walkens, trills] = await Promise.all([
      this.loadSampleGroup(this.sampleUrls),
      this.loadSampleGroup(this.walkenSampleUrls),
      this.loadSampleGroup(this.trillSampleUrls),
    ]);
    if (this.disposed) {
      return;
    }
    this.cowbellBuffers = cowbells;
    this.walkenBuffers = walkens;
    this.trillBuffers = trills;
    this.loadFailed = this.cowbellBuffers.length === 0;
  }

  private scheduleHit(startTime: number, gainValue: number) {
    const buffer = this.chooseCowbellBuffer();
    if (!buffer) {
      return;
    }
    this.scheduleBuffer(buffer, startTime, gainValue);
  }

  private scheduleBuffer(buffer: AudioBuffer, startTime: number, gainValue: number) {
    const source = this.context.createBufferSource();
    const hitGain = this.context.createGain();
    source.buffer = buffer;
    hitGain.gain.value = gainValue;
    source.connect(hitGain);

    if (typeof this.context.createStereoPanner === "function") {
      const panner = this.context.createStereoPanner();
      panner.pan.value = this.randomPan();
      hitGain.connect(panner);
      panner.connect(this.masterGain);
      source.onended = () => {
        this.removeScheduledSource(source);
        try {
          panner.disconnect();
        } catch {
          // no-op
        }
      };
    } else {
      hitGain.connect(this.masterGain);
      source.onended = () => this.removeScheduledSource(source);
    }

    this.scheduledSources.push({ source, startTime });
    try {
      source.start(startTime);
    } catch {
      this.removeScheduledSource(source);
    }
  }

  private async loadSampleGroup(urls: string[]) {
    const loaded = await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await this.fetchFn(url);
          if (!response.ok) {
            return null;
          }
          const data = await response.arrayBuffer();
          return await this.context.decodeAudioData(data.slice(0));
        } catch (err) {
          console.warn(`Cowbell sample failed to load: ${String(err)}`);
          return null;
        }
      }),
    );
    return loaded.filter((buffer): buffer is AudioBuffer => buffer !== null);
  }

  private chooseCowbellBuffer() {
    return this.chooseBuffer(this.cowbellBuffers);
  }

  private chooseBuffer(buffers: AudioBuffer[]) {
    if (buffers.length === 0) {
      return null;
    }
    const index = Math.floor(this.random() * buffers.length);
    return buffers[Math.max(0, Math.min(buffers.length - 1, index))] ?? null;
  }

  private maybeScheduleSectionEffect(
    startTime: number,
    beatIndex: number,
  ) {
    if (!this.sectionStartBeatIndices.has(beatIndex)) {
      return;
    }
    if (this.random() < WALKEN_EFFECT_PROBABILITY) {
      const walken = this.chooseBuffer(this.walkenBuffers);
      if (walken) {
        this.scheduleBuffer(
          walken,
          startTime,
          WALKEN_GAIN,
        );
        return;
      }
    }
    const trill = this.chooseBuffer(this.trillBuffers);
    if (trill) {
      this.scheduleBuffer(trill, startTime, TRILL_GAIN);
    }
  }

  private randomGain(min: number, max: number) {
    return min + (max - min) * this.random();
  }

  private randomPan() {
    return (this.random() * 2 - 1) * PAN_RANGE;
  }

  private getRealtimeBeatDuration(
    beat: Pick<QuantumBase, "start" | "duration">,
    nextBeat?: Pick<QuantumBase, "start">,
  ) {
    const rawDuration =
      nextBeat && Number.isFinite(nextBeat.start)
        ? Math.max(0, nextBeat.start - beat.start)
        : beat.duration;
    const playbackRate = this.getPlaybackRate();
    const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    return rawDuration / safeRate;
  }

  private removeScheduledSource(source: AudioBufferSourceNode) {
    this.scheduledSources = this.scheduledSources.filter(
      (scheduled) => scheduled.source !== source,
    );
    try {
      source.disconnect();
    } catch {
      // no-op
    }
  }

  private updateMasterGain() {
    this.masterGain.gain.value = BASE_COWBELL_GAIN * this.volume;
  }
}

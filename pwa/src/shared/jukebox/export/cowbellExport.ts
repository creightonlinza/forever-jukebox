import type { AnalysisOutput } from "@/shared/analysis-schema";
import {
  ACCENT_GAIN_MAX,
  ACCENT_GAIN_MIN,
  BASE_COWBELL_GAIN,
  DEFAULT_COWBELL_SAMPLE_URLS,
  DEFAULT_TRILL_SAMPLE_URLS,
  DEFAULT_WALKEN_SAMPLE_URLS,
  MIN_SUBDIVISION_BEAT_SECONDS,
  PAN_RANGE,
  SUBDIVISION_BURST_PROBABILITY,
  SUBDIVISION_BURST_TIMINGS,
  SUBDIVISION_GAIN_MAX,
  SUBDIVISION_GAIN_MIN,
  TRILL_GAIN,
  WALKEN_EFFECT_PROBABILITY,
  WALKEN_GAIN,
} from "@/shared/jukebox/audio/CowbellOverlayService";
import { createRng } from "@/shared/jukebox/engine";
import type { PlannedJukeboxSegment } from "./plan";
import type { CowbellRenderEvent } from "./render";

export type CowbellExportSamples = {
  cowbells: AudioBuffer[];
  walkens: AudioBuffer[];
  trills: AudioBuffer[];
};

type PlanCowbellExportEventsOptions = {
  analysis: AnalysisOutput;
  segments: PlannedJukeboxSegment[];
  samples: CowbellExportSamples;
  sectionStartBeatIndices?: number[];
  volume: number;
  seed?: number;
};

export async function loadCowbellExportSamples(
  sampleRate: number,
): Promise<CowbellExportSamples> {
  const context = createDecodeContext(sampleRate);
  const [cowbells, walkens, trills] = await Promise.all([
    loadSampleGroup(context, DEFAULT_COWBELL_SAMPLE_URLS),
    loadSampleGroup(context, DEFAULT_WALKEN_SAMPLE_URLS),
    loadSampleGroup(context, DEFAULT_TRILL_SAMPLE_URLS),
  ]);
  return { cowbells, walkens, trills };
}

export function planCowbellExportEvents(
  options: PlanCowbellExportEventsOptions,
): CowbellRenderEvent[] {
  if (options.samples.cowbells.length === 0) {
    return [];
  }

  const random = createRng("seeded", options.seed);
  const sectionStarts = new Set(
    (options.sectionStartBeatIndices ?? []).filter(
      (index) => Number.isInteger(index) && index > 0,
    ),
  );
  const volume = clamp01(options.volume);
  const events: CowbellRenderEvent[] = [];

  for (const segment of options.segments) {
    const beat = options.analysis.beats[segment.beatIndex];
    if (!beat) {
      continue;
    }
    const nextBeat = options.analysis.beats[segment.beatIndex + 1];
    const beatDuration = getBeatDuration(beat, nextBeat);
    pushSampleEvent(
      events,
      segment.outputStart,
      options.samples.cowbells,
      randomGain(random, ACCENT_GAIN_MIN, ACCENT_GAIN_MAX) *
        BASE_COWBELL_GAIN *
        volume,
      random,
    );

    if (
      beatDuration >= MIN_SUBDIVISION_BEAT_SECONDS &&
      random() < SUBDIVISION_BURST_PROBABILITY
    ) {
      for (const timing of SUBDIVISION_BURST_TIMINGS) {
        pushSampleEvent(
          events,
          segment.outputStart + beatDuration * timing,
          options.samples.cowbells,
          randomGain(random, SUBDIVISION_GAIN_MIN, SUBDIVISION_GAIN_MAX) *
            BASE_COWBELL_GAIN *
            volume,
          random,
        );
      }
    }

    if (!sectionStarts.has(segment.beatIndex)) {
      continue;
    }
    if (random() < WALKEN_EFFECT_PROBABILITY && options.samples.walkens.length > 0) {
      pushSampleEvent(
        events,
        segment.outputStart,
        options.samples.walkens,
        WALKEN_GAIN * BASE_COWBELL_GAIN * volume,
        random,
      );
      continue;
    }
    pushSampleEvent(
      events,
      segment.outputStart,
      options.samples.trills,
      TRILL_GAIN * BASE_COWBELL_GAIN * volume,
      random,
    );
  }

  return events;
}

export function projectCowbellEventsIntoWindow(
  events: CowbellRenderEvent[],
  windowStart: number,
  windowDuration: number,
): CowbellRenderEvent[] {
  const windowEnd = windowStart + windowDuration;
  return events
    .filter((event) => {
      const eventEnd = event.outputStart + event.buffer.duration;
      return eventEnd > windowStart && event.outputStart < windowEnd;
    })
    .map((event) => ({
      ...event,
      outputStart: event.outputStart - windowStart,
    }));
}

function createDecodeContext(sampleRate: number): BaseAudioContext {
  const safeRate = Math.max(8000, Math.round(sampleRate));
  try {
    return new OfflineAudioContext({
      numberOfChannels: 1,
      length: 1,
      sampleRate: safeRate,
    });
  } catch {
    return new OfflineAudioContext(1, 1, safeRate);
  }
}

async function loadSampleGroup(
  context: BaseAudioContext,
  urls: string[],
): Promise<AudioBuffer[]> {
  if (typeof globalThis.fetch !== "function") {
    return [];
  }
  const loaded = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await globalThis.fetch(url);
        if (!response.ok) {
          return null;
        }
        const data = await response.arrayBuffer();
        return await context.decodeAudioData(data.slice(0));
      } catch (err) {
        console.warn(`Cowbell sample failed to load for export: ${String(err)}`);
        return null;
      }
    }),
  );
  return loaded.filter((buffer): buffer is AudioBuffer => buffer !== null);
}

function pushSampleEvent(
  events: CowbellRenderEvent[],
  outputStart: number,
  buffers: AudioBuffer[],
  gain: number,
  random: () => number,
) {
  const buffer = chooseBuffer(buffers, random);
  if (!buffer) {
    return;
  }
  events.push({
    outputStart,
    buffer,
    gain,
    pan: (random() * 2 - 1) * PAN_RANGE,
  });
}

function chooseBuffer(buffers: AudioBuffer[], random: () => number) {
  if (buffers.length === 0) {
    return null;
  }
  const index = Math.floor(random() * buffers.length);
  return buffers[Math.max(0, Math.min(buffers.length - 1, index))] ?? null;
}

function randomGain(random: () => number, min: number, max: number) {
  return min + (max - min) * random();
}

function getBeatDuration(
  beat: Pick<AnalysisOutput["beats"][number], "start" | "duration">,
  nextBeat?: Pick<AnalysisOutput["beats"][number], "start">,
) {
  if (nextBeat && Number.isFinite(nextBeat.start)) {
    return Math.max(0, nextBeat.start - beat.start);
  }
  return beat.duration;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

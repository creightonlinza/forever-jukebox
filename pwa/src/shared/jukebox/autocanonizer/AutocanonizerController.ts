// Copied from web/src/autocanonizer/AutocanonizerController.ts on 2026-02-12, reason: add equivalent autocanonizer playback to PWA.
import type { QuantumBase, Segment } from "../engine/types";
import { normalizeAnalysis } from "../engine/analysis";
import { AutocanonizerViz, type CanonizerBeat } from "./AutocanonizerViz";
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "../background/backgroundTimer";

type BeatWithSim = CanonizerBeat & {
  sim?: CanonizerBeat;
  simDistance?: number;
};

const TIMBRE_WEIGHT = 1;
const PITCH_WEIGHT = 10;
const LOUD_START_WEIGHT = 1;
const LOUD_MAX_WEIGHT = 1;
const DURATION_WEIGHT = 100;
const CONFIDENCE_WEIGHT = 1;
const VOLUME_WINDOW = 20;

class AutocanonizerPlayer {
  private context: AudioContext;
  private buffer: AudioBuffer;
  private mainGain: GainNode;
  private otherGain: GainNode;
  private masterBlend: number;
  private baseVolume = 0.5;

  private currentBeat: CanonizerBeat | null = null;
  private mainSource: AudioBufferSourceNode | null = null;
  private otherSource: AudioBufferSourceNode | null = null;
  private deltaTime = 0;
  private otherDeltaTime = 0;
  private skewDelta = 0;
  private maxSkewDelta = 0.05;

  constructor(context: AudioContext, buffer: AudioBuffer, masterBlend = 0.55) {
    this.context = context;
    this.buffer = buffer;
    this.masterBlend = masterBlend;
    this.mainGain = this.context.createGain();
    this.otherGain = this.context.createGain();
    this.mainGain.connect(this.context.destination);
    this.otherGain.connect(this.context.destination);
    this.applyGains();
  }

  setBuffer(buffer: AudioBuffer) {
    this.buffer = buffer;
  }

  setVolume(volume: number) {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    this.applyGains();
  }

  reset() {
    this.stop();
    this.currentBeat = null;
    this.deltaTime = 0;
    this.otherDeltaTime = 0;
    this.skewDelta = 0;
  }

  stop() {
    if (this.mainSource) {
      try {
        this.mainSource.stop(0);
      } catch {
        // no-op
      }
      this.mainSource.disconnect();
      this.mainSource = null;
    }
    if (this.otherSource) {
      try {
        this.otherSource.stop(0);
      } catch {
        // no-op
      }
      this.otherSource.disconnect();
      this.otherSource = null;
    }
  }

  stopMain() {
    if (!this.mainSource) {
      return;
    }
    try {
      this.mainSource.stop(0);
    } catch {
      // no-op
    }
    this.mainSource.disconnect();
    this.mainSource = null;
  }

  playBeat(beat: CanonizerBeat) {
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    if (!this.currentBeat || this.currentBeat.next !== beat) {
      if (this.mainSource) {
        this.mainSource.stop();
      }
      const duration = this.buffer.duration - beat.start;
      this.mainSource = this.playBuffer(beat.start, duration, this.mainGain);
      this.deltaTime = this.context.currentTime - beat.start;
    }

    const now = this.context.currentTime - this.deltaTime;
    const delta = now - beat.start;
    const clampedOtherGain = Math.max(0, Math.min(1, beat.otherGain));

    this.otherGain.gain.value =
      this.baseVolume * (1 - this.masterBlend) * clampedOtherGain;
    if (
      !this.currentBeat ||
      this.currentBeat.other.next !== beat.other ||
      Math.abs(this.skewDelta) > this.maxSkewDelta
    ) {
      this.skewDelta = 0;
      if (this.otherSource) {
        this.otherSource.stop();
      }
      const duration = this.buffer.duration - beat.other.start;
      this.otherSource = this.playBuffer(
        beat.other.start,
        duration,
        this.otherGain
      );
      this.otherDeltaTime = this.context.currentTime - beat.other.start;
    }
    this.skewDelta += beat.duration - beat.other.duration;
    this.currentBeat = beat;
    return beat.duration - delta;
  }

  playOtherOnly(beat: CanonizerBeat) {
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    const clampedOtherGain = Math.max(0, Math.min(1, beat.otherGain));
    this.otherGain.gain.value =
      this.baseVolume * (1 - this.masterBlend) * clampedOtherGain;
    if (!this.currentBeat || this.currentBeat.other.next !== beat) {
      if (this.otherSource) {
        this.otherSource.stop();
      }
      const duration = this.buffer.duration - beat.start;
      this.otherSource = this.playBuffer(beat.start, duration, this.otherGain);
      this.otherDeltaTime = this.context.currentTime - beat.start;
    }
    const now = this.context.currentTime - this.otherDeltaTime;
    const delta = now - beat.start;
    this.currentBeat = beat;
    return beat.duration - delta;
  }

  private playBuffer(start: number, duration: number, gain: GainNode) {
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(gain);
    source.start(0, start, Math.max(0, duration));
    return source;
  }

  private applyGains() {
    this.mainGain.gain.value = this.baseVolume * this.masterBlend;
    this.otherGain.gain.value = this.baseVolume * (1 - this.masterBlend);
  }
}

export class AutocanonizerController {
  private viz: AutocanonizerViz;
  private beats: BeatWithSim[] = [];
  private player: AutocanonizerPlayer | null = null;
  private running = false;
  private timerId: number | null = null;
  private secondaryOnly = false;
  private secondaryIndex = 0;
  private finishOutSong = false;
  private currentIndex = 0;
  private onBeat: ((index: number, beat: CanonizerBeat) => void) | null = null;
  private onEnded: (() => void) | null = null;
  private onSelect: ((index: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.viz = new AutocanonizerViz(container);
    this.viz.setOnSelect((index) => {
      this.onSelect?.(index);
      this.selectIndex(index, true);
    });
  }

  setVisible(visible: boolean) {
    this.viz.setVisible(visible);
  }

  resizeNow() {
    this.viz.resizeNow();
  }

  setOnBeat(handler: ((index: number, beat: CanonizerBeat) => void) | null) {
    this.onBeat = handler;
  }

  setOnEnded(handler: (() => void) | null) {
    this.onEnded = handler;
  }

  setOnSelect(handler: ((index: number) => void) | null) {
    this.onSelect = handler;
  }

  setFinishOutSong(enabled: boolean) {
    this.finishOutSong = enabled;
  }

  setVolume(volume: number) {
    if (this.player) {
      this.player.setVolume(volume);
    }
  }

  setAudio(buffer: AudioBuffer | null, context: AudioContext | null) {
    if (buffer && context) {
      if (!this.player) {
        this.player = new AutocanonizerPlayer(context, buffer);
      } else {
        this.player.setBuffer(buffer);
      }
    } else {
      this.player = null;
    }
  }

  setAnalysis(raw: unknown, durationOverride?: number | null) {
    const analysis = normalizeAnalysis(raw);
    const beats = analysis.beats as BeatWithSim[];
    if (!beats.length) {
      this.beats = [];
      return;
    }
    const trackDuration =
      durationOverride ??
      analysis.track?.duration ??
      beats[beats.length - 1].start + beats[beats.length - 1].duration;
    beats.forEach((beat) => {
      beat.section = getSectionIndex(beat);
    });
    calculateNearestNeighbors(beats);
    foldBySection(beats);
    assignNormalizedVolumes(beats);
    assignBeatColors(beats, analysis.segments);
    this.beats = beats;
    this.viz.setData(
      beats,
      trackDuration,
      analysis.sections.map((section) => ({
        start: section.start,
        duration: section.duration,
      }))
    );
  }

  reset() {
    this.stop();
    this.beats = [];
    this.viz.reset();
  }

  resetVisualization() {
    this.viz.reset();
  }

  destroy() {
    this.stop();
    this.beats = [];
    this.viz.destroy();
    this.player = null;
  }

  selectIndex(index: number, autoStart: boolean) {
    if (!this.beats.length) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, this.beats.length - 1));
    this.currentIndex = clamped;
    if (this.running) {
      if (this.timerId !== null) {
        backgroundClearTimeout(this.timerId);
        this.timerId = null;
      }
      this.tick();
      return;
    }
    this.viz.update(this.currentIndex);
    if (autoStart) {
      this.start();
    }
  }

  isReady() {
    return Boolean(this.player && this.beats.length);
  }

  start() {
    this.startAtIndex(0);
  }

  startAtIndex(index: number) {
    if (!this.isReady() || !this.player) {
      return;
    }
    this.stop();
    this.running = true;
    this.secondaryOnly = false;
    this.currentIndex = Math.max(0, Math.min(index, this.beats.length - 1));
    this.player.reset();
    this.tick();
  }

  stop() {
    if (!this.running) {
      if (this.player) {
        this.player.stop();
      }
      return;
    }
    this.running = false;
    this.secondaryOnly = false;
    if (this.timerId !== null) {
      backgroundClearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.player) {
      this.player.stop();
    }
  }

  private tick() {
    if (!this.running) {
      return;
    }
    if (!this.player || !this.beats.length) {
      this.running = false;
      this.onEnded?.();
      return;
    }
    if (this.currentIndex >= this.beats.length) {
      this.running = false;
      this.onEnded?.();
      return;
    }
    const beat = this.beats[this.currentIndex];
    const isFinal = this.currentIndex === this.beats.length - 1;
    const delay = this.player.playBeat(beat);
    this.viz.update(this.currentIndex);
    this.onBeat?.(this.currentIndex, beat);
    if (isFinal) {
      if (this.finishOutSong) {
        this.secondaryOnly = true;
        this.secondaryIndex = beat.other.which;
        this.player.stopMain();
        this.tickSecondary();
        return;
      }
    }
    this.currentIndex += 1;
    const nextDelayMs = Math.max(0, delay * 1000);
    this.timerId = backgroundSetTimeout(() => this.tick(), nextDelayMs);
  }

  private tickSecondary() {
    if (!this.running || !this.secondaryOnly) {
      return;
    }
    if (!this.player || !this.beats.length) {
      this.stop();
      this.onEnded?.();
      return;
    }
    if (this.secondaryIndex >= this.beats.length) {
      this.stop();
      this.onEnded?.();
      return;
    }
    const beat = this.beats[this.secondaryIndex];
    const delay = this.player.playOtherOnly(beat);
    this.viz.setOtherIndex(this.secondaryIndex);
    this.onBeat?.(this.secondaryIndex, beat);
    this.secondaryIndex += 1;
    const nextDelayMs = Math.max(0, delay * 1000);
    this.timerId = backgroundSetTimeout(() => this.tickSecondary(), nextDelayMs);
  }
}

function getSectionIndex(beat: QuantumBase) {
  let current: QuantumBase | undefined = beat;
  while (current?.parent) {
    current = current.parent;
  }
  return current?.which ?? 0;
}

function calculateNearestNeighbors(beats: BeatWithSim[]) {
  for (const beat of beats) {
    let best: BeatWithSim | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const other of beats) {
      if (beat === other) {
        continue;
      }
      const distance = compareBeats(beat, other);
      if (distance > 0 && distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    beat.sim = best ?? undefined;
    beat.simDistance = Number.isFinite(bestDistance) ? bestDistance : undefined;
  }
}

function compareBeats(a: BeatWithSim, b: BeatWithSim) {
  if (!a.overlappingSegments.length || !b.overlappingSegments.length) {
    return Number.POSITIVE_INFINITY;
  }
  let sum = 0;
  for (let i = 0; i < a.overlappingSegments.length; i += 1) {
    const seg1 = a.overlappingSegments[i];
    const seg2 = b.overlappingSegments[i];
    const distance = seg2 ? segmentDistance(seg1, seg2) : 100;
    sum += distance;
  }
  const parentDistance = a.indexInParent === b.indexInParent ? 0 : 100;
  return sum / a.overlappingSegments.length + parentDistance;
}

function segmentDistance(a: Segment, b: Segment) {
  const timbre = euclideanDistance(a.timbre, b.timbre) * TIMBRE_WEIGHT;
  const pitch = euclideanDistance(a.pitches, b.pitches) * PITCH_WEIGHT;
  const loudStart = Math.abs(a.loudness_start - b.loudness_start) * LOUD_START_WEIGHT;
  const loudMax = Math.abs(a.loudness_max - b.loudness_max) * LOUD_MAX_WEIGHT;
  const duration = Math.abs(a.duration - b.duration) * DURATION_WEIGHT;
  const confidence = Math.abs(a.confidence - b.confidence) * CONFIDENCE_WEIGHT;
  return timbre + pitch + loudStart + loudMax + duration + confidence;
}

function euclideanDistance(v1: number[], v2: number[]) {
  let sum = 0;
  const len = Math.min(v1.length, v2.length);
  for (let i = 0; i < len; i += 1) {
    const delta = v2[i] - v1[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function foldBySection(beats: BeatWithSim[]) {
  const sections = new Map<number, BeatWithSim[]>();
  for (const beat of beats) {
    const list = sections.get(beat.section) ?? [];
    list.push(beat);
    sections.set(beat.section, list);
  }
  for (const [, list] of sections) {
    if (!list.length) {
      continue;
    }
    const counter = new Map<number, number>();
    for (const beat of list) {
      if (!beat.sim) {
        continue;
      }
      const delta = beat.which - beat.sim.which;
      counter.set(delta, (counter.get(delta) ?? 0) + 1);
    }
    let bestDelta = 0;
    let bestCount = -1;
    for (const [delta, count] of counter) {
      if (count > bestCount) {
        bestCount = count;
        bestDelta = delta;
      }
    }
    for (const beat of list) {
      const otherIndex = beat.which - bestDelta;
      if (otherIndex >= 0 && otherIndex < beats.length) {
        beat.other = beats[otherIndex];
      } else {
        beat.other = beat;
      }
      beat.otherGain = 1;
    }
  }
  for (const beat of beats) {
    const prev = beat.prev as BeatWithSim | null;
    const next = beat.next as BeatWithSim | null;
    if (prev?.other && prev.other.which + 1 !== beat.other.which) {
      prev.otherGain = 0.5;
      beat.otherGain = 0.5;
    }
    if (next?.other && next.other.which - 1 !== beat.other.which) {
      next.otherGain = 0.5;
      beat.otherGain = 0.5;
    }
  }
}

function assignNormalizedVolumes(beats: BeatWithSim[]) {
  let min = 0;
  let max = -60;
  for (const beat of beats) {
    const volume = averageVolume(beat);
    beat.volume = volume;
    if (volume > max) {
      max = volume;
    }
    if (volume < min) {
      min = volume;
    }
  }
  for (const beat of beats) {
    beat.volume = interpolate(beat.volume, min, max);
  }
  calcWindowMedian(beats, VOLUME_WINDOW);
}

function averageVolume(beat: BeatWithSim) {
  if (beat.overlappingSegments.length) {
    let sum = 0;
    for (const seg of beat.overlappingSegments) {
      sum += seg.loudness_max;
    }
    return sum / beat.overlappingSegments.length;
  }
  return -60;
}

function interpolate(value: number, min: number, max: number) {
  if (min === max) {
    return min;
  }
  return (value - min) / (max - min);
}

function calcWindowMedian(beats: BeatWithSim[], windowSize: number) {
  for (const beat of beats) {
    const vals: number[] = [];
    for (let i = 0; i < windowSize; i += 1) {
      const offset = i - Math.floor(windowSize / 2);
      const idx = beat.which - offset;
      if (idx >= 0 && idx < beats.length) {
        vals.push(beats[idx].volume);
      }
    }
    vals.sort((a, b) => a - b);
    beat.median_volume = vals[Math.floor(vals.length / 2)] ?? beat.volume;
  }
}

function assignBeatColors(beats: BeatWithSim[], segments: Segment[]) {
  const min = [100, 100, 100];
  const max = [-100, -100, -100];
  for (const seg of segments) {
    for (let i = 0; i < 3; i += 1) {
      const value = seg.timbre[i + 1];
      if (value < min[i]) {
        min[i] = value;
      }
      if (value > max[i]) {
        max[i] = value;
      }
    }
  }
  for (const beat of beats) {
    const segment = beat.overlappingSegments[0];
    if (!segment) {
      beat.color = "#333333";
      continue;
    }
    const color = [];
    for (let i = 0; i < 3; i += 1) {
      const value = segment.timbre[i + 1];
      const range = max[i] - min[i];
      const norm = range === 0 ? 0.5 : (value - min[i]) / range;
      color[i] = Math.max(0, Math.min(255, Math.round(norm * 255)));
    }
    beat.color = toHex(color[1], color[2], color[0]);
  }
}

function toHex(r: number, g: number, b: number) {
  const convert = (value: number) => {
    const integer = Math.round(value);
    const str = Number(integer).toString(16);
    return str.length === 1 ? `0${str}` : str;
  };
  return `#${convert(r)}${convert(g)}${convert(b)}`;
}

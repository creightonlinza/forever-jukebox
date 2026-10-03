import type { DubstepRenderedPart } from "./dubstepRenderer";
import { WubMachineViz } from "./WubMachineViz";

const PEAK_BINS = 2000;

// Playback position for `elapsed` seconds of audio since `offset`, wrapping
// from loopEnd back to loopStart when the source loops.
export function loopedPosition(
  offset: number,
  elapsed: number,
  looping: boolean,
  loopStart: number,
  loopEnd: number,
) {
  const raw = offset + elapsed;
  if (!looping || raw < loopEnd || loopEnd <= loopStart) {
    return raw;
  }
  return loopStart + ((raw - loopStart) % (loopEnd - loopStart));
}

function computePeaks(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(PEAK_BINS);
  const binSize = Math.max(1, Math.floor(data.length / PEAK_BINS));
  for (let bin = 0; bin < PEAK_BINS; bin += 1) {
    let peak = 0;
    const stop = Math.min(data.length, (bin + 1) * binSize);
    for (let i = bin * binSize; i < stop; i += 1) {
      const value = Math.abs(data[i] as number);
      if (value > peak) {
        peak = value;
      }
    }
    peaks[bin] = peak;
  }
  return peaks;
}

// Plays a rendered Wub Machine remix start to finish. With looping on, the
// body (everything between the intro and the ending) repeats seamlessly.
export class WubMachineController {
  private readonly viz: WubMachineViz;
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private volume = 1;
  private loop = false;
  private loopStart = 0;
  private loopEnd = 0;
  private position = 0;
  private startedAt = 0;
  private rafId: number | null = null;
  private onTick: ((seconds: number) => void) | null = null;
  private onEnded: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.viz = new WubMachineViz(container);
  }

  setVisible(visible: boolean) {
    this.viz.setVisible(visible);
  }

  resizeNow() {
    this.viz.resizeNow();
  }

  setOnTick(handler: ((seconds: number) => void) | null) {
    this.onTick = handler;
  }

  setOnEnded(handler: (() => void) | null) {
    this.onEnded = handler;
  }

  // Fires with the clicked time; the caller decides whether to start playback.
  setOnSelect(handler: ((seconds: number) => void) | null) {
    this.viz.setOnSelect(handler);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) {
      this.gain.gain.value = this.volume;
    }
  }

  setLoop(loop: boolean) {
    if (this.source) {
      this.position = this.getPosition();
      this.startedAt = this.context?.currentTime ?? 0;
      this.source.loop = loop && this.position < this.loopEnd;
    }
    this.loop = loop;
    this.viz.setLoop(loop);
  }

  setRemix(
    buffer: AudioBuffer | null,
    context: AudioContext | null,
    parts: DubstepRenderedPart[] = [],
  ) {
    this.stop();
    if (context !== this.context) {
      this.gain?.disconnect();
      this.gain = null;
    }
    this.buffer = buffer;
    this.context = context;
    if (!buffer || !context) {
      this.viz.setData(new Float32Array(0), 0, [], 0, 0);
      return;
    }
    const intro = parts.find((part) => part.kind === "intro");
    const ending = parts.find((part) => part.kind === "ending");
    this.loopStart = intro ? intro.start + intro.duration : 0;
    this.loopEnd = ending ? ending.start : buffer.duration;
    this.viz.setData(
      computePeaks(buffer),
      buffer.duration,
      parts,
      this.loopStart,
      this.loopEnd,
    );
  }

  isReady() {
    return Boolean(this.buffer && this.context);
  }

  getPosition() {
    if (!this.source || !this.context) {
      return this.position;
    }
    return loopedPosition(
      this.position,
      this.context.currentTime - this.startedAt,
      this.source.loop,
      this.loopStart,
      this.loopEnd,
    );
  }

  // Starts at `from` seconds, or resumes from the paused position.
  play(from?: number) {
    const { buffer, context } = this;
    if (!buffer || !context) {
      return;
    }
    this.haltSource();
    if (context.state === "suspended") {
      context.resume().catch(() => undefined);
    }
    if (!this.gain) {
      this.gain = context.createGain();
      this.gain.connect(context.destination);
    }
    this.gain.gain.value = this.volume;
    const offset = Math.max(0, Math.min(from ?? this.position, buffer.duration));
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loopStart = this.loopStart;
    source.loopEnd = this.loopEnd;
    source.loop = this.loop && offset < this.loopEnd;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      this.source = null;
      if (this.loop) {
        this.play(this.loopStart);
        return;
      }
      this.stopTicking();
      this.position = 0;
      this.viz.update(0);
      this.onEnded?.();
    };
    this.source = source;
    this.position = offset;
    this.startedAt = context.currentTime;
    source.start(0, offset);
    this.startTicking();
  }

  pause() {
    this.position = this.getPosition();
    this.haltSource();
    this.stopTicking();
    this.viz.update(this.position);
  }

  stop() {
    this.haltSource();
    this.stopTicking();
    this.position = 0;
    this.viz.update(0);
  }

  destroy() {
    this.stop();
    this.gain?.disconnect();
    this.viz.destroy();
  }

  private haltSource() {
    const source = this.source;
    if (!source) {
      return;
    }
    this.source = null;
    try {
      source.stop(0);
    } catch {
      // no-op
    }
    source.disconnect();
  }

  private startTicking() {
    if (this.rafId !== null) {
      return;
    }
    const tick = () => {
      if (!this.source) {
        this.rafId = null;
        return;
      }
      const seconds = this.getPosition();
      this.viz.update(seconds);
      this.onTick?.(seconds);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicking() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

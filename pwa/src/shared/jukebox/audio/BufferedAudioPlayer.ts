// Copied from web/src/audio/BufferedAudioPlayer.ts on 2026-03-19, reason: keep playback behavior in sync.
export class BufferedAudioPlayer {
  private context: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private pendingSource: AudioBufferSourceNode | null = null;
  private pendingSwapAt: number | null = null;
  private pendingStartAt = 0;
  private masterGain: GainNode;
  private volume = 0.5;
  private startAt = 0;
  private offset = 0;
  private playing = false;
  private playRequestId = 0;
  private onEnded: (() => void) | null = null;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.context.destination);
  }

  async loadBuffer(buffer: AudioBuffer) {
    this.stop();
    this.buffer = buffer;
    this.offset = 0;
  }

  async decode(arrayBuffer: ArrayBuffer) {
    const buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    await this.loadBuffer(buffer);
  }

  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  getContext(): AudioContext {
    return this.context;
  }

  play() {
    if (!this.buffer || this.playing) {
      return;
    }
    const requestId = ++this.playRequestId;
    const startPlayback = () => {
      if (!this.buffer || this.playing || this.playRequestId !== requestId) {
        return;
      }
      const now = this.context.currentTime;
      this.startSourceAt(this.offset, now);
    };
    if (this.context.state === "suspended") {
      void Promise.resolve(this.context.resume())
        .then(() => {
          startPlayback();
        })
        .catch(() => {
          // no-op
        });
      return;
    }
    startPlayback();
  }

  pause() {
    this.playRequestId += 1;
    if (!this.playing) {
      return;
    }
    this.offset = this.getCurrentTime();
    this.stopSource();
    this.playing = false;
  }

  stop() {
    this.playRequestId += 1;
    this.stopSource();
    this.playing = false;
    this.offset = 0;
  }

  seek(time: number) {
    if (!this.buffer) {
      return;
    }
    const clamped = Math.max(0, Math.min(this.buffer.duration, time));
    this.offset = clamped;
    if (this.playing) {
      const now = this.context.currentTime;
      this.stopSource();
      this.startSourceAt(this.offset, now);
    }
  }

  getCurrentTime(): number {
    this.maybePromotePending();
    if (!this.buffer) {
      return 0;
    }
    if (!this.playing) {
      return this.offset;
    }
    const time = this.context.currentTime - this.startAt;
    return Math.max(0, Math.min(this.buffer.duration, time));
  }

  getAudioTime(): number {
    return this.context.currentTime;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setOnEnded(handler: (() => void) | null) {
    this.onEnded = handler;
  }

  getDuration(): number | null {
    return this.buffer ? this.buffer.duration : null;
  }

  setVolume(value: number) {
    const clamped = Math.max(0, Math.min(1, value));
    this.volume = clamped;
    this.masterGain.gain.value = clamped;
  }

  getVolume(): number {
    return this.volume;
  }

  scheduleJump(targetTime: number, audioStart: number) {
    if (!this.buffer || !this.playing) {
      return;
    }
    const startTime = audioStart === 0 ? this.context.currentTime : audioStart;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.masterGain);
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      if (this.playing) {
        this.playing = false;
        this.offset = this.buffer ? this.buffer.duration : 0;
        this.onEnded?.();
      }
    };
    const duration = this.buffer.duration - targetTime;
    source.start(startTime, targetTime, Math.max(0, duration));
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop(startTime);
      } catch {
        // no-op
      }
    }
    this.clearPendingSwap();
    this.pendingSource = source;
    this.pendingStartAt = startTime - targetTime;
    this.pendingSwapAt = startTime;
  }

  private stopSource() {
    this.clearPendingSwap();
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop(0);
      } catch {
        // no-op
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  private clearPendingSwap() {
    this.pendingSwapAt = null;
    if (!this.pendingSource) {
      return;
    }
    this.pendingSource.onended = null;
    try {
      this.pendingSource.stop(0);
    } catch {
      // no-op
    }
    this.pendingSource.disconnect();
    this.pendingSource = null;
  }

  private maybePromotePending() {
    if (!this.pendingSource || this.pendingSwapAt === null) {
      return;
    }
    if (this.context.currentTime < this.pendingSwapAt) {
      return;
    }
    const source = this.pendingSource;
    if (this.source) {
      this.source.disconnect();
    }
    this.source = source;
    this.startAt = this.pendingStartAt;
    this.pendingSource = null;
    this.pendingSwapAt = null;
  }

  private startSourceAt(offset: number, startTime: number) {
    if (!this.buffer) {
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.masterGain);
    this.source = source;
    this.startAt = startTime - offset;
    this.playing = true;
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      if (this.playing) {
        this.playing = false;
        this.offset = this.buffer ? this.buffer.duration : 0;
        this.onEnded?.();
      }
    };
    const duration = this.buffer.duration - offset;
    source.start(startTime, offset, Math.max(0, duration));
  }

  async dispose() {
    this.stop();
    this.buffer = null;
    this.onEnded = null;
    try {
      this.masterGain.disconnect();
    } catch {
      // no-op
    }
    if (this.context.state !== "closed") {
      try {
        await this.context.close();
      } catch {
        // no-op
      }
    }
  }
}

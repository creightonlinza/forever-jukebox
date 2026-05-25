import {
  AUDIO_MODE_SETTINGS,
  PAN_STEP,
  REVERB_SECONDS,
  type JukeboxAudioMode,
} from "./audioModes";

export type { JukeboxAudioMode } from "./audioModes";

const MAX_LATE_JUMP_FRAMES = 8;

export class BufferedAudioPlayer {
  private context: AudioContext;
  private originalBuffer: AudioBuffer | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private pendingSource: AudioBufferSourceNode | null = null;
  private pendingSwapAt: number | null = null;
  private pendingStartAt = 0;
  private masterGain: GainNode;
  private sourceChainInput: GainNode;
  private sourceChainOutput: GainNode;
  private stereoPanner: StereoPannerNode | null = null;
  private chainNodes: AudioNode[] = [];
  private reverbImpulseBuffer: AudioBuffer | null = null;
  private volume = 0.5;
  private startAt = 0;
  private offset = 0;
  private playing = false;
  private playRequestId = 0;
  private onEnded: (() => void) | null = null;
  private audioMode: JukeboxAudioMode = "off";
  private playbackRate = AUDIO_MODE_SETTINGS.off.rate;
  private panAngle = 0;
  private panFrameId: number | null = null;
  private renderedModeBuffers: Partial<Record<JukeboxAudioMode, AudioBuffer>> =
    {};

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.context.destination);
    this.sourceChainInput = this.context.createGain();
    this.sourceChainOutput = this.context.createGain();
    if (typeof this.context.createStereoPanner === "function") {
      this.stereoPanner = this.context.createStereoPanner();
      this.sourceChainOutput.connect(this.stereoPanner);
      this.stereoPanner.connect(this.masterGain);
    } else {
      this.sourceChainOutput.connect(this.masterGain);
    }
    this.rebuildSourceChain();
  }

  async loadBuffer(buffer: AudioBuffer) {
    this.stop();
    this.originalBuffer = buffer;
    this.buffer = buffer;
    this.renderedModeBuffers = {};
    this.offset = 0;
  }

  async decode(arrayBuffer: ArrayBuffer) {
    const buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    await this.loadBuffer(buffer);
  }

  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  getSourceBuffer(): AudioBuffer | null {
    return this.originalBuffer;
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
      if (
        !this.buffer ||
        this.playing ||
        this.playRequestId !== requestId
      ) {
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
    this.stopPanMotion();
  }

  stop() {
    this.playRequestId += 1;
    this.stopSource();
    this.playing = false;
    this.offset = 0;
    this.stopPanMotion();
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
    const elapsed = (this.context.currentTime - this.startAt) * this.playbackRate;
    return Math.max(0, Math.min(this.buffer.duration, elapsed));
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

  setJukeboxAudioMode(mode: JukeboxAudioMode) {
    if (mode === this.audioMode) {
      return;
    }
    const shouldResume = this.playing && this.buffer !== null;
    const resumeOffset = shouldResume ? this.getCurrentTime() : this.offset;
    this.audioMode = mode;
    this.playbackRate = AUDIO_MODE_SETTINGS[mode].rate;
    this.buffer = this.getActiveBuffer();
    this.rebuildSourceChain();
    this.syncPanMotion();
    if (!this.buffer) {
      return;
    }
    this.offset = Math.max(0, Math.min(this.buffer.duration, resumeOffset));
    if (!shouldResume) {
      return;
    }
    const now = this.context.currentTime;
    this.stopSource();
    this.startSourceAt(this.offset, now);
  }

  setRenderedJukeboxAudioBuffer(
    mode: Extract<JukeboxAudioMode, "swing">,
    buffer: AudioBuffer,
  ) {
    this.renderedModeBuffers[mode] = buffer;
    if (this.audioMode !== mode) {
      return;
    }
    const shouldResume = this.playing;
    const resumeOffset = shouldResume ? this.getCurrentTime() : this.offset;
    this.buffer = this.getActiveBuffer();
    if (!this.buffer) {
      return;
    }
    this.offset = Math.max(0, Math.min(this.buffer.duration, resumeOffset));
    if (!shouldResume) {
      return;
    }
    const now = this.context.currentTime;
    this.stopSource();
    this.startSourceAt(this.offset, now);
  }

  getRenderedJukeboxAudioBuffer(
    mode: Extract<JukeboxAudioMode, "swing">,
  ): AudioBuffer | null {
    return this.renderedModeBuffers[mode] ?? null;
  }

  private getActiveBuffer(): AudioBuffer | null {
    return this.renderedModeBuffers[this.audioMode] ?? this.originalBuffer;
  }

  getJukeboxAudioMode(): JukeboxAudioMode {
    return this.audioMode;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  scheduleJump(targetTime: number, sourceStartTime: number) {
    if (!this.buffer || !this.playing) {
      return false;
    }
    const currentSourceTime = this.getCurrentTime();
    const lateBy = currentSourceTime - sourceStartTime;
    const maxLateSeconds = MAX_LATE_JUMP_FRAMES / this.context.sampleRate;
    if (lateBy > maxLateSeconds) {
      return false;
    }
    this.clearPendingSwap();
    const sourceLead = Math.max(0, sourceStartTime - currentSourceTime);
    const startTime = this.context.currentTime + sourceLead / this.playbackRate;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.sourceChainInput);
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      if (this.playing) {
        this.playing = false;
        this.offset = this.buffer ? this.buffer.duration : 0;
        this.stopPanMotion();
        this.onEnded?.();
      }
    };
    const duration = this.buffer.duration - targetTime;
    try {
      source.start(startTime, targetTime, Math.max(0, duration));
    } catch {
      source.disconnect();
      return false;
    }
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop(startTime);
      } catch {
        // no-op
      }
    }
    this.pendingSource = source;
    this.pendingStartAt = startTime - targetTime / this.playbackRate;
    this.pendingSwapAt = startTime;
    return true;
  }

  cancelScheduledJump() {
    this.maybePromotePending();
    this.clearPendingSwap({ restartCurrentSource: true });
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

  private clearPendingSwap(options: { restartCurrentSource?: boolean } = {}) {
    const shouldRestartCurrentSource =
      options.restartCurrentSource === true &&
      this.playing &&
      this.buffer !== null &&
      this.source !== null &&
      this.pendingSwapAt !== null &&
      this.context.currentTime < this.pendingSwapAt;
    const restartOffset = shouldRestartCurrentSource
      ? this.getCurrentTime()
      : null;
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
    if (restartOffset !== null) {
      this.replaceCurrentSourceAt(restartOffset, this.context.currentTime);
    }
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
    source.playbackRate.value = this.playbackRate;
    source.connect(this.sourceChainInput);
    this.source = source;
    this.startAt = startTime - offset / this.playbackRate;
    this.playing = true;
    this.syncPanMotion();
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      if (this.playing) {
        this.playing = false;
        this.offset = this.buffer ? this.buffer.duration : 0;
        this.stopPanMotion();
        this.onEnded?.();
      }
    };
    const duration = this.buffer.duration - offset;
    source.start(startTime, offset, Math.max(0, duration));
  }

  private replaceCurrentSourceAt(offset: number, startTime: number) {
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
    this.startSourceAt(offset, startTime);
  }

  private rebuildSourceChain() {
    this.clearSourceChain();
    const settings = AUDIO_MODE_SETTINGS[this.audioMode];
    let lastNode: AudioNode = this.sourceChainInput;

    if (settings.highPassFrequency !== null) {
      const highPass = this.context.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = settings.highPassFrequency;
      this.chainNodes.push(highPass);
      lastNode.connect(highPass);
      lastNode = highPass;
    }

    if (settings.lowPassFrequency !== null) {
      const lowPass = this.context.createBiquadFilter();
      lowPass.type = settings.useBandPass ? "bandpass" : "lowpass";
      lowPass.frequency.value = settings.lowPassFrequency;
      this.chainNodes.push(lowPass);
      lastNode.connect(lowPass);
      lastNode = lowPass;
    }

    if (settings.reverbMix > 0) {
      const dryGain = this.context.createGain();
      const wetGain = this.context.createGain();
      const reverb = this.context.createConvolver();
      wetGain.gain.value = settings.reverbMix;
      reverb.buffer = this.getReverbImpulseBuffer();
      this.chainNodes.push(dryGain, wetGain, reverb);
      lastNode.connect(dryGain);
      dryGain.connect(this.sourceChainOutput);
      lastNode.connect(reverb);
      reverb.connect(wetGain);
      wetGain.connect(this.sourceChainOutput);
      return;
    }

    lastNode.connect(this.sourceChainOutput);
  }

  private clearSourceChain() {
    try {
      this.sourceChainInput.disconnect();
    } catch {
      // no-op
    }
    for (const node of this.chainNodes) {
      try {
        node.disconnect();
      } catch {
        // no-op
      }
    }
    this.chainNodes = [];
  }

  private syncPanMotion() {
    const settings = AUDIO_MODE_SETTINGS[this.audioMode];
    if (!settings.pan || !this.playing || !this.stereoPanner) {
      this.stopPanMotion();
      return;
    }
    if (typeof globalThis.requestAnimationFrame !== "function") {
      this.stereoPanner.pan.value = 0;
      return;
    }
    if (this.panFrameId !== null) {
      return;
    }
    const tick = () => {
      const currentSettings = AUDIO_MODE_SETTINGS[this.audioMode];
      if (!this.playing || !currentSettings.pan || !this.stereoPanner) {
        this.stopPanMotion();
        return;
      }
      this.stereoPanner.pan.value = Math.sin(this.panAngle);
      this.panAngle += PAN_STEP;
      this.panFrameId = globalThis.requestAnimationFrame(tick);
    };
    this.panFrameId = globalThis.requestAnimationFrame(tick);
  }

  private stopPanMotion() {
    if (
      this.panFrameId !== null &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(this.panFrameId);
    }
    this.panFrameId = null;
    if (this.stereoPanner) {
      this.stereoPanner.pan.value = 0;
    }
  }

  private getReverbImpulseBuffer() {
    if (this.reverbImpulseBuffer) {
      return this.reverbImpulseBuffer;
    }
    const length = Math.floor(this.context.sampleRate * REVERB_SECONDS);
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      const channel = impulse.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
        channel[sampleIndex] =
          (Math.random() * 2 - 1) * Math.pow(1 - sampleIndex / length, 2);
      }
    }
    this.reverbImpulseBuffer = impulse;
    return impulse;
  }

  async dispose() {
    this.stop();
    this.buffer = null;
    this.onEnded = null;
    this.stopPanMotion();
    this.clearSourceChain();
    try {
      this.sourceChainOutput.disconnect();
    } catch {
      // no-op
    }
    try {
      this.masterGain.disconnect();
    } catch {
      // no-op
    }
    if (this.stereoPanner) {
      try {
        this.stereoPanner.disconnect();
      } catch {
        // no-op
      }
      this.stereoPanner = null;
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

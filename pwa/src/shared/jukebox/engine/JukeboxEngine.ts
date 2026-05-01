import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph, selectExistingAnchorSource } from "./graph";
import { createRng, RandomMode } from "./random";
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "../background/backgroundTimer";
import {
  BranchState,
  getBestLastBranchNeighborIndex,
  selectNextBeatIndex,
} from "./selection";
import {
  JukeboxConfig,
  JukeboxGraphState,
  JukeboxState,
  QuantumBase,
  TrackAnalysis,
} from "./types";

const DEFAULT_CONFIG: JukeboxConfig = {
  maxBranches: 4,
  maxBranchThreshold: 80,
  currentThreshold: 0,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  minRandomBranchChance: 0.18,
  maxRandomBranchChance: 0.5,
  randomBranchChanceDelta: 0.02,
  minLongBranch: 0,
};

const TICK_INTERVAL_MS = 50;
const MIN_JUMP_SCHEDULE_LEAD_SECONDS = 0.08;

type UpdateListener = (state: JukeboxState) => void;

type PendingAdvance = {
  boundaryAudioTime: number;
  chosenIndex: number;
  shouldJump: boolean;
  targetTime: number | null;
  jumpFromIndex: number | null;
  sourceBoundaryTime: number | null;
};

export interface JukeboxEngineOptions {
  randomMode?: RandomMode;
  seed?: number;
  config?: Partial<JukeboxConfig>;
}

export interface JukeboxPlayer {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  scheduleJump: (targetTime: number, sourceStartTime: number) => void;
  cancelScheduledJump: () => void;
  getCurrentTime: () => number;
  getAudioTime: () => number;
  getPlaybackRate: () => number;
  isPlaying: () => boolean;
}

export class JukeboxEngine {
  private player: JukeboxPlayer;
  private analysis: TrackAnalysis | null = null;
  private graph: JukeboxGraphState | null = null;
  private config: JukeboxConfig;
  private beats: QuantumBase[] = [];
  private ticking = false;
  private timerId: number | null = null;
  private currentBeatIndex = -1;
  private nextAudioTime = 0;
  private beatsPlayed = 0;
  private curRandomBranchChance = 0;
  private lastJumped = false;
  private lastJumpTime: number | null = null;
  private lastJumpFromIndex: number | null = null;
  private forceBranch = false;
  private bringItHomeMode = false;
  private pendingAdvance: PendingAdvance | null = null;
  private deletedEdgeKeys = new Set<string>();
  private rng: () => number;
  private listener: UpdateListener | null = null;
  private branchState: BranchState = {
    curRandomBranchChance: 0,
    lastDestBySource: null,
  };

  constructor(player: JukeboxPlayer, options: JukeboxEngineOptions = {}) {
    this.player = player;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.rng = createRng(options.randomMode ?? "random", options.seed);
    this.branchState.curRandomBranchChance = this.config.minRandomBranchChance;
  }

  onUpdate(listener: UpdateListener) {
    this.listener = listener;
  }

  seekToBeat(index: number) {
    if (!this.analysis || this.beats.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, this.beats.length - 1));
    const beat = this.beats[clamped];
    const audioNow = this.player.getAudioTime();
    const playbackRate = this.getPlaybackRate();
    this.currentBeatIndex = clamped;
    this.nextAudioTime = audioNow + beat.duration / playbackRate;
    this.curRandomBranchChance = this.config.minRandomBranchChance;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    this.branchState.lastDestBySource = null;
    this.lastJumped = false;
    this.lastJumpTime = null;
    this.lastJumpFromIndex = null;
    this.clearPendingAdvance(true);
  }

  loadAnalysis(data: unknown) {
    this.deletedEdgeKeys.clear();
    this.analysis = normalizeAnalysis(data);
    this.config.minLongBranch = Math.floor(this.analysis.beats.length / 5);
    this.graph = buildJumpGraph(this.analysis, this.config);
    this.applyDeletedEdges();
    this.beats = this.analysis.beats;
    this.resetState();
  }

  getGraphState(): JukeboxGraphState | null {
    return this.graph;
  }

  getConfig(): JukeboxConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<JukeboxConfig>) {
    this.config = { ...this.config, ...partial };
  }

  rebuildGraph() {
    if (!this.analysis) {
      return;
    }
    this.clearPendingAdvance(true);
    this.clearEdgeDeletionFlags();
    this.config.minLongBranch = Math.floor(this.analysis.beats.length / 5);
    this.graph = buildJumpGraph(this.analysis, this.config);
    this.curRandomBranchChance = this.config.minRandomBranchChance;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    this.applyDeletedEdges();
  }

  getVisualizationData() {
    if (!this.analysis || !this.graph) {
      return null;
    }
    const edgeMap = new Map<string, (typeof this.graph.allEdges)[number]>();
    for (const beat of this.analysis.beats) {
      for (const edge of beat.neighbors) {
        if (edge.deleted) {
          continue;
        }
        const key = `${edge.src.which}-${edge.dest.which}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, edge);
        }
      }
    }
    let anchorEdgeId: number | null = null;
    const anchorSource = this.beats[this.graph.lastBranchPoint];
    if (anchorSource && anchorSource.neighbors.length > 0) {
      const bestIndex = getBestLastBranchNeighborIndex(anchorSource);
      const bestEdge = anchorSource.neighbors[bestIndex];
      if (bestEdge && !bestEdge.deleted) {
        anchorEdgeId = bestEdge.id;
      }
    }
    return {
      beats: this.beats,
      edges: Array.from(edgeMap.values()),
      lastBranchPoint: this.graph.lastBranchPoint,
      anchorEdgeId,
    };
  }

  play() {
    this.player.play();
  }

  pause() {
    this.player.pause();
  }

  startJukebox(reset = true) {
    if (!this.analysis || this.beats.length === 0) {
      throw new Error("Analysis not loaded");
    }
    if (this.ticking) {
      return;
    }
    if (reset) {
      this.resetState();
    }
    this.ticking = true;
    this.tick();
  }

  pauseJukebox() {
    if (!this.ticking) {
      this.player.pause();
      return;
    }
    this.ticking = false;
    if (this.timerId !== null) {
      backgroundClearTimeout(this.timerId);
      this.timerId = null;
    }
    this.player.pause();
  }

  syncToPlaybackPosition() {
    if (!this.analysis || this.beats.length === 0) {
      return;
    }
    const trackTime = this.player.getCurrentTime();
    const beatIndex = this.findBeatIndexByTime(trackTime);
    if (beatIndex < 0 || beatIndex >= this.beats.length) {
      return;
    }
    const beat = this.beats[beatIndex];
    const beatEnd = beat.start + beat.duration;
    const remainingInBeat = Math.max(0, beatEnd - trackTime);
    const playbackRate = this.getPlaybackRate();
    this.currentBeatIndex = beatIndex;
    this.nextAudioTime = this.player.getAudioTime() + remainingInBeat / playbackRate;
    this.lastJumped = false;
    this.lastJumpTime = null;
    this.lastJumpFromIndex = null;
    this.clearPendingAdvance(true);
  }

  stopJukebox() {
    this.ticking = false;
    if (this.timerId !== null) {
      backgroundClearTimeout(this.timerId);
      this.timerId = null;
    }
    this.player.stop();
  }

  resetStats() {
    this.resetState();
    this.emitState(false);
  }

  isRunning(): boolean {
    return this.ticking;
  }

  clearDeletedEdges() {
    this.deletedEdgeKeys.clear();
    this.clearPendingAdvance(true);
    this.clearEdgeDeletionFlags();
  }

  deleteEdge(edge: { src: QuantumBase; dest: QuantumBase; deleted: boolean }) {
    const srcIndex = edge.src.which;
    const destIndex = edge.dest.which;
    this.deletedEdgeKeys.add(this.edgeKey(srcIndex, destIndex));
    this.clearPendingAdvance(true);
    this.applyDeletedEdges();
  }

  setForceBranch(enabled: boolean) {
    this.forceBranch = this.bringItHomeMode ? false : enabled;
  }

  setBringItHomeMode(enabled: boolean) {
    this.bringItHomeMode = enabled;
    if (enabled) {
      this.forceBranch = false;
    }
  }

  private applyDeletedEdges() {
    if (!this.graph || !this.analysis || this.deletedEdgeKeys.size === 0) {
      return;
    }
    for (const edge of this.graph.allEdges) {
      if (
        this.deletedEdgeKeys.has(this.edgeKey(edge.src.which, edge.dest.which))
      ) {
        edge.deleted = true;
      }
    }
    for (const beat of this.analysis.beats) {
      for (const edge of beat.allNeighbors) {
        if (
          this.deletedEdgeKeys.has(
            this.edgeKey(edge.src.which, edge.dest.which),
          )
        ) {
          edge.deleted = true;
        }
      }
      beat.neighbors = beat.neighbors.filter((edge) => !edge.deleted);
    }
    this.ensureAnchorSourceHasNeighbors();
  }

  private ensureAnchorSourceHasNeighbors() {
    if (!this.graph || !this.analysis) {
      return;
    }
    if (this.graph.lastBranchPoint < 0) {
      return;
    }
    const refreshedAnchorSource = selectExistingAnchorSource(
      this.analysis.beats,
      this.config.minLongBranch,
    );
    this.graph.lastBranchPoint = refreshedAnchorSource ?? -1;
  }

  private clearEdgeDeletionFlags() {
    if (!this.analysis) {
      return;
    }
    if (this.graph) {
      for (const edge of this.graph.allEdges) {
        edge.deleted = false;
      }
    }
    for (const beat of this.analysis.beats) {
      for (const edge of beat.allNeighbors) {
        edge.deleted = false;
      }
      for (const edge of beat.neighbors) {
        edge.deleted = false;
      }
    }
  }

  private edgeKey(src: number, dest: number) {
    return `${src}-${dest}`;
  }

  getBeatAtTime(time: number): QuantumBase | null {
    if (!this.analysis || this.beats.length === 0) {
      return null;
    }
    const idx = this.findBeatIndexByTime(time);
    return idx >= 0 ? this.beats[idx] : null;
  }

  getSectionStartBeatIndices(): number[] {
    if (!this.analysis || this.beats.length === 0) {
      return [];
    }
    const indices = new Set<number>();
    for (const section of this.analysis.sections.slice(1)) {
      const idx = this.findBeatIndexAtOrAfterTime(section.start);
      if (idx > 0) {
        indices.add(idx);
      }
    }
    return Array.from(indices).sort((left, right) => left - right);
  }

  private resetState() {
    this.currentBeatIndex = -1;
    this.nextAudioTime = 0;
    this.beatsPlayed = 0;
    this.curRandomBranchChance = this.config.minRandomBranchChance;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    this.branchState.lastDestBySource = null;
    this.lastJumped = false;
    this.lastJumpTime = null;
    this.lastJumpFromIndex = null;
    this.clearPendingAdvance(true);
  }

  private tick() {
    if (!this.ticking || !this.analysis) {
      return;
    }
    if (!this.player.isPlaying()) {
      this.emitState(false);
      this.timerId = backgroundSetTimeout(() => this.tick(), TICK_INTERVAL_MS);
      return;
    }

    const audioTime = this.player.getAudioTime();
    if (this.currentBeatIndex < 0 && this.nextAudioTime === 0) {
      this.initializeBeatClock(audioTime);
    } else if (this.nextAudioTime === 0) {
      this.nextAudioTime = audioTime;
    }

    let guard = this.beats.length;
    this.preparePendingAdvance(this.nextAudioTime);
    while (guard > 0 && audioTime >= this.nextAudioTime) {
      this.advanceBeat(this.nextAudioTime);
      this.preparePendingAdvance(this.nextAudioTime);
      guard -= 1;
    }
    if (!this.ticking) {
      return;
    }

    this.emitState(this.lastJumped);
    this.lastJumped = false;

    const msUntilTransition = Math.max(
      0,
      (this.nextAudioTime - this.player.getAudioTime()) * 1000 - 10,
    );
    this.timerId = backgroundSetTimeout(() => this.tick(), msUntilTransition);
  }

  private advanceBeat(audioTime: number) {
    if (!this.analysis || !this.graph) {
      return;
    }
    if (
      this.currentBeatIndex >= 0 &&
      this.bringItHomeMode &&
      this.currentBeatIndex === this.beats.length - 1
    ) {
      this.ticking = false;
      this.timerId = null;
      this.nextAudioTime = Number.POSITIVE_INFINITY;
      this.lastJumped = false;
      this.lastJumpTime = null;
      this.lastJumpFromIndex = null;
      this.clearPendingAdvance(false);
      return;
    }
    const advance =
      this.pendingAdvance?.boundaryAudioTime === audioTime
        ? this.pendingAdvance
        : this.createPendingAdvance(audioTime, true);
    if (!advance) {
      return;
    }
    this.pendingAdvance = null;
    this.commitAdvance(advance);
  }

  private preparePendingAdvance(boundaryAudioTime: number) {
    if (this.currentBeatIndex < 0 || boundaryAudioTime <= 0) {
      return;
    }
    if (
      this.bringItHomeMode &&
      this.currentBeatIndex === this.beats.length - 1
    ) {
      return;
    }
    if (this.pendingAdvance?.boundaryAudioTime === boundaryAudioTime) {
      return;
    }
    this.pendingAdvance = this.createPendingAdvance(boundaryAudioTime, true);
  }

  private createPendingAdvance(
    boundaryAudioTime: number,
    scheduleJump: boolean,
  ): PendingAdvance | null {
    if (!this.analysis || !this.graph) {
      return null;
    }
    const currentIndex = this.currentBeatIndex;
    const beatsCount = this.beats.length;
    let chosenIndex = 0;
    let shouldJump = false;
    let jumpFromIndex: number | null = null;
    let sourceBoundaryTime: number | null = null;

    if (currentIndex >= 0) {
      const nextIndex = currentIndex + 1;
      const wrappedIndex = nextIndex >= beatsCount ? 0 : nextIndex;
      if (this.bringItHomeMode) {
        chosenIndex = wrappedIndex;
      } else {
        const seed = this.beats[wrappedIndex];
        const wrappedToStart =
          wrappedIndex === 0 && currentIndex === beatsCount - 1;
        sourceBoundaryTime = wrappedToStart
          ? this.beats[currentIndex].start + this.beats[currentIndex].duration
          : seed.start;
        if (!wrappedToStart && !this.hasJumpScheduleLead(sourceBoundaryTime)) {
          return {
            boundaryAudioTime,
            chosenIndex: wrappedIndex,
            shouldJump: false,
            targetTime: null,
            jumpFromIndex: null,
            sourceBoundaryTime: null,
          };
        }
        this.branchState.curRandomBranchChance = this.curRandomBranchChance;
        const selection = selectNextBeatIndex(
          seed,
          this.graph,
          this.config,
          this.rng,
          this.branchState,
          this.forceBranch,
        );
        this.curRandomBranchChance = this.branchState.curRandomBranchChance;
        shouldJump = selection.jumped;
        chosenIndex = shouldJump ? selection.index : wrappedIndex;
        if (wrappedToStart) {
          shouldJump = true;
        }
        if (shouldJump) {
          jumpFromIndex = selection.jumped ? seed.which : currentIndex;
        } else {
          jumpFromIndex = null;
        }
      }
    }

    const targetBeat = this.beats[chosenIndex];
    if (!targetBeat) {
      return null;
    }
    const targetTime = shouldJump ? targetBeat.start : null;
    if (scheduleJump && targetTime !== null && sourceBoundaryTime !== null) {
      this.player.scheduleJump(targetTime, sourceBoundaryTime);
    }
    return {
      boundaryAudioTime,
      chosenIndex,
      shouldJump,
      targetTime,
      jumpFromIndex,
      sourceBoundaryTime,
    };
  }

  private commitAdvance(advance: PendingAdvance) {
    const targetBeat = this.beats[advance.chosenIndex];
    if (advance.shouldJump) {
      this.lastJumped = true;
      this.lastJumpTime = advance.targetTime;
      this.lastJumpFromIndex = advance.jumpFromIndex;
    } else {
      this.lastJumped = false;
      this.lastJumpTime = null;
      this.lastJumpFromIndex = null;
    }

    this.currentBeatIndex = advance.chosenIndex;
    const playbackRate = this.getPlaybackRate();
    this.nextAudioTime =
      advance.boundaryAudioTime + targetBeat.duration / playbackRate;
    this.beatsPlayed += 1;
  }

  private initializeBeatClock(audioTime: number) {
    const trackTime = this.player.getCurrentTime();
    const beatIndex = this.findBeatIndexByTime(trackTime);
    if (beatIndex < 0 || beatIndex >= this.beats.length) {
      this.nextAudioTime = audioTime;
      return;
    }
    const beat = this.beats[beatIndex];
    const elapsedInBeat = Math.max(
      0,
      Math.min(beat.duration, trackTime - beat.start),
    );
    const remainingInBeat = Math.max(0, beat.duration - elapsedInBeat);
    this.currentBeatIndex = beatIndex;
    this.beatsPlayed = Math.max(this.beatsPlayed, beatIndex + 1);
    this.nextAudioTime = audioTime + remainingInBeat / this.getPlaybackRate();
  }

  private clearPendingAdvance(cancelScheduledJump: boolean) {
    if (cancelScheduledJump && this.pendingAdvance?.targetTime !== null) {
      this.player.cancelScheduledJump();
    }
    this.pendingAdvance = null;
  }

  private hasJumpScheduleLead(sourceBoundaryTime: number): boolean {
    return (
      sourceBoundaryTime - this.player.getCurrentTime() >=
      MIN_JUMP_SCHEDULE_LEAD_SECONDS
    );
  }

  private getPlaybackRate(): number {
    const rate = this.player.getPlaybackRate();
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  private findBeatIndexByTime(time: number): number {
    let low = 0;
    let high = this.beats.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const beat = this.beats[mid];
      if (time < beat.start) {
        high = mid - 1;
      } else if (time >= beat.start + beat.duration) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return Math.max(0, Math.min(this.beats.length - 1, low - 1));
  }

  private findBeatIndexAtOrAfterTime(time: number): number {
    let low = 0;
    let high = this.beats.length - 1;
    let result = this.beats.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const beat = this.beats[mid];
      if (beat.start >= time) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result;
  }

  private emitState(jumped: boolean) {
    if (!this.graph) {
      return;
    }
    if (this.listener) {
      this.listener({
        currentBeatIndex: this.currentBeatIndex,
        beatsPlayed: this.beatsPlayed,
        currentTime: this.player.getCurrentTime(),
        lastJumped: jumped,
        lastJumpTime: this.lastJumpTime,
        lastJumpFromIndex: this.lastJumpFromIndex,
        currentThreshold: this.graph.currentThreshold,
        lastBranchPoint: this.graph.lastBranchPoint,
        curRandomBranchChance: this.curRandomBranchChance,
      });
    }
  }
}

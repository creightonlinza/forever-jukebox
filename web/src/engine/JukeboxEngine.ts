import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import { createRng, RandomMode } from "./random";
import { backgroundClearTimeout, backgroundSetTimeout } from "../shared/backgroundTimer";
import { selectNextBeatIndex } from "./selection";
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
  addLastEdge: true,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  minRandomBranchChance: 0.18,
  maxRandomBranchChance: 0.5,
  randomBranchChanceDelta: 0.1,
  minLongBranch: 0,
};

const TICK_INTERVAL_MS = 50;
// Timing buffers for scheduling jumps smoothly across audio backends.
const RESYNC_TOLERANCE_SECONDS = 0.05;
const LOOKAHEAD_SECONDS = 0.05;
const JUMP_LATE_TOLERANCE_SECONDS = 0.04;
const JUMP_OFFSET_FRACTION = 0.06;
const MIN_JUMP_OFFSET_SECONDS = 0.015;
const MAX_JUMP_OFFSET_SECONDS = 0.05;
const JUMP_OFFSET_EPSILON = 0.001;

type UpdateListener = (state: JukeboxState) => void;

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
  scheduleJump: (targetTime: number, transitionTime: number) => void;
  getCurrentTime: () => number;
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
  private nextTransitionTime = 0;
  private beatsPlayed = 0;
  private curRandomBranchChance = 0;
  private lastJumped = false;
  private lastJumpTime: number | null = null;
  private lastJumpFromIndex: number | null = null;
  private lastTickTime: number | null = null;
  private forceBranch = false;
  private deletedEdgeKeys = new Set<string>();
  private rng: () => number;
  private listener: UpdateListener | null = null;
  private branchState = { curRandomBranchChance: 0 };

  constructor(player: JukeboxPlayer, options: JukeboxEngineOptions = {}) {
    this.player = player;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.rng = createRng(options.randomMode ?? "random", options.seed);
    this.branchState.curRandomBranchChance = this.config.minRandomBranchChance;
  }

  onUpdate(listener: UpdateListener) {
    this.listener = listener;
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
    const edgeMap = new Map<string, typeof this.graph.allEdges[number]>();
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
    return {
      beats: this.beats,
      edges: Array.from(edgeMap.values()),
    };
  }

  play() {
    this.player.play();
  }

  pause() {
    this.player.pause();
  }

  startJukebox() {
    if (!this.analysis || this.beats.length === 0) {
      throw new Error("Analysis not loaded");
    }
    if (this.ticking) {
      return;
    }
    this.resetState();
    this.ticking = true;
    this.tick();
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
  }

  deleteEdge(edge: { src: QuantumBase; dest: QuantumBase; deleted: boolean }) {
    const srcIndex = edge.src.which;
    const destIndex = edge.dest.which;
    this.deletedEdgeKeys.add(this.edgeKey(srcIndex, destIndex));
    this.applyDeletedEdges();
  }

  setForceBranch(enabled: boolean) {
    this.forceBranch = enabled;
  }

  private applyDeletedEdges() {
    if (!this.graph || !this.analysis || this.deletedEdgeKeys.size === 0) {
      return;
    }
    for (const edge of this.graph.allEdges) {
      if (this.deletedEdgeKeys.has(this.edgeKey(edge.src.which, edge.dest.which))) {
        edge.deleted = true;
      }
    }
    for (const beat of this.analysis.beats) {
      for (const edge of beat.allNeighbors) {
        if (this.deletedEdgeKeys.has(this.edgeKey(edge.src.which, edge.dest.which))) {
          edge.deleted = true;
        }
      }
      beat.neighbors = beat.neighbors.filter((edge) => !edge.deleted);
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

  private resetState() {
    this.currentBeatIndex = -1;
    this.nextTransitionTime = 0;
    this.beatsPlayed = 0;
    this.curRandomBranchChance = this.config.minRandomBranchChance;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    this.lastJumped = false;
    this.lastJumpTime = null;
    this.lastJumpFromIndex = null;
    this.lastTickTime = null;
  }

  private tick() {
    if (!this.ticking || !this.analysis) {
      return;
    }
    this.timerId = backgroundSetTimeout(() => this.tick(), TICK_INTERVAL_MS);
    if (!this.player.isPlaying()) {
      this.emitState(false);
      this.lastTickTime = null;
      return;
    }

    const currentTime = this.player.getCurrentTime();
    const lastTickTime = this.lastTickTime;
    this.lastTickTime = currentTime;
    if (
      this.currentBeatIndex < 0 ||
      currentTime <
        this.beats[this.currentBeatIndex].start - RESYNC_TOLERANCE_SECONDS ||
      currentTime >
        this.beats[this.currentBeatIndex].start +
          this.beats[this.currentBeatIndex].duration +
          RESYNC_TOLERANCE_SECONDS
    ) {
      this.currentBeatIndex = this.findBeatIndexByTime(currentTime);
      if (this.currentBeatIndex >= 0) {
        this.nextTransitionTime =
          this.beats[this.currentBeatIndex].start +
          this.beats[this.currentBeatIndex].duration;
      }
    }

    if (this.currentBeatIndex >= 0 && lastTickTime !== null) {
      const crossedTransition =
        lastTickTime < this.nextTransitionTime && currentTime >= this.nextTransitionTime;
      // Allow scheduling a jump slightly early so audio backends have time to queue
      // the transition; this avoids glitches when timing jitter is present.
      const inLookaheadWindow =
        lastTickTime < this.nextTransitionTime - LOOKAHEAD_SECONDS &&
        currentTime >= this.nextTransitionTime - LOOKAHEAD_SECONDS;
      if (crossedTransition || inLookaheadWindow) {
        this.advanceBeat(currentTime);
      }
    }

    this.emitState(this.lastJumped);
    this.lastJumped = false;
  }

  private advanceBeat(currentTime: number) {
    if (!this.analysis || !this.graph) {
      return;
    }
    const currentIndex = this.currentBeatIndex;
    const beatsCount = this.beats.length;
    const nextIndex = currentIndex + 1;
    const wrappedIndex = nextIndex >= beatsCount ? 0 : nextIndex;
    const enforceLastBranch = currentIndex === this.graph.lastBranchPoint;
    const seed = enforceLastBranch ? this.beats[currentIndex] : this.beats[wrappedIndex];
    const allowJump = currentTime <= this.nextTransitionTime + JUMP_LATE_TOLERANCE_SECONDS;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    const selection = selectNextBeatIndex(
      seed,
      this.graph,
      this.config,
      this.rng,
      this.branchState,
      allowJump && (this.forceBranch || enforceLastBranch)
    );
    this.curRandomBranchChance = this.branchState.curRandomBranchChance;
    const shouldJump = allowJump && selection.jumped;
    const chosenIndex = shouldJump ? selection.index : wrappedIndex;
    const wrappedToStart = wrappedIndex === 0 && currentIndex === beatsCount - 1;
    if (shouldJump || wrappedToStart) {
      const targetBeat = this.beats[chosenIndex];
      const unclampedOffset = targetBeat.duration * JUMP_OFFSET_FRACTION;
      const offset = Math.min(
        Math.max(unclampedOffset, MIN_JUMP_OFFSET_SECONDS),
        MAX_JUMP_OFFSET_SECONDS
      );
      const maxOffset = Math.max(0, targetBeat.duration - JUMP_OFFSET_EPSILON);
      const targetTime = targetBeat.start + Math.min(offset, maxOffset);
      this.player.scheduleJump(targetTime, this.nextTransitionTime);
      this.lastJumped = true;
      this.lastJumpTime = targetTime;
      this.lastJumpFromIndex = shouldJump ? seed.which : currentIndex;
    } else {
      this.lastJumpFromIndex = null;
    }

    this.currentBeatIndex = chosenIndex;
    this.nextTransitionTime =
      this.beats[this.currentBeatIndex].start +
      this.beats[this.currentBeatIndex].duration;
    this.beatsPlayed += 1;
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

import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import { createRng, RandomMode } from "./random";
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "../background/backgroundTimer";
import { getBestLastBranchNeighborIndex, selectNextBeatIndex } from "./selection";
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
  scheduleJump: (targetTime: number, audioStart: number) => void;
  getCurrentTime: () => number;
  getAudioTime: () => number;
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

  seekToBeat(index: number) {
    if (!this.analysis || this.beats.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, this.beats.length - 1));
    const beat = this.beats[clamped];
    const audioNow = this.player.getAudioTime();
    this.currentBeatIndex = clamped;
    this.nextAudioTime = audioNow + beat.duration;
    this.curRandomBranchChance = this.config.minRandomBranchChance;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    this.lastJumped = false;
    this.lastJumpTime = null;
    this.lastJumpFromIndex = null;
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
    this.clearEdgeDeletionFlags();
  }

  deleteEdge(edge: { src: QuantumBase; dest: QuantumBase; deleted: boolean }) {
    const srcIndex = edge.src.which;
    const destIndex = edge.dest.which;
    this.deletedEdgeKeys.add(this.edgeKey(srcIndex, destIndex));
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
    const anchorSource = this.analysis.beats[this.graph.lastBranchPoint];
    if (anchorSource && anchorSource.neighbors.length > 0) {
      return;
    }
    const fallback = this.findFallbackLastBranchPoint();
    if (fallback !== null) {
      this.graph.lastBranchPoint = fallback;
    }
  }

  private findFallbackLastBranchPoint(): number | null {
    if (!this.analysis) {
      return null;
    }
    let latestAnySource: number | null = null;
    for (let i = this.analysis.beats.length - 1; i >= 0; i -= 1) {
      const beat = this.analysis.beats[i];
      if (beat.neighbors.length === 0) {
        continue;
      }
      if (latestAnySource === null) {
        latestAnySource = i;
      }
      const hasBackward = beat.neighbors.some(
        (edge) => edge.dest.which < beat.which,
      );
      if (hasBackward) {
        return i;
      }
    }
    return latestAnySource;
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

  private resetState() {
    this.currentBeatIndex = -1;
    this.nextAudioTime = 0;
    this.beatsPlayed = 0;
    this.curRandomBranchChance = this.config.minRandomBranchChance;
    this.branchState.curRandomBranchChance = this.curRandomBranchChance;
    this.lastJumped = false;
    this.lastJumpTime = null;
    this.lastJumpFromIndex = null;
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
    if (this.nextAudioTime === 0) {
      this.nextAudioTime = audioTime;
    }

    let guard = this.beats.length;
    while (guard > 0 && audioTime >= this.nextAudioTime) {
      this.advanceBeat(this.nextAudioTime);
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
    const currentIndex = this.currentBeatIndex;
    const beatsCount = this.beats.length;
    let chosenIndex = 0;
    let shouldJump = false;
    let jumpFromIndex: number | null = null;

    if (currentIndex >= 0) {
      const isFinalBeat = currentIndex === beatsCount - 1;
      if (this.bringItHomeMode && isFinalBeat) {
        this.ticking = false;
        this.timerId = null;
        this.nextAudioTime = Number.POSITIVE_INFINITY;
        this.lastJumped = false;
        this.lastJumpTime = null;
        this.lastJumpFromIndex = null;
        return;
      }
      const nextIndex = currentIndex + 1;
      const wrappedIndex = nextIndex >= beatsCount ? 0 : nextIndex;
      if (this.bringItHomeMode) {
        chosenIndex = wrappedIndex;
      } else {
        const seed = this.beats[wrappedIndex];
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
        const wrappedToStart =
          wrappedIndex === 0 && currentIndex === beatsCount - 1;
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
    if (shouldJump) {
      const targetTime = targetBeat.start;
      this.player.scheduleJump(targetTime, audioTime);
      this.lastJumped = true;
      this.lastJumpTime = targetTime;
      this.lastJumpFromIndex = jumpFromIndex;
    } else {
      this.lastJumped = false;
      this.lastJumpTime = null;
      this.lastJumpFromIndex = null;
    }

    this.currentBeatIndex = chosenIndex;
    const startTime = this.nextAudioTime === 0 ? audioTime : this.nextAudioTime;
    this.nextAudioTime = startTime + targetBeat.duration;
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

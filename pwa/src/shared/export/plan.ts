import type { AnalysisOutput } from "@/shared/analysis-schema";
import {
  buildJumpGraph,
  calculateMinLongBranch,
  createRng,
  isActiveUserAnchorEdge,
  normalizeAnalysis,
  selectExistingAnchorSource,
  selectNextBeatIndex,
  type JukeboxConfig,
  type JukeboxGraphState,
  type QuantumBase,
  type RandomMode,
  type UserAnchorSelection,
} from "@forever-jukebox/shared";

export interface EdgeRef {
  src: number;
  dest: number;
}

export interface PlannedJukeboxSegment {
  outputStart: number;
  sourceStart: number;
  duration: number;
  beatIndex: number;
  jumped: boolean;
  jumpFromIndex: number | null;
}

export interface PlanJukeboxPathOptions {
  analysis: AnalysisOutput;
  bufferDurationSeconds: number;
  durationSeconds: number;
  config: JukeboxConfig;
  deletedEdges?: EdgeRef[];
  randomMode?: RandomMode;
  seed?: number;
  userAnchorEdge?: EdgeRef | null;
}

export interface PlannedJukeboxPath {
  segments: PlannedJukeboxSegment[];
  renderDurationSeconds: number;
}

function edgeKey(src: number, dest: number) {
  return `${src}-${dest}`;
}

function applyDeletedEdges(
  graph: JukeboxGraphState,
  beats: QuantumBase[],
  deletedEdges: EdgeRef[] | undefined,
  minLongBranch: number,
) {
  if (!deletedEdges || deletedEdges.length === 0) {
    return;
  }
  const deleted = new Set(deletedEdges.map((edge) => edgeKey(edge.src, edge.dest)));
  for (const edge of graph.allEdges) {
    if (deleted.has(edgeKey(edge.src.which, edge.dest.which))) {
      edge.deleted = true;
    }
  }
  for (const beat of beats) {
    for (const edge of beat.allNeighbors) {
      if (deleted.has(edgeKey(edge.src.which, edge.dest.which))) {
        edge.deleted = true;
      }
    }
    beat.neighbors = beat.neighbors.filter((edge) => !edge.deleted);
  }
  // The forced end-of-track anchor must land on a beat that still has
  // neighbors, matching the engine's post-deletion refresh.
  if (graph.lastBranchPoint >= 0) {
    graph.lastBranchPoint =
      selectExistingAnchorSource(beats, minLongBranch) ?? -1;
  }
}

function resolveUserAnchor(
  graph: JukeboxGraphState,
  ref: EdgeRef | null | undefined,
): UserAnchorSelection | null {
  if (!ref) {
    return null;
  }
  const edge = graph.allEdges.find(
    (candidate) =>
      candidate.src.which === ref.src && candidate.dest.which === ref.dest,
  );
  return edge && isActiveUserAnchorEdge(edge)
    ? { edgeId: edge.id, sourceIndex: edge.src.which }
    : null;
}

function sanitizeDuration(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0.5, value);
}

export function planJukeboxPath(options: PlanJukeboxPathOptions): PlannedJukeboxPath {
  const requestedDuration = sanitizeDuration(options.durationSeconds, 60);
  const bufferDuration = sanitizeDuration(options.bufferDurationSeconds, requestedDuration);

  const normalized = normalizeAnalysis(options.analysis);
  const beats = normalized.beats;
  if (beats.length === 0) {
    throw new Error("Analysis contains no beats.");
  }

  const config: JukeboxConfig = {
    ...options.config,
    minLongBranch: calculateMinLongBranch(
      beats.length,
      options.config.minLongBranchPercent,
    ),
  };

  const graph = buildJumpGraph(normalized, config);
  applyDeletedEdges(graph, beats, options.deletedEdges, config.minLongBranch);
  const userAnchor = resolveUserAnchor(graph, options.userAnchorEdge);

  const rng = createRng(options.randomMode ?? "random", options.seed);
  const branchState = { curRandomBranchChance: config.minRandomBranchChance };

  const segments: PlannedJukeboxSegment[] = [];
  let currentBeatIndex = -1;
  let elapsed = 0;
  let currentBranchChance = config.minRandomBranchChance;

  let guard = Math.max(256, Math.ceil(requestedDuration / 0.02));
  while (elapsed < requestedDuration && guard > 0) {
    guard -= 1;

    let chosenIndex = 0;
    let jumped = false;
    let jumpFromIndex: number | null = null;

    if (currentBeatIndex >= 0) {
      const nextIndex = currentBeatIndex + 1;
      const wrappedIndex = nextIndex >= beats.length ? 0 : nextIndex;
      const seed = beats[wrappedIndex];
      branchState.curRandomBranchChance = currentBranchChance;
      const selection = selectNextBeatIndex(
        seed,
        graph,
        config,
        rng,
        branchState,
        false,
        userAnchor,
      );
      currentBranchChance = branchState.curRandomBranchChance;
      jumped = selection.jumped;
      chosenIndex = jumped ? selection.index : wrappedIndex;

      const wrappedToStart = wrappedIndex === 0 && currentBeatIndex === beats.length - 1;
      if (wrappedToStart) {
        jumped = true;
      }
      if (jumped) {
        jumpFromIndex = selection.jumped ? seed.which : currentBeatIndex;
      }
    }

    const beat = beats[chosenIndex];
    const maxFromBuffer = Math.max(0, bufferDuration - beat.start);
    const sourceDuration = Math.min(beat.duration, maxFromBuffer);
    const remaining = requestedDuration - elapsed;
    const segmentDuration = Math.min(sourceDuration, remaining);

    if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) {
      break;
    }

    segments.push({
      outputStart: elapsed,
      sourceStart: beat.start,
      duration: segmentDuration,
      beatIndex: chosenIndex,
      jumped,
      jumpFromIndex,
    });

    elapsed += segmentDuration;
    currentBeatIndex = chosenIndex;
  }

  if (segments.length === 0) {
    throw new Error("Unable to plan jukebox path for export.");
  }

  return {
    segments,
    renderDurationSeconds: elapsed,
  };
}

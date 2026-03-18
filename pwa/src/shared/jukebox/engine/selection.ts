import { JukeboxConfig, JukeboxGraphState, QuantumBase } from "./types";

export interface BranchState {
  curRandomBranchChance: number;
  lastDestBySource?: Map<number, number>;
}

const REFERENCE_BEAT_DURATION_SECONDS = 0.5;

function collectTimeline(seed: QuantumBase): QuantumBase[] {
  let start = seed;
  while (start.prev) {
    start = start.prev;
  }
  const beats: QuantumBase[] = [];
  const seen = new Set<number>();
  let current: QuantumBase | null = start;
  while (current && !seen.has(current.which)) {
    beats.push(current);
    seen.add(current.which);
    current = current.next;
  }
  return beats;
}

function computeEarliestReachableByBeat(
  beats: QuantumBase[],
): Map<number, number> {
  const earliest = new Map<number, number>();
  for (const beat of beats) {
    earliest.set(beat.which, beat.which);
  }

  // Relax backwards across the timeline to account for linear progression and branches.
  for (let iter = 0; iter < beats.length; iter += 1) {
    let changed = false;
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const beat = beats[i];
      const current = earliest.get(beat.which) ?? beat.which;
      let best = current;
      const next = beat.next;
      if (next) {
        best = Math.min(best, earliest.get(next.which) ?? next.which);
      }
      for (const edge of beat.neighbors) {
        best = Math.min(
          best,
          earliest.get(edge.dest.which) ?? edge.dest.which,
        );
      }
      if (best < current) {
        earliest.set(beat.which, best);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return earliest;
}

function resolveEarlyTargetBeat(
  beats: QuantumBase[],
  fallbackPct = 25,
): number {
  const fallbackBeat = Math.floor((beats.length * fallbackPct) / 100);
  const lateSourceStart = Math.floor(beats.length * 0.66);
  let firstBackwardDestination = Number.POSITIVE_INFINITY;
  let firstLateBackwardDestination = Number.POSITIVE_INFINITY;
  for (const beat of beats) {
    for (const edge of beat.neighbors) {
      if (
        edge.dest.which < beat.which &&
        edge.dest.which < firstBackwardDestination
      ) {
        firstBackwardDestination = edge.dest.which;
      }
      if (
        beat.which >= lateSourceStart &&
        edge.dest.which < beat.which &&
        edge.dest.which < firstLateBackwardDestination
      ) {
        firstLateBackwardDestination = edge.dest.which;
      }
    }
  }
  if (
    !Number.isFinite(firstBackwardDestination) &&
    !Number.isFinite(firstLateBackwardDestination)
  ) {
    return fallbackBeat;
  }
  return Math.max(
    fallbackBeat,
    Number.isFinite(firstBackwardDestination) ? firstBackwardDestination : 0,
    Number.isFinite(firstLateBackwardDestination)
      ? firstLateBackwardDestination
      : 0,
  );
}

function computeBranchesToEarlyTarget(
  beats: QuantumBase[],
  earlyTargetBeat: number,
): Map<number, number> {
  const branchesNeeded = new Map<number, number>();
  for (const beat of beats) {
    branchesNeeded.set(
      beat.which,
      beat.which <= earlyTargetBeat ? 0 : Number.POSITIVE_INFINITY,
    );
  }
  for (let iter = 0; iter < beats.length; iter += 1) {
    let changed = false;
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const beat = beats[i];
      let best = branchesNeeded.get(beat.which) ?? Number.POSITIVE_INFINITY;
      if (beat.next) {
        best = Math.min(
          best,
          branchesNeeded.get(beat.next.which) ?? Number.POSITIVE_INFINITY,
        );
      }
      for (const edge of beat.neighbors) {
        const destCost =
          branchesNeeded.get(edge.dest.which) ?? Number.POSITIVE_INFINITY;
        if (Number.isFinite(destCost)) {
          best = Math.min(best, destCost + 1);
        }
      }
      const current =
        branchesNeeded.get(beat.which) ?? Number.POSITIVE_INFINITY;
      if (best < current) {
        branchesNeeded.set(beat.which, best);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return branchesNeeded;
}

export function getBestLastBranchNeighborIndex(
  seed: QuantumBase,
): number {
  const beats = collectTimeline(seed);
  const earlyTargetBeat = resolveEarlyTargetBeat(beats, 25);
  const earliestByBeat = computeEarliestReachableByBeat(beats);
  const branchesToTarget = computeBranchesToEarlyTarget(beats, earlyTargetBeat);
  const hasBackwardNeighbor = seed.neighbors.some(
    (edge) => edge.dest.which < seed.which,
  );
  let bestIndex = 0;
  let bestBranchesToTarget = Number.POSITIVE_INFINITY;
  let bestEarliest = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestImmediate = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < seed.neighbors.length; i += 1) {
    const edge = seed.neighbors[i];
    const immediate = seed.which - edge.dest.which;
    if (hasBackwardNeighbor && immediate <= 0) {
      continue;
    }
    const targetBranches =
      branchesToTarget.get(edge.dest.which) ?? Number.POSITIVE_INFINITY;
    const earliest =
      earliestByBeat.get(edge.dest.which) ?? edge.dest.which;
    if (
      targetBranches < bestBranchesToTarget ||
      (targetBranches === bestBranchesToTarget && earliest < bestEarliest) ||
      (targetBranches === bestBranchesToTarget &&
        earliest === bestEarliest &&
        edge.distance < bestDistance) ||
      (targetBranches === bestBranchesToTarget &&
        earliest === bestEarliest &&
        edge.distance === bestDistance &&
        immediate > bestImmediate)
    ) {
      bestIndex = i;
      bestBranchesToTarget = targetBranches;
      bestEarliest = earliest;
      bestDistance = edge.distance;
      bestImmediate = immediate;
    }
  }
  return bestIndex;
}

export function shouldRandomBranch(
  q: QuantumBase,
  graph: JukeboxGraphState,
  config: JukeboxConfig,
  rng: () => number,
  state: BranchState
): boolean {
  if (q.which === graph.lastBranchPoint) {
    return true;
  }
  // Gradually increase branch chance by elapsed musical time (not raw beat
  // count), so fast songs do not ramp jump probability disproportionately.
  const beatDuration =
    Number.isFinite(q.duration) && q.duration > 0
      ? q.duration
      : REFERENCE_BEAT_DURATION_SECONDS;
  const tempoNormalizedDelta =
    config.randomBranchChanceDelta *
    (beatDuration / REFERENCE_BEAT_DURATION_SECONDS);
  state.curRandomBranchChance += tempoNormalizedDelta;
  if (state.curRandomBranchChance > config.maxRandomBranchChance) {
    state.curRandomBranchChance = config.maxRandomBranchChance;
  }
  const shouldBranch = rng() < state.curRandomBranchChance;
  if (shouldBranch) {
    state.curRandomBranchChance = config.minRandomBranchChance;
  }
  return shouldBranch;
}

export function selectNextBeatIndex(
  seed: QuantumBase,
  graph: JukeboxGraphState,
  config: JukeboxConfig,
  rng: () => number,
  state: BranchState,
  forceBranch = false
): { index: number; jumped: boolean } {
  if (seed.neighbors.length === 0) {
    return { index: seed.which, jumped: false };
  }
  if (!forceBranch && !shouldRandomBranch(seed, graph, config, rng, state)) {
    return { index: seed.which, jumped: false };
  }
  let nextEdge;
  if (seed.which === graph.lastBranchPoint) {
    const bestIndex = getBestLastBranchNeighborIndex(seed);
    const selected = seed.neighbors.splice(bestIndex, 1);
    nextEdge = selected[0];
  } else {
    const selectedIndex = selectWeightedNeighborIndex(seed, rng, state);
    const selected = seed.neighbors.splice(selectedIndex, 1);
    nextEdge = selected[0];
  }
  if (!nextEdge) {
    return { index: seed.which, jumped: false };
  }
  seed.neighbors.push(nextEdge);
  if (!state.lastDestBySource) {
    state.lastDestBySource = new Map<number, number>();
  }
  state.lastDestBySource.set(seed.which, nextEdge.dest.which);
  const nextIndex = nextEdge.dest.which;
  return { index: nextIndex, jumped: nextIndex !== seed.which };
}

function selectWeightedNeighborIndex(
  seed: QuantumBase,
  rng: () => number,
  state: BranchState,
): number {
  if (seed.neighbors.length <= 1) {
    return 0;
  }
  const lastDest = state.lastDestBySource?.get(seed.which);
  const weights = seed.neighbors.map((edge) => {
    const distanceWeight = 1 / (1 + Math.max(0, edge.distance));
    const repeatPenalty =
      lastDest !== undefined && edge.dest.which === lastDest ? 0.35 : 1;
    const weight = distanceWeight * repeatPenalty;
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  let target = rng() * totalWeight;
  for (let i = 0; i < weights.length; i += 1) {
    target -= weights[i];
    if (target <= 0) {
      return i;
    }
  }
  return weights.length - 1;
}

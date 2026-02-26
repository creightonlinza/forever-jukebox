import { JukeboxConfig, JukeboxGraphState, QuantumBase } from "./types";

export interface BranchState {
  curRandomBranchChance: number;
}

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
  // Gradually increase branch chance until a jump happens, then reset.
  state.curRandomBranchChance += config.randomBranchChanceDelta;
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
    nextEdge = seed.neighbors.shift();
  }
  if (!nextEdge) {
    return { index: seed.which, jumped: false };
  }
  seed.neighbors.push(nextEdge);
  const nextIndex = nextEdge.dest.which;
  return { index: nextIndex, jumped: nextIndex !== seed.which };
}

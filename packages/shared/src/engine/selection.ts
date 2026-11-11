import { beatPairDistance } from "./graph";
import { Edge, JukeboxConfig, JukeboxGraphState, QuantumBase } from "./types";

export interface BranchState {
  curRandomBranchChance: number;
  lastDestBySource?: Map<number, number> | null;
}

export interface UserAnchorSelection {
  edgeId: number;
  sourceIndex: number;
}

// Real edge ids are array indexes, so a negative id never collides with one.
export const CUSTOM_ANCHOR_EDGE_ID = -1;
export function isCustomAnchorEdge(edge: Pick<Edge, "id">): boolean {
  return edge.id === CUSTOM_ANCHOR_EDGE_ID;
}

// Shorter loops sit next to freeze-beat territory and restart the player too often.
export const MIN_CUSTOM_ANCHOR_GAP = 4;

export interface CustomAnchor {
  src: number;
  dest: number;
}

// A custom anchor always jumps backward, so it always closes a loop.
export function isValidCustomAnchor(
  beatCount: number,
  src: number,
  dest: number,
): boolean {
  return (
    Number.isInteger(src) &&
    Number.isInteger(dest) &&
    dest >= 0 &&
    src < beatCount &&
    src - dest >= MIN_CUSTOM_ANCHOR_GAP
  );
}

// The synthetic edge for a custom pair; it lives only in its source beat's neighbors.
export function createCustomAnchorEdge(
  beats: readonly QuantumBase[],
  anchor: CustomAnchor,
): Edge | null {
  if (!isValidCustomAnchor(beats.length, anchor.src, anchor.dest)) {
    return null;
  }
  const src = beats[anchor.src];
  const dest = beats[anchor.dest];
  return {
    id: CUSTOM_ANCHOR_EDGE_ID,
    src,
    dest,
    distance: beatPairDistance(src, dest),
    deleted: false,
  };
}

// The `ab` tuning value: a pinned branch id ("12") or a custom beat pair ("289-23").
export type AnchorParam = { edgeId: number } | { custom: CustomAnchor };

export function parseAnchorParam(raw: string | null | undefined): AnchorParam | null {
  const value = raw?.trim() ?? "";
  if (/^\d{1,9}$/.test(value)) {
    return { edgeId: Number.parseInt(value, 10) };
  }
  const pair = /^(\d{1,7})-(\d{1,7})$/.exec(value);
  if (!pair) {
    return null;
  }
  const src = Number.parseInt(pair[1], 10);
  const dest = Number.parseInt(pair[2], 10);
  // Beat count is unknown here; the engine checks the range against the loaded track.
  return isValidCustomAnchor(Number.MAX_SAFE_INTEGER, src, dest)
    ? { custom: { src, dest } }
    : null;
}

export function formatAnchorParam(param: AnchorParam): string {
  return "edgeId" in param
    ? `${param.edgeId}`
    : `${param.custom.src}-${param.custom.dest}`;
}

export type CustomAnchorEnd = "src" | "dest";

// Moves one end toward index, stopping at the minimum gap so the ends never cross.
export function moveCustomAnchorEnd(
  beatCount: number,
  anchor: CustomAnchor,
  end: CustomAnchorEnd,
  index: number,
): CustomAnchor {
  if (end === "src") {
    const min = anchor.dest + MIN_CUSTOM_ANCHOR_GAP;
    return { src: Math.max(min, Math.min(index, beatCount - 1)), dest: anchor.dest };
  }
  const max = anchor.src - MIN_CUSTOM_ANCHOR_GAP;
  return { src: anchor.src, dest: Math.max(0, Math.min(index, max)) };
}

const DEFAULT_BEATS_PER_BAR = 4;

function beatsPerBarAt(beats: readonly QuantumBase[], index: number): number {
  return beats[index]?.parent?.children?.length || DEFAULT_BEATS_PER_BAR;
}

// The pair an editor opens on: the anchor in force, else the widest loop; null when the track is too short.
export function startingCustomAnchor(
  active: CustomAnchor | null,
  beatCount: number,
): CustomAnchor | null {
  if (active && isValidCustomAnchor(beatCount, active.src, active.dest)) {
    return active;
  }
  return beatCount > MIN_CUSTOM_ANCHOR_GAP ? { src: beatCount - 1, dest: 0 } : null;
}

// Moves one end by one beat, or by one bar of the beat it starts on.
export function nudgeCustomAnchorEnd(
  beats: readonly QuantumBase[],
  anchor: CustomAnchor,
  end: CustomAnchorEnd,
  direction: -1 | 1,
  byBar: boolean,
): CustomAnchor {
  const from = anchor[end];
  const step = byBar ? beatsPerBarAt(beats, from) : 1;
  return moveCustomAnchorEnd(beats.length, anchor, end, from + direction * step);
}

// Moves one end to its lowest-distance beat within one bar either side; ties keep the nearer beat.
export function snapCustomAnchorEnd(
  beats: readonly QuantumBase[],
  anchor: CustomAnchor,
  end: CustomAnchorEnd,
): CustomAnchor {
  const from = anchor[end];
  const radius = beatsPerBarAt(beats, from);
  let best = anchor;
  let bestDistance = beatPairDistance(beats[anchor.src], beats[anchor.dest]);
  let bestOffset = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const candidate = moveCustomAnchorEnd(beats.length, anchor, end, from + offset);
    if (candidate[end] !== from + offset) {
      continue;
    }
    const distance = beatPairDistance(beats[candidate.src], beats[candidate.dest]);
    if (
      distance < bestDistance ||
      (distance === bestDistance && Math.abs(offset) < Math.abs(bestOffset))
    ) {
      best = candidate;
      bestDistance = distance;
      bestOffset = offset;
    }
  }
  return best;
}

// A pinned anchor edge only takes effect while it survives deletion and
// branch filtering (i.e. is still offered by its source beat).
export function isActiveUserAnchorEdge(edge: Edge): boolean {
  if (edge.deleted) {
    return false;
  }
  return edge.src.neighbors.some((candidate) => candidate.id === edge.id);
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
  state: BranchState,
  suppressDefaultAnchor = false
): boolean {
  if (!suppressDefaultAnchor && q.which === graph.lastBranchPoint) {
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
  forceBranch = false,
  userAnchor: UserAnchorSelection | null = null
): { index: number; jumped: boolean } {
  if (seed.neighbors.length === 0) {
    return { index: seed.which, jumped: false };
  }
  const userAnchorIndex =
    userAnchor === null
      ? -1
      : seed.neighbors.findIndex((edge) => edge.id === userAnchor.edgeId);
  const candidateIndexes =
    userAnchor !== null && seed.which < userAnchor.sourceIndex
      ? seed.neighbors
          .map((edge, index) =>
            edge.dest.which < userAnchor.sourceIndex ? index : -1,
          )
          .filter((index) => index >= 0)
      : undefined;
  if (
    userAnchorIndex < 0 &&
    candidateIndexes?.length === 0
  ) {
    return { index: seed.which, jumped: false };
  }
  if (
    userAnchorIndex < 0 &&
    !forceBranch &&
    !shouldRandomBranch(
      seed,
      graph,
      config,
      rng,
      state,
      userAnchor !== null,
    )
  ) {
    return { index: seed.which, jumped: false };
  }
  let nextEdge;
  if (userAnchorIndex >= 0) {
    const selected = seed.neighbors.splice(userAnchorIndex, 1);
    nextEdge = selected[0];
  } else if (userAnchor === null && seed.which === graph.lastBranchPoint) {
    const bestIndex = getBestLastBranchNeighborIndex(seed);
    const selected = seed.neighbors.splice(bestIndex, 1);
    nextEdge = selected[0];
  } else {
    const selectedIndex = selectWeightedNeighborIndex(
      seed,
      rng,
      state,
      candidateIndexes,
    );
    if (selectedIndex < 0) {
      return { index: seed.which, jumped: false };
    }
    const selected = seed.neighbors.splice(selectedIndex, 1);
    nextEdge = selected[0];
  }
  if (!nextEdge) {
    return { index: seed.which, jumped: false };
  }
  seed.neighbors.push(nextEdge);
  state.lastDestBySource ??= new Map<number, number>();
  state.lastDestBySource.set(seed.which, nextEdge.dest.which);
  const nextIndex = nextEdge.dest.which;
  return { index: nextIndex, jumped: nextIndex !== seed.which };
}

function selectWeightedNeighborIndex(
  seed: QuantumBase,
  rng: () => number,
  state: BranchState,
  candidateIndexes?: number[],
): number {
  const indexes =
    candidateIndexes ?? seed.neighbors.map((_edge, index) => index);
  if (indexes.length <= 1) {
    return indexes[0] ?? -1;
  }
  const lastDest = state.lastDestBySource?.get(seed.which);
  const weights = indexes.map((index) => {
    const edge = seed.neighbors[index];
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
      return indexes[i];
    }
  }
  return indexes[indexes.length - 1] ?? -1;
}

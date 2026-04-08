import {
  Edge,
  JukeboxConfig,
  JukeboxGraphState,
  QuantumBase,
  Segment,
  TrackAnalysis,
} from "./types";

const TIMBRE_WEIGHT = 1;
const PITCH_WEIGHT = 10;
const LOUD_START_WEIGHT = 1;
const LOUD_MAX_WEIGHT = 1;
const DURATION_WEIGHT = 100;
const CONFIDENCE_WEIGHT = 1;

function euclideanDistance(v1: number[], v2: number[]): number {
  let sum = 0;
  for (let i = 0; i < v1.length; i += 1) {
    const delta = v2[i] - v1[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function getSegmentDistance(seg1: Segment, seg2: Segment): number {
  const timbre = euclideanDistance(seg1.timbre, seg2.timbre);
  const pitch = euclideanDistance(seg1.pitches, seg2.pitches);
  const loudStart = Math.abs(seg1.loudness_start - seg2.loudness_start);
  const loudMax = Math.abs(seg1.loudness_max - seg2.loudness_max);
  const duration = Math.abs(seg1.duration - seg2.duration);
  const confidence = Math.abs(seg1.confidence - seg2.confidence);
  return (
    timbre * TIMBRE_WEIGHT +
    pitch * PITCH_WEIGHT +
    loudStart * LOUD_START_WEIGHT +
    loudMax * LOUD_MAX_WEIGHT +
    duration * DURATION_WEIGHT +
    confidence * CONFIDENCE_WEIGHT
  );
}

function calculateNearestNeighborsForQuantum(
  quanta: QuantumBase[],
  maxNeighbors: number,
  maxThreshold: number,
  q1: QuantumBase,
  allEdges: Edge[],
) {
  const edges: Edge[] = [];
  if (q1.overlappingSegments.length === 0) {
    q1.allNeighbors = [];
    return;
  }

  for (let i = 0; i < quanta.length; i += 1) {
    if (i === q1.which) {
      continue;
    }

    const q2 = quanta[i];
    let sum = 0;
    for (let j = 0; j < q1.overlappingSegments.length; j += 1) {
      const seg1 = q1.overlappingSegments[j];
      let distance = 100;
      if (j < q2.overlappingSegments.length) {
        const seg2 = q2.overlappingSegments[j];
        if (seg1.which === seg2.which) {
          distance = 100;
        } else {
          distance = getSegmentDistance(seg1, seg2);
        }
      }
      sum += distance;
    }

    const pdistance =
      q1.indexInParent !== undefined &&
      q2.indexInParent !== undefined &&
      q1.indexInParent === q2.indexInParent
        ? 0
        : 100;

    const totalDistance = sum / q1.overlappingSegments.length + pdistance;
    if (totalDistance < maxThreshold) {
      edges.push({
        id: -1,
        src: q1,
        dest: q2,
        distance: totalDistance,
        deleted: false,
      });
    }
  }

  edges.sort((a, b) =>
    a.distance > b.distance ? 1 : a.distance < b.distance ? -1 : 0,
  );

  q1.allNeighbors = [];
  for (let i = 0; i < maxNeighbors && i < edges.length; i += 1) {
    const edge = edges[i];
    edge.id = allEdges.length;
    allEdges.push(edge);
    q1.allNeighbors.push(edge);
  }
}

function precalculateNearestNeighbors(
  quanta: QuantumBase[],
  maxNeighbors: number,
  maxThreshold: number,
  allEdges: Edge[],
) {
  if (quanta.length === 0) {
    return;
  }
  if (quanta[0].allNeighbors.length > 0) {
    allEdges.length = 0;
    for (const q of quanta) {
      for (const edge of q.allNeighbors) {
        allEdges.push(edge);
      }
    }
    return;
  }
  allEdges.length = 0;
  for (const q of quanta) {
    calculateNearestNeighborsForQuantum(
      quanta,
      maxNeighbors,
      maxThreshold,
      q,
      allEdges,
    );
  }
}

function extractNearestNeighbors(
  q: QuantumBase,
  maxThreshold: number,
  config: JukeboxConfig,
): Edge[] {
  const neighbors: Edge[] = [];
  for (const neighbor of q.allNeighbors) {
    if (neighbor.deleted) {
      continue;
    }
    if (config.justBackwards && neighbor.dest.which > q.which) {
      continue;
    }
    if (
      config.justLongBranches &&
      Math.abs(neighbor.dest.which - q.which) < config.minLongBranch
    ) {
      continue;
    }
    if (neighbor.distance <= maxThreshold) {
      neighbors.push(neighbor);
    }
  }
  return neighbors;
}

function collectNearestNeighbors(
  quanta: QuantumBase[],
  maxThreshold: number,
  config: JukeboxConfig,
): number {
  let branchingCount = 0;
  for (const q of quanta) {
    q.neighbors = extractNearestNeighbors(q, maxThreshold, config);
    if (q.neighbors.length > 0) {
      branchingCount += 1;
    }
  }
  return branchingCount;
}

function longestBackwardBranch(quanta: QuantumBase[]): number {
  let longest = 0;
  for (let i = 0; i < quanta.length; i += 1) {
    const q = quanta[i];
    for (const neighbor of q.neighbors) {
      const delta = i - neighbor.dest.which;
      if (delta > longest) {
        longest = delta;
      }
    }
  }
  return (longest * 100) / quanta.length;
}

function calculateEarliestReachableByBeat(quanta: QuantumBase[]): Map<number, number> {
  const earliest = new Map<number, number>();
  for (const q of quanta) {
    earliest.set(q.which, q.which);
  }
  const maxIter = quanta.length;
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    for (let i = quanta.length - 1; i >= 0; i -= 1) {
      const q = quanta[i];
      const current = earliest.get(q.which) ?? q.which;
      let best = current;
      if (q.next) {
        best = Math.min(best, earliest.get(q.next.which) ?? q.next.which);
      }
      for (const neighbor of q.neighbors) {
        best = Math.min(
          best,
          earliest.get(neighbor.dest.which) ?? neighbor.dest.which,
        );
      }
      if (best < current) {
        earliest.set(q.which, best);
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
  quanta: QuantumBase[],
  fallbackPct: number,
): number {
  const fallbackBeat = Math.floor((quanta.length * fallbackPct) / 100);
  const lateHintCapBeat = Math.floor(quanta.length * 0.55);
  const lateSourceStart = Math.floor(quanta.length * 0.66);
  let firstBackwardDestination = Number.POSITIVE_INFINITY;
  let firstLateBackwardDestination = Number.POSITIVE_INFINITY;
  for (const q of quanta) {
    for (const neighbor of q.neighbors) {
      if (
        neighbor.dest.which < q.which &&
        neighbor.dest.which < firstBackwardDestination
      ) {
        firstBackwardDestination = neighbor.dest.which;
      }
      if (
        q.which >= lateSourceStart &&
        neighbor.dest.which < q.which &&
        neighbor.dest.which < firstLateBackwardDestination
      ) {
        firstLateBackwardDestination = neighbor.dest.which;
      }
    }
  }
  if (
    !Number.isFinite(firstBackwardDestination) &&
    !Number.isFinite(firstLateBackwardDestination)
  ) {
    return fallbackBeat;
  }
  // Keep late-branch hints useful but bounded so they cannot collapse the
  // target zone too close to the end of the track.
  const boundedLateHint = Number.isFinite(firstLateBackwardDestination)
    ? Math.min(firstLateBackwardDestination, lateHintCapBeat)
    : 0;
  return Math.max(
    fallbackBeat,
    Number.isFinite(firstBackwardDestination) ? firstBackwardDestination : 0,
    boundedLateHint,
  );
}

interface NeighborOutcome {
  branchesToTarget: number;
  earliestReachable: number;
  immediateBackward: number;
  distance: number;
}

interface AnchorTierRule {
  maxAdditionalBranches: number;
  minImmediateBackward: number;
}

interface AnchorSourceCandidate {
  index: number;
  outcome: NeighborOutcome;
}

interface AnchorDecisionContext {
  earlyTargetBeat: number;
  branchesToTarget: Map<number, number>;
  earliestByBeat: Map<number, number>;
}

const LATE_ANCHOR_BRANCH_TOLERANCE = 1;
const LATE_ANCHOR_IMMEDIATE_RATIO = 0.6;
const LATE_ANCHOR_EARLIEST_SLACK_PCT = 0.02;
const LATE_ANCHOR_EARLIEST_SLACK_MIN = 4;
const LATE_ANCHOR_EXTRA_HOP_MAX_LANDING_PCT = 0.5;
const LATE_ANCHOR_NEARBY_SOURCE_WINDOW = 4;
const LATE_ANCHOR_NEARBY_IMMEDIATE_RATIO = 0.8;

function calculateBranchesToEarlyTarget(
  quanta: QuantumBase[],
  earlyTargetBeat: number,
): Map<number, number> {
  const branchesNeeded = new Map<number, number>();
  for (const q of quanta) {
    branchesNeeded.set(
      q.which,
      q.which <= earlyTargetBeat ? 0 : Number.POSITIVE_INFINITY,
    );
  }
  const maxIter = quanta.length;
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    for (let i = quanta.length - 1; i >= 0; i -= 1) {
      const q = quanta[i];
      let best = branchesNeeded.get(q.which) ?? Number.POSITIVE_INFINITY;
      if (q.next) {
        best = Math.min(
          best,
          branchesNeeded.get(q.next.which) ?? Number.POSITIVE_INFINITY,
        );
      }
      for (const neighbor of q.neighbors) {
        const destCost =
          branchesNeeded.get(neighbor.dest.which) ?? Number.POSITIVE_INFINITY;
        if (Number.isFinite(destCost)) {
          best = Math.min(best, destCost + 1);
        }
      }
      const current = branchesNeeded.get(q.which) ?? Number.POSITIVE_INFINITY;
      if (best < current) {
        branchesNeeded.set(q.which, best);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return branchesNeeded;
}

function selectBestBackwardNeighborOutcome(
  q: QuantumBase,
  earliestByBeat: Map<number, number>,
  branchesToTarget: Map<number, number>,
): NeighborOutcome | null {
  let best: NeighborOutcome | null = null;
  for (const neighbor of q.neighbors) {
    const immediateBackward = q.which - neighbor.dest.which;
    if (immediateBackward <= 0) {
      continue;
    }
    const candidate: NeighborOutcome = {
      branchesToTarget:
        branchesToTarget.get(neighbor.dest.which) ?? Number.POSITIVE_INFINITY,
      earliestReachable:
        earliestByBeat.get(neighbor.dest.which) ?? neighbor.dest.which,
      immediateBackward,
      distance: neighbor.distance,
    };
    if (
      !best ||
      candidate.branchesToTarget < best.branchesToTarget ||
      (candidate.branchesToTarget === best.branchesToTarget &&
        candidate.earliestReachable < best.earliestReachable) ||
      (candidate.branchesToTarget === best.branchesToTarget &&
        candidate.earliestReachable === best.earliestReachable &&
        candidate.distance < best.distance) ||
      (candidate.branchesToTarget === best.branchesToTarget &&
        candidate.earliestReachable === best.earliestReachable &&
        candidate.distance === best.distance &&
        candidate.immediateBackward > best.immediateBackward)
    ) {
      best = candidate;
    }
  }
  return best;
}

function buildAnchorTierRules(minLongBranch: number): AnchorTierRule[] {
  return [
    // best: direct or one-hop return with a long jump
    {
      maxAdditionalBranches: 1,
      minImmediateBackward: minLongBranch,
    },
    // good: allow one extra hop and a medium jump
    {
      maxAdditionalBranches: 2,
      minImmediateBackward: Math.max(2, Math.floor(minLongBranch * 0.5)),
    },
    // ok: allow deeper chaining as long as there is still a meaningful back jump
    {
      maxAdditionalBranches: 3,
      minImmediateBackward: Math.max(1, Math.floor(minLongBranch * 0.25)),
    },
  ];
}

function compareAnchorOutcomeQuality(
  a: NeighborOutcome,
  b: NeighborOutcome,
): number {
  return (
    a.branchesToTarget - b.branchesToTarget ||
    a.earliestReachable - b.earliestReachable ||
    b.immediateBackward - a.immediateBackward ||
    a.distance - b.distance
  );
}

function buildAnchorDecisionContext(quanta: QuantumBase[]): AnchorDecisionContext {
  const earlyTargetBeat = resolveEarlyTargetBeat(quanta, 25);
  return {
    earlyTargetBeat,
    branchesToTarget: calculateBranchesToEarlyTarget(quanta, earlyTargetBeat),
    earliestByBeat: calculateEarliestReachableByBeat(quanta),
  };
}

function collectAnchorTierCandidates(
  quanta: QuantumBase[],
  range: { start: number; end: number },
  rule: AnchorTierRule,
  context: AnchorDecisionContext,
): AnchorSourceCandidate[] {
  const candidates: AnchorSourceCandidate[] = [];
  for (let i = range.end; i >= range.start; i -= 1) {
    const q = quanta[i];
    const outcome = selectBestBackwardNeighborOutcome(
      q,
      context.earliestByBeat,
      context.branchesToTarget,
    );
    if (
      outcome &&
      outcome.branchesToTarget <= rule.maxAdditionalBranches &&
      outcome.earliestReachable <= context.earlyTargetBeat &&
      outcome.immediateBackward >= rule.minImmediateBackward
    ) {
      candidates.push({ index: i, outcome });
    }
  }
  return candidates;
}

function pickLatestAnchorCandidate(
  candidates: AnchorSourceCandidate[],
): AnchorSourceCandidate {
  let latest = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].index > latest.index) {
      latest = candidates[i];
    }
  }
  return latest;
}

function shouldPreferBestQualityOverLatest(
  bestQuality: AnchorSourceCandidate,
  latest: AnchorSourceCandidate,
): boolean {
  const latestIsNearby =
    latest.index - bestQuality.index <= LATE_ANCHOR_NEARBY_SOURCE_WINDOW;
  const latestNeedsMoreBranches =
    latest.outcome.branchesToTarget > bestQuality.outcome.branchesToTarget;
  const nearbyImmediateFloor = Math.floor(
    bestQuality.outcome.immediateBackward * LATE_ANCHOR_NEARBY_IMMEDIATE_RATIO,
  );
  const latestIsMeaningfullyShorter =
    latest.outcome.immediateBackward < nearbyImmediateFloor;
  return latestIsNearby && latestNeedsMoreBranches && latestIsMeaningfullyShorter;
}

function filterLateBiasAnchorCandidates(
  candidates: AnchorSourceCandidate[],
  bestQuality: AnchorSourceCandidate,
  rule: AnchorTierRule,
  quantaLength: number,
): AnchorSourceCandidate[] {
  const earliestSlack = Math.max(
    LATE_ANCHOR_EARLIEST_SLACK_MIN,
    Math.floor(quantaLength * LATE_ANCHOR_EARLIEST_SLACK_PCT),
  );
  const immediateFloor = Math.max(
    rule.minImmediateBackward,
    Math.floor(bestQuality.outcome.immediateBackward * LATE_ANCHOR_IMMEDIATE_RATIO),
  );
  const maxExtraHopLandingBeat = Math.floor(
    quantaLength * LATE_ANCHOR_EXTRA_HOP_MAX_LANDING_PCT,
  );
  return candidates.filter((candidate) => {
    const landingBeat = candidate.index - candidate.outcome.immediateBackward;
    const allowByLandingDepth =
      candidate.outcome.branchesToTarget === 0 ||
      landingBeat <= maxExtraHopLandingBeat;
    return (
      allowByLandingDepth &&
      candidate.outcome.branchesToTarget <=
        bestQuality.outcome.branchesToTarget + LATE_ANCHOR_BRANCH_TOLERANCE &&
      candidate.outcome.earliestReachable <=
        bestQuality.outcome.earliestReachable + earliestSlack &&
      candidate.outcome.immediateBackward >= immediateFloor
    );
  });
}

function findBestTieredAnchorSource(
  quanta: QuantumBase[],
  context: AnchorDecisionContext,
  minSourceIndex: number,
  minLongBranch: number,
): number | null {
  const rules = buildAnchorTierRules(minLongBranch);
  const preferredLateStart = Math.max(
    minSourceIndex,
    Math.floor(quanta.length * 0.8),
  );
  const ranges: Array<{ start: number; end: number }> = [
    { start: preferredLateStart, end: quanta.length - 1 },
    { start: minSourceIndex, end: preferredLateStart - 1 },
  ];
  for (const rule of rules) {
    for (const range of ranges) {
      if (range.end < range.start) {
        continue;
      }
      const candidates = collectAnchorTierCandidates(quanta, range, rule, context);
      if (candidates.length === 0) {
        continue;
      }
      const bestQuality = candidates.reduce((best, candidate) =>
        compareAnchorOutcomeQuality(candidate.outcome, best.outcome) < 0
          ? candidate
          : best,
      );
      const lateBiasCandidates = filterLateBiasAnchorCandidates(
        candidates,
        bestQuality,
        rule,
        quanta.length,
      );
      if (lateBiasCandidates.length > 0) {
        const latest = pickLatestAnchorCandidate(lateBiasCandidates);
        if (shouldPreferBestQualityOverLatest(bestQuality, latest)) {
          return bestQuality.index;
        }
        return latest.index;
      }
      return bestQuality.index;
    }
  }
  return null;
}

function insertBestBackwardBranch(
  quanta: QuantumBase[],
  threshold: number,
  maxThreshold: number,
  minSourceIndex = Math.floor(quanta.length * 0.66),
  context?: AnchorDecisionContext,
): number | null {
  const decisionContext = context ?? buildAnchorDecisionContext(quanta);
  const branches: Array<{
    branchesToTarget: number;
    earliestReachable: number;
    immediateBackward: number;
    distance: number;
    q: QuantumBase;
    edge: Edge;
  }> = [];
  for (let i = 0; i < quanta.length; i += 1) {
    const q = quanta[i];
    if (q.which < minSourceIndex) {
      continue;
    }
    for (const neighbor of q.allNeighbors) {
      if (neighbor.deleted) {
        continue;
      }
      const delta = i - neighbor.dest.which;
      if (delta > 0 && neighbor.distance < maxThreshold) {
        if (neighbor.distance <= threshold) {
          continue;
        }
        branches.push({
          branchesToTarget:
            decisionContext.branchesToTarget.get(neighbor.dest.which) ??
            Number.POSITIVE_INFINITY,
          earliestReachable:
            decisionContext.earliestByBeat.get(neighbor.dest.which) ??
            neighbor.dest.which,
          immediateBackward: delta,
          distance: neighbor.distance,
          q,
          edge: neighbor,
        });
      }
    }
  }
  if (branches.length === 0) {
    return null;
  }
  branches.sort(
    (a, b) =>
      a.branchesToTarget - b.branchesToTarget ||
      a.earliestReachable - b.earliestReachable ||
      a.distance - b.distance ||
      b.immediateBackward - a.immediateBackward,
  );
  const best = branches[0];
  best.q.neighbors.push(best.edge);
  return best.q.which;
}

function findExistingAnchorSource(
  quanta: QuantumBase[],
  minLongBranch: number,
  context?: AnchorDecisionContext,
): number | null {
  const decisionContext = context ?? buildAnchorDecisionContext(quanta);
  const minSourceIndex = Math.floor(quanta.length * 0.66);
  const tieredSource = findBestTieredAnchorSource(
    quanta,
    decisionContext,
    minSourceIndex,
    minLongBranch,
  );
  if (tieredSource !== null) {
    return tieredSource;
  }

  let bestSource = -1;
  let bestBranchesToTarget = Number.POSITIVE_INFINITY;
  let bestEarliestReachable = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestImmediate = Number.NEGATIVE_INFINITY;

  for (let i = minSourceIndex; i < quanta.length; i += 1) {
    const q = quanta[i];
    for (const neighbor of q.neighbors) {
      const immediate = q.which - neighbor.dest.which;
      if (immediate <= 0) {
        continue;
      }
      const targetBranches =
        decisionContext.branchesToTarget.get(neighbor.dest.which) ??
        Number.POSITIVE_INFINITY;
      if (targetBranches > 0) {
        continue;
      }
      const earliestReachable =
        decisionContext.earliestByBeat.get(neighbor.dest.which) ??
        neighbor.dest.which;
      if (
        targetBranches < bestBranchesToTarget ||
        (targetBranches === bestBranchesToTarget &&
          earliestReachable < bestEarliestReachable) ||
        (targetBranches === bestBranchesToTarget &&
          earliestReachable === bestEarliestReachable &&
          neighbor.distance < bestDistance) ||
        (targetBranches === bestBranchesToTarget &&
          earliestReachable === bestEarliestReachable &&
          neighbor.distance === bestDistance &&
          q.which > bestSource) ||
        (targetBranches === bestBranchesToTarget &&
          earliestReachable === bestEarliestReachable &&
          neighbor.distance === bestDistance &&
          q.which === bestSource &&
          immediate > bestImmediate)
      ) {
        bestSource = q.which;
        bestBranchesToTarget = targetBranches;
        bestEarliestReachable = earliestReachable;
        bestDistance = neighbor.distance;
        bestImmediate = immediate;
      }
    }
  }

  return bestSource >= 0 ? bestSource : null;
}

export function selectExistingAnchorSource(
  quanta: QuantumBase[],
  minLongBranch: number,
): number | null {
  return findExistingAnchorSource(quanta, minLongBranch);
}

function calculateReachability(quanta: QuantumBase[]) {
  const maxIter = 1000;
  for (const q of quanta) {
    q.reach = quanta.length - q.which;
  }
  // Propagate the furthest reachable beat through backward links and neighbors.
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changeCount = 0;
    for (let qi = 0; qi < quanta.length; qi += 1) {
      const q = quanta[qi];
      let changed = false;
      for (const neighbor of q.neighbors) {
        const q2 = neighbor.dest;
        if (
          q2.reach !== undefined &&
          q.reach !== undefined &&
          q2.reach > q.reach
        ) {
          q.reach = q2.reach;
          changed = true;
        }
      }
      if (qi < quanta.length - 1) {
        const q2 = quanta[qi + 1];
        if (
          q2.reach !== undefined &&
          q.reach !== undefined &&
          q2.reach > q.reach
        ) {
          q.reach = q2.reach;
          changed = true;
        }
      }
      if (changed) {
        changeCount += 1;
        for (let j = 0; j < q.which; j += 1) {
          const q2 = quanta[j];
          if (
            q2.reach !== undefined &&
            q.reach !== undefined &&
            q2.reach < q.reach
          ) {
            q2.reach = q.reach;
          }
        }
      }
    }
    if (changeCount === 0) {
      break;
    }
  }
}

function findBestLastBeat(
  quanta: QuantumBase[],
  context: AnchorDecisionContext,
  minLongBranch: number,
): { index: number; longestReach: number } {
  const minLastBranchIndex = Math.floor(quanta.length * 0.66);
  const tieredSource = findBestTieredAnchorSource(
    quanta,
    context,
    minLastBranchIndex,
    minLongBranch,
  );
  if (tieredSource !== null) {
    const distanceToEnd = quanta.length - tieredSource;
    const q = quanta[tieredSource];
    const reach =
      q.reach !== undefined
        ? ((q.reach - distanceToEnd) * 100) / quanta.length
        : 0;
    return { index: tieredSource, longestReach: reach };
  }
  let bestEarlyIndex = -1;
  let bestEarlyTargetBranches = Number.POSITIVE_INFINITY;
  let bestEarlyReachable = Number.POSITIVE_INFINITY;
  let bestEarlyImmediate = Number.NEGATIVE_INFINITY;
  let bestEarlyDistance = Number.POSITIVE_INFINITY;
  let bestEarlyLongestReach = 0;
  let longest = 0;
  let longestReach = 0;
  for (let i = quanta.length - 1; i >= 0; i -= 1) {
    const q = quanta[i];
    const distanceToEnd = quanta.length - i;
    const reach =
      q.reach !== undefined
        ? ((q.reach - distanceToEnd) * 100) / quanta.length
        : 0;
    const bestOutcome = selectBestBackwardNeighborOutcome(
      q,
      context.earliestByBeat,
      context.branchesToTarget,
    );
    if (bestOutcome) {
      if (
        i >= minLastBranchIndex &&
        bestOutcome.earliestReachable <= context.earlyTargetBeat &&
        (bestOutcome.branchesToTarget < bestEarlyTargetBranches ||
          (bestOutcome.branchesToTarget === bestEarlyTargetBranches &&
            bestOutcome.earliestReachable < bestEarlyReachable) ||
          (bestOutcome.branchesToTarget === bestEarlyTargetBranches &&
            bestOutcome.earliestReachable === bestEarlyReachable &&
            bestOutcome.distance < bestEarlyDistance) ||
          (bestOutcome.branchesToTarget === bestEarlyTargetBranches &&
            bestOutcome.earliestReachable === bestEarlyReachable &&
            bestOutcome.distance === bestEarlyDistance &&
            bestOutcome.immediateBackward > bestEarlyImmediate) ||
          (bestOutcome.branchesToTarget === bestEarlyTargetBranches &&
            bestOutcome.earliestReachable === bestEarlyReachable &&
            bestOutcome.distance === bestEarlyDistance &&
            bestOutcome.immediateBackward === bestEarlyImmediate &&
            i > bestEarlyIndex))
      ) {
        bestEarlyIndex = i;
        bestEarlyTargetBranches = bestOutcome.branchesToTarget;
        bestEarlyReachable = bestOutcome.earliestReachable;
        bestEarlyImmediate = bestOutcome.immediateBackward;
        bestEarlyDistance = bestOutcome.distance;
        bestEarlyLongestReach = reach;
      }
    }
    if (
      i >= minLastBranchIndex &&
      reach > longestReach &&
      q.neighbors.length > 0
    ) {
      longestReach = reach;
      longest = i;
    }
  }
  if (bestEarlyIndex >= 0) {
    return { index: bestEarlyIndex, longestReach: bestEarlyLongestReach };
  }
  return { index: longest, longestReach };
}

function filterOutBadBranches(quanta: QuantumBase[], lastIndex: number) {
  for (let i = 0; i < lastIndex; i += 1) {
    const q = quanta[i];
    q.neighbors = q.neighbors.filter(
      (neighbor) => neighbor.dest.which < lastIndex,
    );
  }
}

function hasSequentialBranch(
  q: QuantumBase,
  neighbor: Edge,
  lastBranchPoint: number,
) {
  if (q.which === lastBranchPoint) {
    return false;
  }
  const qp = q.prev;
  if (!qp) {
    return false;
  }
  const distance = q.which - neighbor.dest.which;
  for (const prevNeighbor of qp.neighbors) {
    const odistance = qp.which - prevNeighbor.dest.which;
    if (distance === odistance) {
      return true;
    }
  }
  return false;
}

function filterOutSequentialBranches(
  quanta: QuantumBase[],
  lastBranchPoint: number,
) {
  for (let i = quanta.length - 1; i >= 1; i -= 1) {
    const q = quanta[i];
    q.neighbors = q.neighbors.filter(
      (neighbor) => !hasSequentialBranch(q, neighbor, lastBranchPoint),
    );
  }
}

function computeDefaultThreshold(
  quanta: QuantumBase[],
  config: JukeboxConfig,
): number {
  const targetBranchCount = quanta.length / 6;
  for (let t = 10; t < config.maxBranchThreshold; t += 5) {
    const count = collectNearestNeighbors(quanta, t, config);
    if (count >= targetBranchCount) {
      return t;
    }
  }
  return config.maxBranchThreshold;
}

function addAnchorBranch(
  quanta: QuantumBase[],
  threshold: number,
  config: JukeboxConfig,
): number | null {
  const decisionContext = buildAnchorDecisionContext(quanta);
  const preferredLateStart = Math.floor(quanta.length * 0.8);
  const maxAnchorThreshold = longestBackwardBranch(quanta) < 50 ? 65 : 55;
  const existingAnchorSource = findExistingAnchorSource(
    quanta,
    config.minLongBranch,
    decisionContext,
  );
  if (existingAnchorSource !== null && existingAnchorSource >= preferredLateStart) {
    // Existing end-of-track branch already reaches the early target zone.
    return existingAnchorSource;
  }
  const lateInsertedSource = insertBestBackwardBranch(
    quanta,
    threshold,
    maxAnchorThreshold,
    preferredLateStart,
    decisionContext,
  );
  if (lateInsertedSource !== null) {
    return lateInsertedSource;
  }
  if (existingAnchorSource !== null) {
    return existingAnchorSource;
  }
  return insertBestBackwardBranch(
    quanta,
    threshold,
    maxAnchorThreshold,
    Math.floor(quanta.length * 0.66),
    decisionContext,
  );
}

function applyBranchFilters(
  quanta: QuantumBase[],
  config: JukeboxConfig,
  preferredLastBranchPoint: number | null,
): { lastBranchPoint: number; longestReach: number } {
  calculateReachability(quanta);
  const decisionContext = buildAnchorDecisionContext(quanta);
  let selectedLastBranchPoint: number;
  let selectedLongestReach: number;
  if (
    preferredLastBranchPoint !== null &&
    preferredLastBranchPoint >= 0 &&
    preferredLastBranchPoint < quanta.length &&
    quanta[preferredLastBranchPoint].neighbors.length > 0
  ) {
    const q = quanta[preferredLastBranchPoint];
    const preferredOutcome = selectBestBackwardNeighborOutcome(
      q,
      decisionContext.earliestByBeat,
      decisionContext.branchesToTarget,
    );
    const preferredCanReachTarget =
      preferredOutcome !== null &&
      Number.isFinite(preferredOutcome.branchesToTarget);
    if (!preferredCanReachTarget) {
      selectedLastBranchPoint = -1;
      selectedLongestReach = 0;
    } else {
      const distanceToEnd = quanta.length - preferredLastBranchPoint;
      selectedLastBranchPoint = preferredLastBranchPoint;
      selectedLongestReach =
        q.reach !== undefined
          ? ((q.reach - distanceToEnd) * 100) / quanta.length
          : 0;
    }
  } else {
    const hasEligibleAnchorSource =
      findExistingAnchorSource(quanta, config.minLongBranch, decisionContext) !==
      null;
    if (!hasEligibleAnchorSource) {
      selectedLastBranchPoint = -1;
      selectedLongestReach = 0;
    } else {
      const { index, longestReach } = findBestLastBeat(
        quanta,
        decisionContext,
        config.minLongBranch,
      );
      selectedLastBranchPoint = index;
      selectedLongestReach = longestReach;
    }
  }
  filterOutBadBranches(quanta, selectedLastBranchPoint);
  if (config.removeSequentialBranches) {
    filterOutSequentialBranches(quanta, selectedLastBranchPoint);
  }
  return { lastBranchPoint: selectedLastBranchPoint, longestReach: selectedLongestReach };
}

export function buildJumpGraph(
  analysis: TrackAnalysis,
  config: JukeboxConfig,
): JukeboxGraphState {
  const quanta = analysis.beats;
  const allEdges: Edge[] = [];
  precalculateNearestNeighbors(
    quanta,
    config.maxBranches,
    config.maxBranchThreshold,
    allEdges,
  );

  const computedThreshold = computeDefaultThreshold(quanta, config);
  const threshold =
    config.currentThreshold !== 0
      ? config.currentThreshold
      : computedThreshold;
  collectNearestNeighbors(quanta, threshold, config);
  const preferredLastBranchPoint = addAnchorBranch(quanta, threshold, config);
  const { lastBranchPoint, longestReach } = applyBranchFilters(
    quanta,
    config,
    preferredLastBranchPoint,
  );

  return {
    computedThreshold,
    currentThreshold: threshold,
    lastBranchPoint,
    totalBeats: quanta.length,
    longestReach,
    allEdges,
  };
}

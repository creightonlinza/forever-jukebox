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

function insertBestBackwardBranch(
  quanta: QuantumBase[],
  threshold: number,
  maxThreshold: number,
) {
  const branches: Array<[number, QuantumBase, Edge]> = [];
  for (let i = 0; i < quanta.length; i += 1) {
    const q = quanta[i];
    for (const neighbor of q.allNeighbors) {
      if (neighbor.deleted) {
        continue;
      }
      const delta = i - neighbor.dest.which;
      if (delta > 0 && neighbor.distance < maxThreshold) {
        const percent = (delta * 100) / quanta.length;
        branches.push([percent, q, neighbor]);
      }
    }
  }
  if (branches.length === 0) {
    return;
  }
  branches.sort((a, b) => a[0] - b[0]);
  branches.reverse();
  const [_, bestQ, bestNeighbor] = branches[0];
  if (bestNeighbor.distance > threshold) {
    bestQ.neighbors.push(bestNeighbor);
  }
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
): { index: number; longestReach: number } {
  const reachThreshold = 50;
  let longest = 0;
  let longestReach = 0;
  for (let i = quanta.length - 1; i >= 0; i -= 1) {
    const q = quanta[i];
    const distanceToEnd = quanta.length - i;
    const reach =
      q.reach !== undefined
        ? ((q.reach - distanceToEnd) * 100) / quanta.length
        : 0;
    if (reach > longestReach && q.neighbors.length > 0) {
      longestReach = reach;
      longest = i;
      if (reach >= reachThreshold) {
        break;
      }
    }
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
) {
  if (!config.addLastEdge) {
    return;
  }
  if (longestBackwardBranch(quanta) < 50) {
    insertBestBackwardBranch(quanta, threshold, 65);
  } else {
    insertBestBackwardBranch(quanta, threshold, 55);
  }
}

function applyBranchFilters(
  quanta: QuantumBase[],
  config: JukeboxConfig,
): { lastBranchPoint: number; longestReach: number } {
  calculateReachability(quanta);
  const { index: lastBranchPoint, longestReach } = findBestLastBeat(quanta);
  filterOutBadBranches(quanta, lastBranchPoint);
  if (config.removeSequentialBranches) {
    filterOutSequentialBranches(quanta, lastBranchPoint);
  }
  return { lastBranchPoint, longestReach };
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
  addAnchorBranch(quanta, threshold, config);
  const { lastBranchPoint, longestReach } = applyBranchFilters(quanta, config);

  return {
    computedThreshold,
    currentThreshold: threshold,
    lastBranchPoint,
    totalBeats: quanta.length,
    longestReach,
    allEdges,
  };
}

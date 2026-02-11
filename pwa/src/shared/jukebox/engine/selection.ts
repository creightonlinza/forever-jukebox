// Copied from web/src/engine/selection.ts on 2026-02-11, reason: reuse beat selection logic.
import { JukeboxConfig, JukeboxGraphState, QuantumBase } from "./types";

export interface BranchState {
  curRandomBranchChance: number;
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
  const nextEdge = seed.neighbors.shift();
  if (!nextEdge) {
    return { index: seed.which, jumped: false };
  }
  seed.neighbors.push(nextEdge);
  const nextIndex = nextEdge.dest.which;
  return { index: nextIndex, jumped: nextIndex !== seed.which };
}

package com.foreverjukebox.app.engine

data class BranchState(var curRandomBranchChance: Double)

private const val REFERENCE_BEAT_DURATION_SECONDS = 0.5

private fun collectTimeline(seed: QuantumBase): List<QuantumBase> {
    var start = seed
    while (start.prev != null) {
        start = start.prev!!
    }
    val beats = mutableListOf<QuantumBase>()
    val seen = mutableSetOf<Int>()
    var current: QuantumBase? = start
    while (current != null && !seen.contains(current.which)) {
        beats.add(current)
        seen.add(current.which)
        current = current.next
    }
    return beats
}

private fun computeEarliestReachableByBeat(
    beats: List<QuantumBase>
): Map<Int, Int> {
    val earliest = mutableMapOf<Int, Int>()
    for (beat in beats) {
        earliest[beat.which] = beat.which
    }

    // Relax backwards across the timeline to account for linear progression and branches.
    for (iter in beats.indices) {
        var changed = false
        for (i in beats.size - 1 downTo 0) {
            val beat = beats[i]
            val current = earliest[beat.which] ?: beat.which
            var best = current
            val next = beat.next
            if (next != null) {
                best = minOf(best, earliest[next.which] ?: next.which)
            }
            for (edge in beat.neighbors) {
                best = minOf(best, earliest[edge.dest.which] ?: edge.dest.which)
            }
            if (best < current) {
                earliest[beat.which] = best
                changed = true
            }
        }
        if (!changed) {
            break
        }
    }
    return earliest
}

private fun resolveEarlyTargetBeat(
    beats: List<QuantumBase>,
    fallbackPct: Int = 25
): Int {
    val fallbackBeat = (beats.size * fallbackPct) / 100
    val lateSourceStart = (beats.size * 66) / 100
    var firstBackwardDestination = Int.MAX_VALUE
    var firstLateBackwardDestination = Int.MAX_VALUE
    for (beat in beats) {
        for (edge in beat.neighbors) {
            if (edge.dest.which < beat.which &&
                edge.dest.which < firstBackwardDestination
            ) {
                firstBackwardDestination = edge.dest.which
            }
            if (beat.which >= lateSourceStart &&
                edge.dest.which < beat.which &&
                edge.dest.which < firstLateBackwardDestination
            ) {
                firstLateBackwardDestination = edge.dest.which
            }
        }
    }
    if (firstBackwardDestination == Int.MAX_VALUE &&
        firstLateBackwardDestination == Int.MAX_VALUE
    ) {
        return fallbackBeat
    }
    return maxOf(
        fallbackBeat,
        if (firstBackwardDestination == Int.MAX_VALUE) 0 else firstBackwardDestination,
        if (firstLateBackwardDestination == Int.MAX_VALUE) 0 else firstLateBackwardDestination
    )
}

private fun computeBranchesToEarlyTarget(
    beats: List<QuantumBase>,
    earlyTargetBeat: Int
): Map<Int, Int> {
    val branchesNeeded = mutableMapOf<Int, Int>()
    for (beat in beats) {
        branchesNeeded[beat.which] = if (beat.which <= earlyTargetBeat) {
            0
        } else {
            Int.MAX_VALUE
        }
    }
    for (iter in beats.indices) {
        var changed = false
        for (i in beats.size - 1 downTo 0) {
            val beat = beats[i]
            var best = branchesNeeded[beat.which] ?: Int.MAX_VALUE
            if (beat.next != null) {
                best = minOf(best, branchesNeeded[beat.next!!.which] ?: Int.MAX_VALUE)
            }
            for (edge in beat.neighbors) {
                val destCost = branchesNeeded[edge.dest.which] ?: Int.MAX_VALUE
                if (destCost != Int.MAX_VALUE) {
                    best = minOf(best, destCost + 1)
                }
            }
            val current = branchesNeeded[beat.which] ?: Int.MAX_VALUE
            if (best < current) {
                branchesNeeded[beat.which] = best
                changed = true
            }
        }
        if (!changed) {
            break
        }
    }
    return branchesNeeded
}

fun getBestLastBranchNeighborIndex(seed: QuantumBase): Int {
    val beats = collectTimeline(seed)
    val earlyTargetBeat = resolveEarlyTargetBeat(beats, 25)
    val earliestByBeat = computeEarliestReachableByBeat(beats)
    val branchesToTarget = computeBranchesToEarlyTarget(beats, earlyTargetBeat)
    val hasBackwardNeighbor = seed.neighbors.any { edge ->
        edge.dest.which < seed.which
    }
    var bestIndex = 0
    var bestBranchesToTarget = Int.MAX_VALUE
    var bestEarliest = Int.MAX_VALUE
    var bestDistance = Double.POSITIVE_INFINITY
    var bestImmediate = Int.MIN_VALUE
    for (i in seed.neighbors.indices) {
        val edge = seed.neighbors[i]
        val immediate = seed.which - edge.dest.which
        if (hasBackwardNeighbor && immediate <= 0) {
            continue
        }
        val targetBranches = branchesToTarget[edge.dest.which] ?: Int.MAX_VALUE
        val earliest = earliestByBeat[edge.dest.which] ?: edge.dest.which
        if (targetBranches < bestBranchesToTarget ||
            (targetBranches == bestBranchesToTarget && earliest < bestEarliest) ||
            (targetBranches == bestBranchesToTarget &&
                earliest == bestEarliest &&
                edge.distance < bestDistance) ||
            (targetBranches == bestBranchesToTarget &&
                earliest == bestEarliest &&
                edge.distance == bestDistance &&
                immediate > bestImmediate)
        ) {
            bestIndex = i
            bestBranchesToTarget = targetBranches
            bestEarliest = earliest
            bestDistance = edge.distance
            bestImmediate = immediate
        }
    }
    return bestIndex
}

fun shouldRandomBranch(
    q: QuantumBase,
    graph: JukeboxGraphState,
    config: JukeboxConfig,
    rng: () -> Double,
    state: BranchState
): Boolean {
    if (q.which == graph.lastBranchPoint) {
        return true
    }
    // Gradually increase branch chance by elapsed musical time (not raw beat
    // count), so fast songs do not ramp jump probability disproportionately.
    val beatDuration = if (q.duration.isFinite() && q.duration > 0.0) {
        q.duration
    } else {
        REFERENCE_BEAT_DURATION_SECONDS
    }
    val tempoNormalizedDelta = config.randomBranchChanceDelta *
        (beatDuration / REFERENCE_BEAT_DURATION_SECONDS)
    state.curRandomBranchChance = (state.curRandomBranchChance + tempoNormalizedDelta)
        .coerceAtMost(config.maxRandomBranchChance)
    val shouldBranch = rng() < state.curRandomBranchChance
    if (shouldBranch) {
        state.curRandomBranchChance = config.minRandomBranchChance
    }
    return shouldBranch
}

fun selectNextBeatIndex(
    seed: QuantumBase,
    graph: JukeboxGraphState,
    config: JukeboxConfig,
    rng: () -> Double,
    state: BranchState,
    forceBranch: Boolean
): Pair<Int, Boolean> {
    if (seed.neighbors.isEmpty()) {
        return seed.which to false
    }
    if (!forceBranch && !shouldRandomBranch(seed, graph, config, rng, state)) {
        return seed.which to false
    }
    val nextEdge = if (seed.which == graph.lastBranchPoint) {
        val bestIndex = getBestLastBranchNeighborIndex(seed)
        if (bestIndex in seed.neighbors.indices) {
            seed.neighbors.removeAt(bestIndex)
        } else {
            seed.neighbors.removeFirstOrNull()
        }
    } else {
        seed.neighbors.removeFirstOrNull()
    } ?: return seed.which to false
    seed.neighbors.add(nextEdge)
    val nextIndex = nextEdge.dest.which
    return nextIndex to (nextIndex != seed.which)
}

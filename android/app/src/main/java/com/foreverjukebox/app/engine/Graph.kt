package com.foreverjukebox.app.engine

import kotlin.math.floor
import kotlin.math.max

private const val TIMBRE_WEIGHT = 1.0
private const val PITCH_WEIGHT = 10.0
private const val LOUD_START_WEIGHT = 1.0
private const val LOUD_MAX_WEIGHT = 1.0
private const val DURATION_WEIGHT = 100.0
private const val CONFIDENCE_WEIGHT = 1.0
private const val MAX_DISTANCE = 100.0
private const val FULL_MATCH_DISTANCE = 0.0
private const val TARGET_BRANCH_DIVISOR = 6
private const val THRESHOLD_START = 10
private const val THRESHOLD_STEP = 5

private fun euclideanDistance(v1: List<Double>, v2: List<Double>): Double {
    var sum = 0.0
    for (i in v1.indices) {
        val delta = v2[i] - v1[i]
        sum += delta * delta
    }
    return kotlin.math.sqrt(sum)
}

private fun segmentDistance(seg1: Segment, seg2: Segment): Double {
    val timbre = euclideanDistance(seg1.timbre, seg2.timbre)
    val pitch = euclideanDistance(seg1.pitches, seg2.pitches)
    val loudStart = kotlin.math.abs(seg1.loudnessStart - seg2.loudnessStart)
    val loudMax = kotlin.math.abs(seg1.loudnessMax - seg2.loudnessMax)
    val duration = kotlin.math.abs(seg1.duration - seg2.duration)
    val confidence = kotlin.math.abs(seg1.confidence - seg2.confidence)
    return timbre * TIMBRE_WEIGHT +
        pitch * PITCH_WEIGHT +
        loudStart * LOUD_START_WEIGHT +
        loudMax * LOUD_MAX_WEIGHT +
        duration * DURATION_WEIGHT +
        confidence * CONFIDENCE_WEIGHT
}

private fun calculateNearestNeighborsForQuantum(
    quanta: List<QuantumBase>,
    maxNeighbors: Int,
    maxThreshold: Int,
    q1: QuantumBase,
    allEdges: MutableList<Edge>
) {
    val edges = mutableListOf<Edge>()
    if (q1.overlappingSegments.isEmpty()) {
        q1.allNeighbors = mutableListOf()
        return
    }

    for (i in quanta.indices) {
        if (i == q1.which) continue
        val q2 = quanta[i]
        var sum = 0.0
        for (j in q1.overlappingSegments.indices) {
            val seg1 = q1.overlappingSegments[j]
            val distance = if (j < q2.overlappingSegments.size) {
                val seg2 = q2.overlappingSegments[j]
                if (seg1.which == seg2.which) {
                    MAX_DISTANCE
                } else {
                    segmentDistance(seg1, seg2)
                }
            } else {
                MAX_DISTANCE
            }
            sum += distance
        }

        val pdistance = if (
            q1.indexInParent != null &&
            q2.indexInParent != null &&
            q1.indexInParent == q2.indexInParent
        ) {
            FULL_MATCH_DISTANCE
        } else {
            MAX_DISTANCE
        }

        val totalDistance = sum / q1.overlappingSegments.size + pdistance
        if (totalDistance < maxThreshold) {
            edges.add(
                Edge(
                    id = -1,
                    src = q1,
                    dest = q2,
                    distance = totalDistance,
                    deleted = false
                )
            )
        }
    }

    edges.sortBy { it.distance }

    q1.allNeighbors = mutableListOf()
    for (i in 0 until kotlin.math.min(maxNeighbors, edges.size)) {
        val edge = edges[i]
        edge.id = allEdges.size
        allEdges.add(edge)
        q1.allNeighbors.add(edge)
    }
}

private fun precalculateNearestNeighbors(
    quanta: List<QuantumBase>,
    maxNeighbors: Int,
    maxThreshold: Int,
    allEdges: MutableList<Edge>
) {
    if (quanta.isEmpty()) return
    if (quanta[0].allNeighbors.isNotEmpty()) {
        allEdges.clear()
        for (q in quanta) {
            for (edge in q.allNeighbors) {
                allEdges.add(edge)
            }
        }
        return
    }
    allEdges.clear()
    for (q in quanta) {
        calculateNearestNeighborsForQuantum(quanta, maxNeighbors, maxThreshold, q, allEdges)
    }
}

private fun extractNearestNeighbors(
    q: QuantumBase,
    maxThreshold: Int,
    config: JukeboxConfig
): MutableList<Edge> {
    val neighbors = mutableListOf<Edge>()
    for (neighbor in q.allNeighbors) {
        if (neighbor.deleted) continue
        if (config.justBackwards && neighbor.dest.which > q.which) continue
        if (config.justLongBranches &&
            kotlin.math.abs(neighbor.dest.which - q.which) < config.minLongBranch
        ) {
            continue
        }
        if (neighbor.distance <= maxThreshold) {
            neighbors.add(neighbor)
        }
    }
    return neighbors
}

private fun collectNearestNeighbors(
    quanta: List<QuantumBase>,
    maxThreshold: Int,
    config: JukeboxConfig
): Int {
    var branchingCount = 0
    for (q in quanta) {
        q.neighbors = extractNearestNeighbors(q, maxThreshold, config)
        if (q.neighbors.isNotEmpty()) {
            branchingCount += 1
        }
    }
    return branchingCount
}

private fun longestBackwardBranch(quanta: List<QuantumBase>): Double {
    var longest = 0
    for (i in quanta.indices) {
        val q = quanta[i]
        for (neighbor in q.neighbors) {
            val delta = i - neighbor.dest.which
            if (delta > longest) {
                longest = delta
            }
        }
    }
    return (longest * 100.0) / quanta.size
}

private fun calculateEarliestReachableByBeat(quanta: List<QuantumBase>): Map<Int, Int> {
    val earliest = mutableMapOf<Int, Int>()
    for (q in quanta) {
        earliest[q.which] = q.which
    }
    val maxIter = quanta.size
    for (iter in 0 until maxIter) {
        var changed = false
        for (i in quanta.size - 1 downTo 0) {
            val q = quanta[i]
            val current = earliest[q.which] ?: q.which
            var best = current
            if (q.next != null) {
                best = minOf(best, earliest[q.next!!.which] ?: q.next!!.which)
            }
            for (neighbor in q.neighbors) {
                best = minOf(best, earliest[neighbor.dest.which] ?: neighbor.dest.which)
            }
            if (best < current) {
                earliest[q.which] = best
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
    quanta: List<QuantumBase>,
    fallbackPct: Int
): Int {
    val fallbackBeat = (quanta.size * fallbackPct) / 100
    val lateSourceStart = floor(quanta.size * 0.66).toInt()
    var firstBackwardDestination = Int.MAX_VALUE
    var firstLateBackwardDestination = Int.MAX_VALUE
    for (q in quanta) {
        for (neighbor in q.neighbors) {
            if (neighbor.dest.which < q.which &&
                neighbor.dest.which < firstBackwardDestination
            ) {
                firstBackwardDestination = neighbor.dest.which
            }
            if (q.which >= lateSourceStart &&
                neighbor.dest.which < q.which &&
                neighbor.dest.which < firstLateBackwardDestination
            ) {
                firstLateBackwardDestination = neighbor.dest.which
            }
        }
    }
    if (firstBackwardDestination == Int.MAX_VALUE &&
        firstLateBackwardDestination == Int.MAX_VALUE
    ) {
        return fallbackBeat
    }
    return max(
        fallbackBeat,
        max(
            if (firstBackwardDestination == Int.MAX_VALUE) 0 else firstBackwardDestination,
            if (firstLateBackwardDestination == Int.MAX_VALUE) 0 else firstLateBackwardDestination
        )
    )
}

private data class NeighborOutcome(
    val branchesToTarget: Int,
    val earliestReachable: Int,
    val immediateBackward: Int,
    val distance: Double
)

private data class AnchorTierRule(
    val maxAdditionalBranches: Int,
    val minImmediateBackward: Int
)

private fun calculateBranchesToEarlyTarget(
    quanta: List<QuantumBase>,
    earlyTargetBeat: Int
): Map<Int, Int> {
    val branchesNeeded = mutableMapOf<Int, Int>()
    for (q in quanta) {
        branchesNeeded[q.which] = if (q.which <= earlyTargetBeat) {
            0
        } else {
            Int.MAX_VALUE
        }
    }
    val maxIter = quanta.size
    for (iter in 0 until maxIter) {
        var changed = false
        for (i in quanta.size - 1 downTo 0) {
            val q = quanta[i]
            var best = branchesNeeded[q.which] ?: Int.MAX_VALUE
            if (q.next != null) {
                best = minOf(best, branchesNeeded[q.next!!.which] ?: Int.MAX_VALUE)
            }
            for (neighbor in q.neighbors) {
                val destCost = branchesNeeded[neighbor.dest.which] ?: Int.MAX_VALUE
                if (destCost != Int.MAX_VALUE) {
                    best = minOf(best, destCost + 1)
                }
            }
            val current = branchesNeeded[q.which] ?: Int.MAX_VALUE
            if (best < current) {
                branchesNeeded[q.which] = best
                changed = true
            }
        }
        if (!changed) {
            break
        }
    }
    return branchesNeeded
}

private fun selectBestBackwardNeighborOutcome(
    q: QuantumBase,
    earliestByBeat: Map<Int, Int>,
    branchesToTarget: Map<Int, Int>
): NeighborOutcome? {
    var best: NeighborOutcome? = null
    for (neighbor in q.neighbors) {
        val immediateBackward = q.which - neighbor.dest.which
        if (immediateBackward <= 0) {
            continue
        }
        val candidate = NeighborOutcome(
            branchesToTarget = branchesToTarget[neighbor.dest.which] ?: Int.MAX_VALUE,
            earliestReachable = earliestByBeat[neighbor.dest.which] ?: neighbor.dest.which,
            immediateBackward = immediateBackward,
            distance = neighbor.distance
        )
        if (best == null ||
            candidate.branchesToTarget < best.branchesToTarget ||
            (candidate.branchesToTarget == best.branchesToTarget &&
                candidate.earliestReachable < best.earliestReachable) ||
            (candidate.branchesToTarget == best.branchesToTarget &&
                candidate.earliestReachable == best.earliestReachable &&
                candidate.distance < best.distance) ||
            (candidate.branchesToTarget == best.branchesToTarget &&
                candidate.earliestReachable == best.earliestReachable &&
                candidate.distance == best.distance &&
                candidate.immediateBackward > best.immediateBackward)
        ) {
            best = candidate
        }
    }
    return best
}

private fun buildAnchorTierRules(minLongBranch: Int): List<AnchorTierRule> {
    return listOf(
        // best: direct or one-hop return with a long jump
        AnchorTierRule(
            maxAdditionalBranches = 1,
            minImmediateBackward = minLongBranch
        ),
        // good: allow one extra hop and a medium jump
        AnchorTierRule(
            maxAdditionalBranches = 2,
            minImmediateBackward = max(2, floor(minLongBranch * 0.5).toInt())
        ),
        // ok: allow deeper chaining as long as there is still a meaningful back jump
        AnchorTierRule(
            maxAdditionalBranches = 3,
            minImmediateBackward = max(1, floor(minLongBranch * 0.25).toInt())
        )
    )
}

private fun findLatestTieredAnchorSource(
    quanta: List<QuantumBase>,
    earliestByBeat: Map<Int, Int>,
    branchesToTarget: Map<Int, Int>,
    earlyTargetBeat: Int,
    minSourceIndex: Int,
    minLongBranch: Int
): Int? {
    val rules = buildAnchorTierRules(minLongBranch)
    val preferredLateStart = max(
        minSourceIndex,
        floor(quanta.size * 0.8).toInt()
    )
    val ranges = listOf(
        preferredLateStart to (quanta.size - 1),
        minSourceIndex to (preferredLateStart - 1)
    )
    for (rule in rules) {
        for ((start, end) in ranges) {
            if (end < start) {
                continue
            }
            for (i in end downTo start) {
                val q = quanta[i]
                val bestOutcome = selectBestBackwardNeighborOutcome(
                    q,
                    earliestByBeat,
                    branchesToTarget
                )
                if (bestOutcome != null &&
                    bestOutcome.branchesToTarget <= rule.maxAdditionalBranches &&
                    bestOutcome.earliestReachable <= earlyTargetBeat &&
                    bestOutcome.immediateBackward >= rule.minImmediateBackward
                ) {
                    return i
                }
            }
        }
    }
    return null
}

private data class BranchCandidate(
    val branchesToTarget: Int,
    val earliestReachable: Int,
    val immediateBackward: Int,
    val distance: Double,
    val q: QuantumBase,
    val edge: Edge
)

private fun insertBestBackwardBranch(
    quanta: List<QuantumBase>,
    threshold: Int,
    maxThreshold: Int,
    minSourceIndex: Int = floor(quanta.size * 0.66).toInt()
): Int? {
    val earlyTargetBeat = resolveEarlyTargetBeat(quanta, 25)
    val branchesToTarget = calculateBranchesToEarlyTarget(quanta, earlyTargetBeat)
    val earliestByBeat = calculateEarliestReachableByBeat(quanta)
    val branches = mutableListOf<BranchCandidate>()
    for (i in quanta.indices) {
        val q = quanta[i]
        if (q.which < minSourceIndex) {
            continue
        }
        for (neighbor in q.allNeighbors) {
            if (neighbor.deleted) {
                continue
            }
            val delta = i - neighbor.dest.which
            if (delta > 0 && neighbor.distance < maxThreshold) {
                if (neighbor.distance <= threshold) {
                    continue
                }
                branches.add(
                    BranchCandidate(
                        branchesToTarget = branchesToTarget[neighbor.dest.which] ?: Int.MAX_VALUE,
                        earliestReachable = earliestByBeat[neighbor.dest.which] ?: neighbor.dest.which,
                        immediateBackward = delta,
                        distance = neighbor.distance,
                        q = q,
                        edge = neighbor
                    )
                )
            }
        }
    }
    if (branches.isEmpty()) {
        return null
    }
    branches.sortWith(
        compareBy<BranchCandidate> { it.branchesToTarget }
            .thenBy { it.earliestReachable }
            .thenBy { it.distance }
            .thenByDescending { it.immediateBackward }
    )
    val best = branches.first()
    best.q.neighbors.add(best.edge)
    return best.q.which
}

private fun findExistingAnchorSource(
    quanta: List<QuantumBase>,
    minLongBranch: Int
): Int? {
    val minSourceIndex = floor(quanta.size * 0.66).toInt()
    val earlyTargetBeat = resolveEarlyTargetBeat(quanta, 25)
    val branchesToTarget = calculateBranchesToEarlyTarget(quanta, earlyTargetBeat)
    val earliestByBeat = calculateEarliestReachableByBeat(quanta)

    val tieredSource = findLatestTieredAnchorSource(
        quanta,
        earliestByBeat,
        branchesToTarget,
        earlyTargetBeat,
        minSourceIndex,
        minLongBranch
    )
    if (tieredSource != null) {
        return tieredSource
    }

    var bestSource = -1
    var bestBranchesToTarget = Int.MAX_VALUE
    var bestEarliestReachable = Int.MAX_VALUE
    var bestDistance = Double.POSITIVE_INFINITY
    var bestImmediate = Int.MIN_VALUE

    for (i in minSourceIndex until quanta.size) {
        val q = quanta[i]
        for (neighbor in q.neighbors) {
            val immediate = q.which - neighbor.dest.which
            if (immediate <= 0) {
                continue
            }
            val targetBranches = branchesToTarget[neighbor.dest.which] ?: Int.MAX_VALUE
            if (targetBranches > 0) {
                continue
            }
            val earliestReachable = earliestByBeat[neighbor.dest.which] ?: neighbor.dest.which
            if (targetBranches < bestBranchesToTarget ||
                (targetBranches == bestBranchesToTarget &&
                    earliestReachable < bestEarliestReachable) ||
                (targetBranches == bestBranchesToTarget &&
                    earliestReachable == bestEarliestReachable &&
                    neighbor.distance < bestDistance) ||
                (targetBranches == bestBranchesToTarget &&
                    earliestReachable == bestEarliestReachable &&
                    neighbor.distance == bestDistance &&
                    q.which > bestSource) ||
                (targetBranches == bestBranchesToTarget &&
                    earliestReachable == bestEarliestReachable &&
                    neighbor.distance == bestDistance &&
                    q.which == bestSource &&
                    immediate > bestImmediate)
            ) {
                bestSource = q.which
                bestBranchesToTarget = targetBranches
                bestEarliestReachable = earliestReachable
                bestDistance = neighbor.distance
                bestImmediate = immediate
            }
        }
    }

    return if (bestSource >= 0) bestSource else null
}

private fun calculateReachability(quanta: List<QuantumBase>) {
    val maxIter = 1000
    for (q in quanta) {
        q.reach = quanta.size - q.which
    }
    // Propagate the furthest reachable beat through backward links and neighbors.
    for (iter in 0 until maxIter) {
        var changeCount = 0
        for (qi in quanta.indices) {
            val q = quanta[qi]
            var changed = false
            for (neighbor in q.neighbors) {
                val q2 = neighbor.dest
                val q2Reach = q2.reach ?: continue
                val qReach = q.reach ?: continue
                if (q2Reach > qReach) {
                    q.reach = q2Reach
                    changed = true
                }
            }
            if (qi < quanta.size - 1) {
                val q2 = quanta[qi + 1]
                val q2Reach = q2.reach ?: continue
                val qReach = q.reach ?: continue
                if (q2Reach > qReach) {
                    q.reach = q2Reach
                    changed = true
                }
            }
            if (changed) {
                changeCount += 1
                for (j in 0 until q.which) {
                    val q2 = quanta[j]
                    val q2Reach = q2.reach ?: continue
                    val qReach = q.reach ?: continue
                    if (q2Reach < qReach) {
                        q2.reach = qReach
                    }
                }
            }
        }
        if (changeCount == 0) {
            break
        }
    }
}

private fun findBestLastBeat(
    quanta: List<QuantumBase>,
    earliestByBeat: Map<Int, Int>,
    branchesToTarget: Map<Int, Int>,
    earlyTargetBeat: Int,
    minLongBranch: Int
): Pair<Int, Double> {
    val minLastBranchIndex = floor(quanta.size * 0.66).toInt()
    val tieredSource = findLatestTieredAnchorSource(
        quanta,
        earliestByBeat,
        branchesToTarget,
        earlyTargetBeat,
        minLastBranchIndex,
        minLongBranch
    )
    if (tieredSource != null) {
        val distanceToEnd = quanta.size - tieredSource
        val q = quanta[tieredSource]
        val reach = if (q.reach != null) {
            ((q.reach!! - distanceToEnd) * 100.0) / quanta.size
        } else {
            0.0
        }
        return tieredSource to reach
    }
    var bestEarlyIndex = -1
    var bestEarlyTargetBranches = Int.MAX_VALUE
    var bestEarlyReachable = Int.MAX_VALUE
    var bestEarlyImmediate = Int.MIN_VALUE
    var bestEarlyDistance = Double.POSITIVE_INFINITY
    var bestEarlyLongestReach = 0.0
    var longest = 0
    var longestReach = 0.0
    for (i in quanta.size - 1 downTo 0) {
        val q = quanta[i]
        val distanceToEnd = quanta.size - i
        val reach = if (q.reach != null) {
            ((q.reach!! - distanceToEnd) * 100.0) / quanta.size
        } else {
            0.0
        }
        val bestOutcome = selectBestBackwardNeighborOutcome(
            q,
            earliestByBeat,
            branchesToTarget
        )
        if (bestOutcome != null) {
            if (i >= minLastBranchIndex &&
                bestOutcome.earliestReachable <= earlyTargetBeat &&
                (bestOutcome.branchesToTarget < bestEarlyTargetBranches ||
                    (bestOutcome.branchesToTarget == bestEarlyTargetBranches &&
                        bestOutcome.earliestReachable < bestEarlyReachable) ||
                    (bestOutcome.branchesToTarget == bestEarlyTargetBranches &&
                        bestOutcome.earliestReachable == bestEarlyReachable &&
                        bestOutcome.distance < bestEarlyDistance) ||
                    (bestOutcome.branchesToTarget == bestEarlyTargetBranches &&
                        bestOutcome.earliestReachable == bestEarlyReachable &&
                        bestOutcome.distance == bestEarlyDistance &&
                        bestOutcome.immediateBackward > bestEarlyImmediate) ||
                    (bestOutcome.branchesToTarget == bestEarlyTargetBranches &&
                        bestOutcome.earliestReachable == bestEarlyReachable &&
                        bestOutcome.distance == bestEarlyDistance &&
                        bestOutcome.immediateBackward == bestEarlyImmediate &&
                        i > bestEarlyIndex))
            ) {
                bestEarlyIndex = i
                bestEarlyTargetBranches = bestOutcome.branchesToTarget
                bestEarlyReachable = bestOutcome.earliestReachable
                bestEarlyImmediate = bestOutcome.immediateBackward
                bestEarlyDistance = bestOutcome.distance
                bestEarlyLongestReach = reach
            }
        }
        if (i >= minLastBranchIndex &&
            reach > longestReach &&
            q.neighbors.isNotEmpty()
        ) {
            longestReach = reach
            longest = i
        }
    }
    return if (bestEarlyIndex >= 0) {
        bestEarlyIndex to bestEarlyLongestReach
    } else {
        longest to longestReach
    }
}

private fun filterOutBadBranches(quanta: List<QuantumBase>, lastIndex: Int) {
    for (i in 0 until lastIndex) {
        val q = quanta[i]
        q.neighbors = q.neighbors.filter { neighbor ->
            neighbor.dest.which < lastIndex
        }.toMutableList()
    }
}

private fun hasSequentialBranch(q: QuantumBase, neighbor: Edge, lastBranchPoint: Int): Boolean {
    if (q.which == lastBranchPoint) return false
    val qp = q.prev ?: return false
    val distance = q.which - neighbor.dest.which
    for (prevNeighbor in qp.neighbors) {
        val odistance = qp.which - prevNeighbor.dest.which
        if (distance == odistance) return true
    }
    return false
}

private fun filterOutSequentialBranches(quanta: List<QuantumBase>, lastBranchPoint: Int) {
    for (i in quanta.size - 1 downTo 1) {
        val q = quanta[i]
        q.neighbors = q.neighbors.filter {
            !hasSequentialBranch(q, it, lastBranchPoint)
        }.toMutableList()
    }
}

private fun computeDefaultThreshold(
    quanta: List<QuantumBase>,
    config: JukeboxConfig
): Int {
    val targetBranchCount = quanta.size / TARGET_BRANCH_DIVISOR.toDouble()
    var t = THRESHOLD_START
    while (t < config.maxBranchThreshold) {
        val count = collectNearestNeighbors(quanta, t, config)
        if (count >= targetBranchCount) {
            return t
        }
        t += THRESHOLD_STEP
    }
    return config.maxBranchThreshold
}

private fun addAnchorBranch(
    quanta: List<QuantumBase>,
    threshold: Int,
    config: JukeboxConfig
): Int? {
    val preferredLateStart = floor(quanta.size * 0.8).toInt()
    val maxAnchorThreshold = if (longestBackwardBranch(quanta) < 50) 65 else 55
    val existingAnchorSource = findExistingAnchorSource(quanta, config.minLongBranch)
    if (existingAnchorSource != null && existingAnchorSource >= preferredLateStart) {
        // Existing end-of-track branch already reaches the early target zone.
        return existingAnchorSource
    }
    val lateInsertedSource = insertBestBackwardBranch(
        quanta,
        threshold,
        maxAnchorThreshold,
        preferredLateStart
    )
    if (lateInsertedSource != null) {
        return lateInsertedSource
    }
    if (existingAnchorSource != null) {
        return existingAnchorSource
    }
    return insertBestBackwardBranch(quanta, threshold, maxAnchorThreshold)
}

private fun applyBranchFilters(
    quanta: List<QuantumBase>,
    config: JukeboxConfig,
    preferredLastBranchPoint: Int?
): Pair<Int, Double> {
    calculateReachability(quanta)
    val earlyTargetBeat = resolveEarlyTargetBeat(quanta, 25)
    val branchesToTarget = calculateBranchesToEarlyTarget(
        quanta,
        earlyTargetBeat
    )
    val earliestByBeat = calculateEarliestReachableByBeat(quanta)
    val selectedLastBranchPoint: Int
    val selectedLongestReach: Double
    if (preferredLastBranchPoint != null &&
        preferredLastBranchPoint >= 0 &&
        preferredLastBranchPoint < quanta.size &&
        quanta[preferredLastBranchPoint].neighbors.isNotEmpty()
    ) {
        val distanceToEnd = quanta.size - preferredLastBranchPoint
        val q = quanta[preferredLastBranchPoint]
        selectedLastBranchPoint = preferredLastBranchPoint
        selectedLongestReach = if (q.reach != null) {
            ((q.reach!! - distanceToEnd) * 100.0) / quanta.size
        } else {
            0.0
        }
    } else {
        val best = findBestLastBeat(
            quanta,
            earliestByBeat,
            branchesToTarget,
            earlyTargetBeat,
            config.minLongBranch
        )
        selectedLastBranchPoint = best.first
        selectedLongestReach = best.second
    }
    filterOutBadBranches(quanta, selectedLastBranchPoint)
    if (config.removeSequentialBranches) {
        filterOutSequentialBranches(quanta, selectedLastBranchPoint)
    }
    return selectedLastBranchPoint to selectedLongestReach
}

fun buildJumpGraph(analysis: TrackAnalysis, config: JukeboxConfig): JukeboxGraphState {
    val quanta = analysis.beats
    val allEdges = mutableListOf<Edge>()
    precalculateNearestNeighbors(quanta, config.maxBranches, config.maxBranchThreshold, allEdges)

    val computedThreshold = computeDefaultThreshold(quanta, config)
    val threshold = if (config.currentThreshold != 0) {
        config.currentThreshold
    } else {
        computedThreshold
    }

    collectNearestNeighbors(quanta, threshold, config)
    val preferredLastBranchPoint = addAnchorBranch(quanta, threshold, config)
    val (lastBranchPoint, longestReach) = applyBranchFilters(
        quanta,
        config,
        preferredLastBranchPoint
    )

    return JukeboxGraphState(
        computedThreshold = computedThreshold,
        currentThreshold = threshold,
        lastBranchPoint = lastBranchPoint,
        totalBeats = quanta.size,
        longestReach = longestReach,
        allEdges = allEdges
    )
}

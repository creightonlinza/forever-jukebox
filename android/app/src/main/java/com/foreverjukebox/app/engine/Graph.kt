package com.foreverjukebox.app.engine

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
private const val LONGEST_BACKWARD_THRESHOLD = 50
private const val ADD_LAST_EDGE_HIGH_THRESHOLD = 65
private const val ADD_LAST_EDGE_LOW_THRESHOLD = 55

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
                if (seg1.which == seg2.which) MAX_DISTANCE else segmentDistance(seg1, seg2)
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

    edges.sortWith(compareBy({ it.distance }))

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
    if (quanta[0].allNeighbors.isNotEmpty()) return
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
            kotlin.math.abs(neighbor.dest.which - q.which) < config.minLongBranch) continue
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
            if (delta > longest) longest = delta
        }
    }
    return (longest * 100.0) / quanta.size
}

private fun insertBestBackwardBranch(
    quanta: List<QuantumBase>,
    threshold: Int,
    maxThreshold: Int
) {
    val branches = mutableListOf<Triple<Double, QuantumBase, Edge>>()
    for (i in quanta.indices) {
        val q = quanta[i]
        for (neighbor in q.allNeighbors) {
            if (neighbor.deleted) continue
            val delta = i - neighbor.dest.which
            if (delta > 0 && neighbor.distance < maxThreshold) {
                val percent = (delta * 100.0) / quanta.size
                branches.add(Triple(percent, q, neighbor))
            }
        }
    }
    if (branches.isEmpty()) return
    branches.sortBy { it.first }
    val best = branches.last()
    if (best.third.distance > threshold) {
        best.second.neighbors.add(best.third)
    }
}

private fun calculateReachability(quanta: List<QuantumBase>) {
    val maxIter = 1000
    for (q in quanta) {
        q.reach = quanta.size - q.which
    }
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
        if (changeCount == 0) break
    }
}

private fun findBestLastBeat(
    quanta: List<QuantumBase>,
): Pair<Int, Double> {
    val reachThreshold = 50.0
    var longest = 0
    var longestReach = 0.0
    for (i in quanta.size - 1 downTo 0) {
        val q = quanta[i]
        val distanceToEnd = quanta.size - i
        val reach = q.reach?.let { ((it - distanceToEnd) * 100.0) / quanta.size } ?: 0.0
        if (reach > longestReach && q.neighbors.isNotEmpty()) {
            longestReach = reach
            longest = i
            if (reach >= reachThreshold) {
                break
            }
        }
    }
    return longest to longestReach
}

private fun filterOutBadBranches(quanta: List<QuantumBase>, lastIndex: Int) {
    for (i in 0 until lastIndex) {
        val q = quanta[i]
        q.neighbors = q.neighbors.filter { it.dest.which < lastIndex }.toMutableList()
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
        q.neighbors = q.neighbors.filter { !hasSequentialBranch(q, it, lastBranchPoint) }
            .toMutableList()
    }
}

fun buildJumpGraph(analysis: TrackAnalysis, config: JukeboxConfig): JukeboxGraphState {
    val quanta = analysis.beats
    val allEdges = mutableListOf<Edge>()
    precalculateNearestNeighbors(quanta, config.maxBranches, config.maxBranchThreshold, allEdges)

    val computedThreshold = run {
        val targetBranchCount = quanta.size / TARGET_BRANCH_DIVISOR
        var t = THRESHOLD_START
        while (t < config.maxBranchThreshold) {
            val count = collectNearestNeighbors(quanta, t, config)
            if (count >= targetBranchCount) {
                return@run t
            }
            t += THRESHOLD_STEP
        }
        config.maxBranchThreshold
    }
    val threshold = if (config.currentThreshold != 0) {
        config.currentThreshold
    } else {
        computedThreshold
    }

    collectNearestNeighbors(quanta, threshold, config)

    if (config.addLastEdge) {
        if (longestBackwardBranch(quanta) < LONGEST_BACKWARD_THRESHOLD) {
            insertBestBackwardBranch(quanta, threshold, ADD_LAST_EDGE_HIGH_THRESHOLD)
        } else {
            insertBestBackwardBranch(quanta, threshold, ADD_LAST_EDGE_LOW_THRESHOLD)
        }
    }

    calculateReachability(quanta)
    val (lastBranchPoint, longestReach) = findBestLastBeat(quanta)
    filterOutBadBranches(quanta, lastBranchPoint)
    if (config.removeSequentialBranches) {
        filterOutSequentialBranches(quanta, lastBranchPoint)
    }

    return JukeboxGraphState(
        computedThreshold = computedThreshold,
        currentThreshold = threshold,
        lastBranchPoint = lastBranchPoint,
        totalBeats = quanta.size,
        longestReach = longestReach,
        allEdges = allEdges
    )
}

package com.foreverjukebox.app.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GraphAnchorSelectionTest {

    @Test
    fun prefersHigherQualityLateCandidatesOverLatestQualifyingSource() {
        val analysis = makeLateQualityBeatsLatestScenario()
        val graph = buildJumpGraph(analysis, testConfig())

        assertEquals(8, graph.lastBranchPoint)
        assertTrue(
            analysis.beats[graph.lastBranchPoint].neighbors.any { edge ->
                edge.dest.which == 2
            }
        )
    }

    @Test
    fun prefersLatestCandidateWhenQualityIsCloseEnough() {
        val analysis = makeLateNearQualityPrefersLatestScenario()
        val graph = buildJumpGraph(analysis, testConfig())

        assertEquals(9, graph.lastBranchPoint)
        assertTrue(
            analysis.beats[graph.lastBranchPoint].neighbors.any { edge ->
                edge.dest.which == 4
            }
        )
    }

    @Test
    fun usesFallbackLateRangeWhenPreferredLateWindowHasNoCandidate() {
        val analysis = makeFallbackRangeAnchorScenario()
        val graph = buildJumpGraph(analysis, testConfig())

        assertEquals(7, graph.lastBranchPoint)
    }

    @Test
    fun fallsBackFromBestTierToGoodTierWhenNeeded() {
        val analysis = makeGoodTierFallbackScenario()
        val graph = buildJumpGraph(analysis, testConfig(minLongBranch = 4))

        assertEquals(9, graph.lastBranchPoint)
        assertTrue(
            analysis.beats[graph.lastBranchPoint].neighbors.any { edge ->
                edge.dest.which == 6
            }
        )
    }

    @Test
    fun prefersLaterSourceWhenCandidatesTieOnQuality() {
        val analysis = makeExactTiePrefersLaterSourceScenario()
        val graph = buildJumpGraph(analysis, testConfig(minLongBranch = 4))

        assertEquals(9, graph.lastBranchPoint)
    }

    @Test
    fun insertsAnchorWhenNoExistingCandidateQualifies() {
        val analysis = makeInsertionWithoutExistingAnchorScenario()
        val graph = buildJumpGraph(analysis, testConfig())

        assertEquals(8, graph.lastBranchPoint)
        assertTrue(
            analysis.beats.flatMap { it.neighbors }.any { edge ->
                edge.src.which == 8 && edge.dest.which == 1
            }
        )
    }

    @Test
    fun capsLateSourceTargetHintsSoNearEndAnchorsDoNotWinByDefault() {
        val analysis = makeLateHintClampScenario()
        val graph = buildJumpGraph(analysis, testConfig(minLongBranch = 15))

        assertEquals(75, graph.lastBranchPoint)
    }

    @Test
    fun preservesLateOnsetTargetsWhenFirstBackwardBranchesAreLate() {
        val analysis = makeLateOnsetTargetScenario()
        val graph = buildJumpGraph(analysis, testConfig(minLongBranch = 15))

        assertEquals(90, graph.lastBranchPoint)
    }

    private fun testConfig(minLongBranch: Int = 2): JukeboxConfig {
        return JukeboxConfig(
            maxBranches = 4,
            maxBranchThreshold = 80,
            currentThreshold = 20,
            justBackwards = false,
            justLongBranches = false,
            removeSequentialBranches = false,
            minRandomBranchChance = 0.18,
            maxRandomBranchChance = 0.5,
            randomBranchChanceDelta = 0.018,
            minLongBranch = minLongBranch
        )
    }

    private fun makeLateQualityBeatsLatestScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(10)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // Latest late-track source (9) qualifies but only with a very short immediate jump.
        push(9, 7, 10.0)
        push(7, 2, 10.0)
        // Slightly earlier late-track source (8) is a better direct return.
        push(8, 2, 10.0)
        return analysis
    }

    private fun makeLateNearQualityPrefersLatestScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(10)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // Earlier direct branch with strongest quality metrics.
        push(8, 2, 10.0)
        // Latest branch is one hop worse, but still close in quality.
        push(9, 4, 10.0)
        push(4, 2, 10.0)
        return analysis
    }

    private fun makeFallbackRangeAnchorScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(10)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // No qualifying branches in preferred late window (8-9).
        // Fallback late-range candidate in 66-80% window should be selected.
        push(7, 2, 10.0)
        return analysis
    }

    private fun makeGoodTierFallbackScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(10)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // No best-tier candidate (minLongBranch=4 in test config).
        // This candidate should be chosen when rule evaluation falls to "good".
        push(9, 6, 10.0)
        push(6, 3, 10.0)
        push(3, 2, 10.0)
        return analysis
    }

    private fun makeExactTiePrefersLaterSourceScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(10)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // Source 8 and 9 produce equal quality outcomes:
        // branchesToTarget=1, earliestReachable=2, immediateBackward=4, same distance.
        push(8, 4, 10.0)
        push(9, 5, 10.0)
        push(4, 2, 10.0)
        push(5, 2, 10.0)
        return analysis
    }

    private fun makeInsertionWithoutExistingAnchorScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(10)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // Define early target and provide only an above-threshold late insertion option.
        push(3, 1, 10.0)
        push(8, 1, 40.0)
        return analysis
    }

    private fun makeLateHintClampScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(100)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // Preferred late candidate only reaches near the end.
        push(90, 86, 10.0)
        // Fallback late-range candidate reaches much earlier in track.
        push(75, 55, 10.0)
        return analysis
    }

    private fun makeLateOnsetTargetScenario(): TrackAnalysis {
        val analysis = makeLinearAnalysis(100)
        val beats = analysis.beats
        beats.forEach { beat ->
            beat.allNeighbors = mutableListOf()
            beat.neighbors = mutableListOf()
        }
        var id = 0
        fun push(src: Int, dest: Int, distance: Double) {
            beats[src].allNeighbors.add(makeEdge(id, beats[src], beats[dest], distance))
            id += 1
        }
        // Keep beat 0 non-empty so graph build uses cached neighbors.
        push(0, 2, 10.0)
        // All backward branching starts late in the track.
        push(90, 70, 10.0)
        push(75, 70, 10.0)
        return analysis
    }

    private fun makeLinearAnalysis(totalBeats: Int): TrackAnalysis {
        val beats = (0 until totalBeats).map { index ->
            QuantumBase(
                start = index.toDouble(),
                duration = 1.0,
                confidence = 0.7,
                which = index
            )
        }.toMutableList()
        linkBeats(beats)
        return TrackAnalysis(
            sections = mutableListOf(),
            bars = mutableListOf(),
            beats = beats,
            tatums = mutableListOf(),
            segments = mutableListOf(),
            track = TrackMeta(duration = totalBeats.toDouble())
        )
    }

    private fun linkBeats(beats: MutableList<QuantumBase>) {
        beats.forEachIndexed { index, beat ->
            beat.prev = if (index > 0) beats[index - 1] else null
            beat.next = if (index < beats.size - 1) beats[index + 1] else null
        }
    }

    private fun makeEdge(id: Int, src: QuantumBase, dest: QuantumBase, distance: Double): Edge {
        return Edge(
            id = id,
            src = src,
            dest = dest,
            distance = distance,
            deleted = false
        )
    }
}

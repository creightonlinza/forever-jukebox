package com.foreverjukebox.app.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectionTest {

    @Test
    fun forcesABranchAtTheLastBranchPoint() {
        val seed = makeBeat(1)
        val target = makeBeat(0)
        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = target,
                distance = 10.0
            )
        )
        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 1, totalBeats = 2),
            config = config(),
            rng = { 0.99 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(0, result.first)
        assertTrue(result.second)
    }

    @Test
    fun branchesWhenRandomChanceTriggers() {
        val seed = makeBeat(1)
        val target = makeBeat(2)
        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = target,
                distance = 10.0
            )
        )
        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 99, totalBeats = 2),
            config = config(),
            rng = { 0.1 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(2, result.first)
        assertTrue(result.second)
    }

    @Test
    fun rotatesNeighborOrderAfterJump() {
        val seed = makeBeat(0)
        val firstTarget = makeBeat(1)
        val secondTarget = makeBeat(2)
        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = firstTarget,
                distance = 10.0
            )
        )
        seed.neighbors.add(
            makeEdge(
                id = 1,
                src = seed,
                dest = secondTarget,
                distance = 12.0
            )
        )
        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 0, totalBeats = 3),
            config = config(),
            rng = { 0.01 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(1, result.first)
        assertEquals(2, seed.neighbors[0].dest.which)
        assertEquals(1, seed.neighbors[1].dest.which)
    }

    @Test
    fun prefersLongerImmediateJumpWhenDownstreamReachTies() {
        val seed = makeBeat(10)
        val shortTarget = makeBeat(8)
        val longTarget = makeBeat(2)
        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = shortTarget,
                distance = 5.0
            )
        )
        seed.neighbors.add(
            makeEdge(
                id = 1,
                src = seed,
                dest = longTarget,
                distance = 20.0
            )
        )
        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 10, totalBeats = 20),
            config = config(),
            rng = { 0.99 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(2, result.first)
        assertTrue(result.second)
    }

    @Test
    fun prefersBranchThatCanReachEarlierBeatsAfterLookahead() {
        val beats = (0 until 12).map { makeBeat(it) }.toMutableList()
        linkBeats(beats)
        val seed = beats[10]
        val localTarget = beats[9]
        val deepTarget = beats[7]
        val earlyTarget = beats[1]

        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = localTarget,
                distance = 10.0
            )
        )
        seed.neighbors.add(
            makeEdge(
                id = 1,
                src = seed,
                dest = deepTarget,
                distance = 20.0
            )
        )
        deepTarget.neighbors.add(
            makeEdge(
                id = 2,
                src = deepTarget,
                dest = earlyTarget,
                distance = 15.0
            )
        )

        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 10, totalBeats = beats.size),
            config = config(),
            rng = { 0.99 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(7, result.first)
        assertTrue(result.second)
    }

    @Test
    fun prefersFewerAdditionalBranchesToReachEarlyTargetZone() {
        val beats = (0 until 13).map { makeBeat(it) }.toMutableList()
        linkBeats(beats)
        val seed = beats[10]
        val fartherTarget = beats[8]
        val nearerTarget = beats[6]
        val earlyTarget = beats[2]

        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = fartherTarget,
                distance = 5.0
            )
        )
        seed.neighbors.add(
            makeEdge(
                id = 1,
                src = seed,
                dest = nearerTarget,
                distance = 25.0
            )
        )
        fartherTarget.neighbors.add(
            makeEdge(
                id = 2,
                src = fartherTarget,
                dest = nearerTarget,
                distance = 5.0
            )
        )
        nearerTarget.neighbors.add(
            makeEdge(
                id = 3,
                src = nearerTarget,
                dest = earlyTarget,
                distance = 10.0
            )
        )

        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 10, totalBeats = beats.size),
            config = config(),
            rng = { 0.99 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(6, result.first)
        assertTrue(result.second)
    }

    @Test
    fun keepsIndexWhenRandomChanceDoesNotTrigger() {
        val seed = makeBeat(0)
        val target = makeBeat(3)
        seed.neighbors.add(
            makeEdge(
                id = 0,
                src = seed,
                dest = target,
                distance = 10.0
            )
        )
        val result = selectNextBeatIndex(
            seed = seed,
            graph = graph(lastBranchPoint = 99, totalBeats = 4),
            config = config(),
            rng = { 0.9 },
            state = BranchState(curRandomBranchChance = 0.18),
            forceBranch = false
        )
        assertEquals(0, result.first)
        assertFalse(result.second)
    }

    @Test
    fun shouldRandomBranchRampsChanceAndClampsToMax() {
        val beat = makeBeat(0)
        val state = BranchState(curRandomBranchChance = 0.28)
        val testConfig = config(
            minRandomBranchChance = 0.1,
            maxRandomBranchChance = 0.3,
            randomBranchChanceDelta = 0.05
        )
        val shouldBranch = shouldRandomBranch(
            q = beat,
            graph = graph(lastBranchPoint = 99, totalBeats = 2),
            config = testConfig,
            rng = { 0.99 },
            state = state
        )
        assertFalse(shouldBranch)
        assertEquals(0.3, state.curRandomBranchChance, 0.000001)
    }

    @Test
    fun shouldRandomBranchResetsChanceToMinWhenBranching() {
        val beat = makeBeat(0)
        val state = BranchState(curRandomBranchChance = 0.25)
        val testConfig = config(
            minRandomBranchChance = 0.1,
            maxRandomBranchChance = 0.3,
            randomBranchChanceDelta = 0.05
        )
        val shouldBranch = shouldRandomBranch(
            q = beat,
            graph = graph(lastBranchPoint = 99, totalBeats = 2),
            config = testConfig,
            rng = { 0.0 },
            state = state
        )
        assertTrue(shouldBranch)
        assertEquals(0.1, state.curRandomBranchChance, 0.000001)
    }

    @Test
    fun shouldRandomBranchRampsSlowerForShortBeatsAndFasterForLongBeats() {
        val shortBeat = makeBeat(0).copy(duration = 0.25)
        val longBeat = makeBeat(1).copy(duration = 1.0)
        val shortState = BranchState(curRandomBranchChance = 0.1)
        val longState = BranchState(curRandomBranchChance = 0.1)
        val testConfig = config(
            minRandomBranchChance = 0.1,
            maxRandomBranchChance = 0.3,
            randomBranchChanceDelta = 0.05
        )

        shouldRandomBranch(
            q = shortBeat,
            graph = graph(lastBranchPoint = 99, totalBeats = 2),
            config = testConfig,
            rng = { 0.99 },
            state = shortState
        )
        shouldRandomBranch(
            q = longBeat,
            graph = graph(lastBranchPoint = 99, totalBeats = 2),
            config = testConfig,
            rng = { 0.99 },
            state = longState
        )

        assertEquals(0.125, shortState.curRandomBranchChance, 0.000001)
        assertEquals(0.2, longState.curRandomBranchChance, 0.000001)
    }

    private fun makeBeat(which: Int): QuantumBase {
        return QuantumBase(
            start = which.toDouble(),
            duration = 1.0,
            confidence = null,
            which = which
        )
    }

    private fun linkBeats(beats: MutableList<QuantumBase>) {
        beats.forEachIndexed { index, beat ->
            beat.prev = if (index > 0) beats[index - 1] else null
            beat.next = if (index < beats.size - 1) beats[index + 1] else null
        }
    }

    private fun makeEdge(
        id: Int,
        src: QuantumBase,
        dest: QuantumBase,
        distance: Double
    ): Edge {
        return Edge(
            id = id,
            src = src,
            dest = dest,
            distance = distance,
            deleted = false
        )
    }

    private fun graph(lastBranchPoint: Int, totalBeats: Int): JukeboxGraphState {
        return JukeboxGraphState(
            computedThreshold = 60,
            currentThreshold = 60,
            lastBranchPoint = lastBranchPoint,
            totalBeats = totalBeats,
            longestReach = 0.0,
            allEdges = mutableListOf()
        )
    }

    private fun config(
        minRandomBranchChance: Double = 0.18,
        maxRandomBranchChance: Double = 0.5,
        randomBranchChanceDelta: Double = 0.018
    ): JukeboxConfig {
        return JukeboxConfig(
            maxBranches = 4,
            maxBranchThreshold = 80,
            currentThreshold = 60,
            justBackwards = false,
            justLongBranches = false,
            removeSequentialBranches = false,
            minRandomBranchChance = minRandomBranchChance,
            maxRandomBranchChance = maxRandomBranchChance,
            randomBranchChanceDelta = randomBranchChanceDelta,
            minLongBranch = 1
        )
    }
}

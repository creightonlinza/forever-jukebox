package com.foreverjukebox.app.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Field
import java.lang.reflect.Method

class JukeboxEngineParityTest {

    @Test(expected = IllegalStateException::class)
    fun startJukeboxThrowsWithoutAnalysis() {
        val engine = JukeboxEngine(FakePlayer())
        engine.startJukebox()
    }

    @Test
    fun playPauseStopDelegateToPlayer() {
        val player = FakePlayer()
        val engine = JukeboxEngine(player)

        engine.play()
        engine.pauseJukebox()
        engine.stopJukebox()

        assertEquals(1, player.playCalls)
        assertEquals(1, player.pauseCalls)
        assertEquals(1, player.stopCalls)
    }

    @Test
    fun loadAnalysisSetsMinLongBranchFromBeatCount() {
        val player = FakePlayer()
        val engine = JukeboxEngine(player)

        engine.loadAnalysis(makeAnalysisPayload(10))

        assertEquals(2, engine.getConfig().minLongBranch)
        assertNotNull(engine.getGraphState())
    }

    @Test
    fun preservesDeletedEdgeFlagsAfterRebuild() {
        val player = FakePlayer()
        val engine = JukeboxEngine(
            player,
            JukeboxEngineOptions(
                config = JukeboxConfig(
                    currentThreshold = 80,
                    maxBranchThreshold = 80
                )
            )
        )
        engine.loadAnalysis(makeAnalysisPayload(8))
        val before = engine.getGraphState()
        assertNotNull(before)
        requireNotNull(before)
        assertTrue(before.allEdges.isNotEmpty())

        val toDelete = before.allEdges[0]
        val deletedKey = "${toDelete.src.which}-${toDelete.dest.which}"
        engine.deleteEdge(toDelete)
        engine.rebuildGraph()

        val after = engine.getGraphState()
        assertNotNull(after)
        requireNotNull(after)
        val matched = after.allEdges.find { "${it.src.which}-${it.dest.which}" == deletedKey }
        assertNotNull(matched)
        assertTrue(matched?.deleted == true)
    }

    @Test
    fun clearDeletedEdgesResetsPriorDeletionsBeforeNewDelete() {
        val player = FakePlayer()
        val engine = JukeboxEngine(
            player,
            JukeboxEngineOptions(
                config = JukeboxConfig(
                    currentThreshold = 80,
                    maxBranchThreshold = 80
                )
            )
        )
        engine.loadAnalysis(makeAnalysisPayload(8))

        val initial = engine.getGraphState()
        assertNotNull(initial)
        requireNotNull(initial)
        assertTrue(initial.allEdges.size > 1)

        val firstEdge = initial.allEdges[0]
        val firstKey = "${firstEdge.src.which}-${firstEdge.dest.which}"
        engine.deleteEdge(firstEdge)
        engine.rebuildGraph()

        engine.clearDeletedEdges()
        engine.rebuildGraph()
        val afterReset = engine.getGraphState()
        assertNotNull(afterReset)
        requireNotNull(afterReset)
        val resetDeleted = afterReset.allEdges.filter { it.deleted }
        assertEquals(0, resetDeleted.size)

        val secondEdge = afterReset.allEdges.first { "${it.src.which}-${it.dest.which}" != firstKey }
        val secondKey = "${secondEdge.src.which}-${secondEdge.dest.which}"

        engine.deleteEdge(secondEdge)
        engine.rebuildGraph()
        val finalGraph = engine.getGraphState()
        assertNotNull(finalGraph)
        requireNotNull(finalGraph)
        val finalDeleted = finalGraph.allEdges.filter { it.deleted }
        assertEquals(1, finalDeleted.size)
        val finalKey = "${finalDeleted[0].src.which}-${finalDeleted[0].dest.which}"
        assertEquals(secondKey, finalKey)
    }

    @Test
    fun getVisualizationDataProvidesAnchorEdgeIdWhenAvailable() {
        val engine = JukeboxEngine(FakePlayer())
        engine.loadAnalysis(makeAnalysisPayload(8))

        val vis = engine.getVisualizationData()
        assertNotNull(vis)
        requireNotNull(vis)
        assertTrue(vis.lastBranchPoint >= 0)
        assertNotNull(vis.anchorEdgeId)
    }

    @Test
    fun doesNotForceBranchWhenOnlyCurrentBeatIsLastBranchPoint() {
        val player = FakePlayer()
        val engine = JukeboxEngine(player)
        val beats = mutableListOf(makeBeat(0), makeBeat(1), makeBeat(2))
        linkBeats(beats)
        val edge = makeEdge(0, beats[1], beats[0], 10.0)
        beats[1].neighbors = mutableListOf(edge)
        beats[1].allNeighbors = mutableListOf(edge)
        val graph = JukeboxGraphState(
            computedThreshold = 0,
            currentThreshold = 0,
            lastBranchPoint = 1,
            totalBeats = beats.size,
            longestReach = 0.0,
            allEdges = mutableListOf(edge)
        )
        setPrivateField(engine, "analysis", makeAnalysis(beats))
        setPrivateField(engine, "graph", graph)
        setPrivateField(engine, "beats", beats)
        setPrivateField(engine, "currentBeatIndex", 1)
        setPrivateField(engine, "nextAudioTime", 1.0)
        setPrivateField(engine, "curRandomBranchChance", engine.getConfig().minRandomBranchChance)

        invokeAdvanceBeat(engine, 1.0)

        assertEquals(2, getPrivateField<Int>(engine, "currentBeatIndex"))
        assertEquals(0, player.scheduleJumpCalls.size)
    }

    @Test
    fun forcesBranchWhenNextBeatIsLastBranchPoint() {
        val player = FakePlayer()
        val engine = JukeboxEngine(player)
        val beats = mutableListOf(makeBeat(0), makeBeat(1), makeBeat(2))
        linkBeats(beats)
        val edge = makeEdge(0, beats[1], beats[0], 10.0)
        beats[1].neighbors = mutableListOf(edge)
        beats[1].allNeighbors = mutableListOf(edge)
        val graph = JukeboxGraphState(
            computedThreshold = 0,
            currentThreshold = 0,
            lastBranchPoint = 1,
            totalBeats = beats.size,
            longestReach = 0.0,
            allEdges = mutableListOf(edge)
        )
        setPrivateField(engine, "analysis", makeAnalysis(beats))
        setPrivateField(engine, "graph", graph)
        setPrivateField(engine, "beats", beats)
        setPrivateField(engine, "currentBeatIndex", 0)
        setPrivateField(engine, "nextAudioTime", 1.0)
        setPrivateField(engine, "curRandomBranchChance", engine.getConfig().minRandomBranchChance)

        invokeAdvanceBeat(engine, 1.0)

        assertEquals(0, getPrivateField<Int>(engine, "currentBeatIndex"))
        assertEquals(1, player.scheduleJumpCalls.size)
        assertEquals(1, getPrivateField<Int?>(engine, "lastJumpFromIndex"))
    }

    @Test
    fun schedulesJumpWhenWrappingPastLastBeat() {
        val player = FakePlayer()
        val engine = JukeboxEngine(player)
        val beats = mutableListOf(makeBeat(0), makeBeat(1))
        linkBeats(beats)
        val graph = JukeboxGraphState(
            computedThreshold = 0,
            currentThreshold = 0,
            lastBranchPoint = 0,
            totalBeats = beats.size,
            longestReach = 0.0,
            allEdges = mutableListOf()
        )
        setPrivateField(engine, "analysis", makeAnalysis(beats))
        setPrivateField(engine, "graph", graph)
        setPrivateField(engine, "beats", beats)
        setPrivateField(engine, "currentBeatIndex", 1)
        setPrivateField(engine, "nextAudioTime", 1.0)
        setPrivateField(engine, "curRandomBranchChance", engine.getConfig().minRandomBranchChance)

        invokeAdvanceBeat(engine, 1.0)

        assertEquals(0, getPrivateField<Int>(engine, "currentBeatIndex"))
        assertEquals(1, player.scheduleJumpCalls.size)
        assertEquals(1, getPrivateField<Int?>(engine, "lastJumpFromIndex"))
    }

    @Test
    fun forceBranchSettingForcesJump() {
        val player = FakePlayer()
        val engine = JukeboxEngine(player)
        val beats = mutableListOf(makeBeat(0), makeBeat(1), makeBeat(2))
        linkBeats(beats)
        val edge = makeEdge(0, beats[2], beats[0], 10.0)
        beats[2].neighbors = mutableListOf(edge)
        beats[2].allNeighbors = mutableListOf(edge)
        val graph = JukeboxGraphState(
            computedThreshold = 0,
            currentThreshold = 0,
            lastBranchPoint = 99,
            totalBeats = beats.size,
            longestReach = 0.0,
            allEdges = mutableListOf(edge)
        )
        setPrivateField(engine, "analysis", makeAnalysis(beats))
        setPrivateField(engine, "graph", graph)
        setPrivateField(engine, "beats", beats)
        setPrivateField(engine, "currentBeatIndex", 1)
        setPrivateField(engine, "nextAudioTime", 1.0)
        setPrivateField(engine, "curRandomBranchChance", engine.getConfig().minRandomBranchChance)
        engine.setForceBranch(true)

        invokeAdvanceBeat(engine, 1.0)

        assertEquals(0, getPrivateField<Int>(engine, "currentBeatIndex"))
        assertEquals(1, player.scheduleJumpCalls.size)
        assertEquals(2, getPrivateField<Int?>(engine, "lastJumpFromIndex"))
    }

    @Test
    fun clearAnalysisResetsGraphAndBeatLookup() {
        val engine = JukeboxEngine(FakePlayer())
        engine.loadAnalysis(makeAnalysisPayload(6))
        assertNotNull(engine.getGraphState())

        engine.clearAnalysis()

        assertNull(engine.getGraphState())
        assertNull(engine.getBeatAtTime(1.0))
    }

    private fun makeAnalysisPayload(count: Int): JsonElement {
        val beats = JsonArray((0 until count).map { i ->
            JsonObject(
                mapOf(
                    "start" to JsonPrimitive(i.toDouble()),
                    "duration" to JsonPrimitive(1.0),
                    "confidence" to JsonPrimitive(1.0)
                )
            )
        })
        val segments = JsonArray((0 until count).map { i ->
            JsonObject(
                mapOf(
                    "start" to JsonPrimitive(i.toDouble()),
                    "duration" to JsonPrimitive(1.0),
                    "confidence" to JsonPrimitive(1.0),
                    "loudness_start" to JsonPrimitive(0.0),
                    "loudness_max" to JsonPrimitive(0.0),
                    "loudness_max_time" to JsonPrimitive(0.0),
                    "pitches" to JsonArray(List(12) { JsonPrimitive(0.0) }),
                    "timbre" to JsonArray(List(12) { JsonPrimitive(0.0) })
                )
            )
        })

        return JsonObject(
            mapOf(
                "sections" to beats,
                "bars" to beats,
                "beats" to beats,
                "tatums" to beats,
                "segments" to segments,
                "track" to JsonObject(mapOf("duration" to JsonPrimitive(count.toDouble())))
            )
        )
    }

    private fun makeAnalysis(beats: MutableList<QuantumBase>): TrackAnalysis {
        return TrackAnalysis(
            sections = mutableListOf(),
            bars = mutableListOf(),
            beats = beats,
            tatums = mutableListOf(),
            segments = mutableListOf(),
            track = TrackMeta(duration = beats.size.toDouble())
        )
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

    private fun makeEdge(id: Int, src: QuantumBase, dest: QuantumBase, distance: Double): Edge {
        return Edge(
            id = id,
            src = src,
            dest = dest,
            distance = distance,
            deleted = false
        )
    }

    private fun invokeAdvanceBeat(engine: JukeboxEngine, audioTime: Double) {
        val method: Method = JukeboxEngine::class.java.getDeclaredMethod(
            "advanceBeat",
            Double::class.javaPrimitiveType
        )
        method.isAccessible = true
        method.invoke(engine, audioTime)
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> getPrivateField(engine: JukeboxEngine, fieldName: String): T {
        val field: Field = JukeboxEngine::class.java.getDeclaredField(fieldName)
        field.isAccessible = true
        return field.get(engine) as T
    }

    private fun setPrivateField(engine: JukeboxEngine, fieldName: String, value: Any?) {
        val field: Field = JukeboxEngine::class.java.getDeclaredField(fieldName)
        field.isAccessible = true
        field.set(engine, value)
    }

    private class FakePlayer : JukeboxPlayer {
        var playCalls = 0
        var pauseCalls = 0
        var stopCalls = 0
        val scheduleJumpCalls = mutableListOf<Pair<Double, Double>>()

        override fun play() {
            playCalls += 1
        }

        override fun pause() {
            pauseCalls += 1
        }

        override fun stop() {
            stopCalls += 1
        }

        override fun seek(time: Double) = Unit

        override fun scheduleJump(targetTime: Double, audioStart: Double) {
            scheduleJumpCalls.add(targetTime to audioStart)
        }

        override fun getCurrentTime(): Double = 0.0

        override fun getAudioTime(): Double = 0.0

        override fun isPlaying(): Boolean = true
    }
}

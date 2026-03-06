package com.foreverjukebox.app.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File

class ParityFixtureTest {

    @Test
    fun matchesExpectedAnchorSignaturesForSharedFixtureCases() {
        val root = loadFixtureRoot()
        val cases = root["cases"]!!.jsonArray
        for (testCaseElement in cases) {
            val testCase = testCaseElement.jsonObject
            val id = testCase["id"]!!.jsonPrimitive.content
            val beats = testCase["beats"]!!.jsonPrimitive.int
            val configObj = testCase["config"]!!.jsonObject
            val expected = testCase["expected"]!!.jsonObject
            val jumpExpectation = testCase["jumpExpectation"]!!.jsonObject

            val analysis = makeAnalysis(beats)
            var edgeId = 0
            val edges = testCase["edges"]!!.jsonArray
            for (edgeElement in edges) {
                val edge = edgeElement.jsonArray
                val src = edge[0].jsonPrimitive.int
                val dest = edge[1].jsonPrimitive.int
                val distance = edge[2].jsonPrimitive.double
                analysis.beats[src].allNeighbors.add(
                    makeEdge(
                        id = edgeId,
                        src = analysis.beats[src],
                        dest = analysis.beats[dest],
                        distance = distance
                    )
                )
                edgeId += 1
            }

            val config = defaultConfig(
                currentThreshold = configObj["currentThreshold"]!!.jsonPrimitive.int,
                minLongBranch = configObj["minLongBranch"]!!.jsonPrimitive.int
            )
            val graph = buildJumpGraph(analysis, config)
            val source = analysis.beats.getOrNull(graph.lastBranchPoint)
            assertNotNull("$id: selected source exists", source)
            source ?: continue
            val forcedIndex = getBestLastBranchNeighborIndex(source)
            val forced = source.neighbors.getOrNull(forcedIndex)
            assertNotNull("$id: forced edge exists", forced)
            forced ?: continue

            val actualLast = graph.lastBranchPoint
            val actualForcedDest = forced.dest.which
            val actualInserted = forced.distance > graph.currentThreshold

            assertEquals(
                "$id: lastBranchPoint",
                expected["lastBranchPoint"]!!.jsonPrimitive.int,
                actualLast
            )
            assertEquals(
                "$id: forcedDest",
                expected["forcedDest"]!!.jsonPrimitive.int,
                actualForcedDest
            )
            assertEquals(
                "$id: forcedInserted",
                expected["forcedInserted"]!!.jsonPrimitive.boolean,
                actualInserted
            )

            val jump = selectNextBeatIndex(
                seed = source,
                graph = graph,
                config = config,
                rng = { 0.99 },
                state = BranchState(curRandomBranchChance = 0.18),
                forceBranch = false
            )
            assertEquals(
                "$id: jump nextIndex",
                jumpExpectation["nextIndex"]!!.jsonPrimitive.int,
                jump.first
            )
            assertEquals(
                "$id: jump jumped",
                jumpExpectation["jumped"]!!.jsonPrimitive.boolean,
                jump.second
            )
        }
    }

    private fun loadFixtureRoot() = run {
        val userDir = File(System.getProperty("user.dir") ?: ".").absoluteFile
        val candidates = mutableListOf<File>()
        var cursor: File? = userDir
        while (cursor != null) {
            candidates.add(File(cursor, "test-fixtures/engine-parity/anchor-cases.json"))
            cursor = cursor.parentFile
        }
        val fixtureFile = candidates.firstOrNull { it.exists() } ?: error(
            "Could not find anchor-cases.json. Looked in: " +
                candidates.joinToString(", ") { it.absolutePath }
        )
        Json.parseToJsonElement(fixtureFile.readText()).jsonObject
    }

    private fun defaultConfig(
        currentThreshold: Int,
        minLongBranch: Int
    ): JukeboxConfig {
        return JukeboxConfig(
            maxBranches = 4,
            maxBranchThreshold = 80,
            currentThreshold = currentThreshold,
            justBackwards = false,
            justLongBranches = false,
            removeSequentialBranches = false,
            minRandomBranchChance = 0.18,
            maxRandomBranchChance = 0.5,
            randomBranchChanceDelta = 0.018,
            minLongBranch = minLongBranch
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

    private fun makeAnalysis(totalBeats: Int): TrackAnalysis {
        val beats = (0 until totalBeats).map { makeBeat(it) }.toMutableList()
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

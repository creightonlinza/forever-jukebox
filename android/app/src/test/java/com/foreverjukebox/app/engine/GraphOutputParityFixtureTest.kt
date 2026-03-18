package com.foreverjukebox.app.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import kotlin.math.abs

class GraphOutputParityFixtureTest {

    @Test
    fun matchesExpectedGraphOutputSignaturesForSharedFixtureCases() {
        val root = loadFixtureRoot()
        val cases = root["cases"]!!.jsonArray
        for (testCaseElement in cases) {
            val testCase = testCaseElement.jsonObject
            val id = testCase["id"]!!.jsonPrimitive.content
            val beats = testCase["beats"]!!.jsonPrimitive.int
            val configObj = testCase["config"]!!.jsonObject
            val expected = testCase["expected"]!!.jsonObject
            val expectedGraph = expected["graph"]!!.jsonObject
            val expectedActiveEdges = expected["activeEdges"]!!.jsonArray
            val expectedAllEdges = expected["allEdges"]!!.jsonArray

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

            val config = configFromFixture(configObj)
            val graph = buildJumpGraph(analysis, config)

            assertEquals(
                "$id: computedThreshold",
                expectedGraph["computedThreshold"]!!.jsonPrimitive.int,
                graph.computedThreshold
            )
            assertEquals(
                "$id: currentThreshold",
                expectedGraph["currentThreshold"]!!.jsonPrimitive.int,
                graph.currentThreshold
            )
            assertEquals(
                "$id: lastBranchPoint",
                expectedGraph["lastBranchPoint"]!!.jsonPrimitive.int,
                graph.lastBranchPoint
            )
            assertEquals(
                "$id: totalBeats",
                expectedGraph["totalBeats"]!!.jsonPrimitive.int,
                graph.totalBeats
            )
            assertEquals(
                "$id: allEdgesCount",
                expectedGraph["allEdgesCount"]!!.jsonPrimitive.int,
                graph.allEdges.size
            )
            assertDoubleEquals(
                "$id: longestReach",
                expectedGraph["longestReach"]!!.jsonPrimitive.double,
                rounded(graph.longestReach)
            )

            val actualActiveEdges = analysis.beats
                .flatMap { beat ->
                    beat.neighbors.map { edge ->
                        Triple(edge.src.which, edge.dest.which, rounded(edge.distance))
                    }
                }
                .sortedWith(
                    compareBy<Triple<Int, Int, Double>> { it.first }
                        .thenBy { it.second }
                        .thenBy { it.third }
                )

            val expectedActive = expectedActiveEdges.map { tuple ->
                val arr = tuple.jsonArray
                Triple(
                    arr[0].jsonPrimitive.int,
                    arr[1].jsonPrimitive.int,
                    arr[2].jsonPrimitive.double
                )
            }.sortedWith(
                compareBy<Triple<Int, Int, Double>> { it.first }
                    .thenBy { it.second }
                    .thenBy { it.third }
            )
            assertEquals("$id: active edge count", expectedActive.size, actualActiveEdges.size)
            expectedActive.indices.forEach { idx ->
                val exp = expectedActive[idx]
                val act = actualActiveEdges[idx]
                assertEquals("$id: active edge[$idx].src", exp.first, act.first)
                assertEquals("$id: active edge[$idx].dest", exp.second, act.second)
                assertDoubleEquals("$id: active edge[$idx].distance", exp.third, act.third)
            }

            val actualAllEdges = graph.allEdges
                .map { edge ->
                    Quadruple(edge.id, edge.src.which, edge.dest.which, rounded(edge.distance))
                }
                .sortedBy { it.first }
            val expectedAll = expectedAllEdges.map { tuple ->
                val arr = tuple.jsonArray
                Quadruple(
                    arr[0].jsonPrimitive.int,
                    arr[1].jsonPrimitive.int,
                    arr[2].jsonPrimitive.int,
                    arr[3].jsonPrimitive.double
                )
            }.sortedBy { it.first }

            assertEquals("$id: all edge count", expectedAll.size, actualAllEdges.size)
            expectedAll.indices.forEach { idx ->
                val exp = expectedAll[idx]
                val act = actualAllEdges[idx]
                assertEquals("$id: all edge[$idx].id", exp.first, act.first)
                assertEquals("$id: all edge[$idx].src", exp.second, act.second)
                assertEquals("$id: all edge[$idx].dest", exp.third, act.third)
                assertDoubleEquals("$id: all edge[$idx].distance", exp.fourth, act.fourth)
            }
        }
    }

    private fun configFromFixture(configObj: JsonObject): JukeboxConfig {
        return JukeboxConfig(
            maxBranches = configObj["maxBranches"]?.jsonPrimitive?.intOrNull ?: 4,
            maxBranchThreshold = configObj["maxBranchThreshold"]?.jsonPrimitive?.intOrNull ?: 80,
            currentThreshold = configObj["currentThreshold"]!!.jsonPrimitive.int,
            justBackwards = configObj["justBackwards"]?.jsonPrimitive?.booleanOrNull ?: false,
            justLongBranches = configObj["justLongBranches"]?.jsonPrimitive?.booleanOrNull ?: false,
            removeSequentialBranches = configObj["removeSequentialBranches"]?.jsonPrimitive?.booleanOrNull
                ?: false,
            minRandomBranchChance = configObj["minRandomBranchChance"]?.jsonPrimitive?.doubleOrNull ?: 0.18,
            maxRandomBranchChance = configObj["maxRandomBranchChance"]?.jsonPrimitive?.doubleOrNull ?: 0.5,
            randomBranchChanceDelta = configObj["randomBranchChanceDelta"]?.jsonPrimitive?.doubleOrNull
                ?: 0.018,
            minLongBranch = configObj["minLongBranch"]!!.jsonPrimitive.int
        )
    }

    private fun rounded(value: Double): Double = kotlin.math.round(value * 1_000_000.0) / 1_000_000.0

    private fun assertDoubleEquals(label: String, expected: Double, actual: Double, epsilon: Double = 1e-6) {
        if (abs(expected - actual) > epsilon) {
            throw AssertionError("$label expected <$expected> but was <$actual>")
        }
    }

    private fun loadFixtureRoot() = run {
        val userDir = File(System.getProperty("user.dir") ?: ".").absoluteFile
        val candidates = mutableListOf<File>()
        var cursor: File? = userDir
        while (cursor != null) {
            candidates.add(File(cursor, "test-fixtures/engine-parity/graph-output-cases.json"))
            cursor = cursor.parentFile
        }
        val fixtureFile = candidates.firstOrNull { it.exists() } ?: error(
            "Could not find graph-output-cases.json. Looked in: " +
                candidates.joinToString(", ") { it.absolutePath }
        )
        Json.parseToJsonElement(fixtureFile.readText()).jsonObject
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

    private data class Quadruple<A, B, C, D>(
        val first: A,
        val second: B,
        val third: C,
        val fourth: D
    )
}


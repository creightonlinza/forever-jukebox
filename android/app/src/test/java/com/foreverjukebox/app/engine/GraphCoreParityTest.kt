package com.foreverjukebox.app.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class GraphCoreParityTest {

    @Test
    fun buildsNeighborsAndLastBranchPoint() {
        val analysis = normalizeAnalysis(makeAnalysisPayload())
        val graph = buildJumpGraph(analysis, config(currentThreshold = 60, minLongBranch = 1))

        assertEquals(4, graph.totalBeats)
        assertTrue(graph.lastBranchPoint >= 0)
        assertTrue(analysis.beats.any { it.neighbors.isNotEmpty() })
    }

    @Test
    fun respectsJustBackwardsAndJustLongBranchesFilters() {
        val analysis = normalizeAnalysis(makeAnalysisPayload())
        val graph = buildJumpGraph(
            analysis,
            config(
                currentThreshold = 80,
                justBackwards = true,
                justLongBranches = true,
                minLongBranch = 2
            )
        )

        assertEquals(4, graph.totalBeats)
        for (beat in analysis.beats) {
            for (neighbor in beat.neighbors) {
                assertTrue(neighbor.dest.which < beat.which)
                assertTrue(abs(neighbor.dest.which - beat.which) >= 2)
            }
        }
    }

    @Test
    fun filtersSequentialBranchesWhenEnabled() {
        val analysis = normalizeAnalysis(makeAnalysisPayload())
        val graph = buildJumpGraph(
            analysis,
            config(
                currentThreshold = 80,
                justBackwards = true,
                removeSequentialBranches = true,
                minLongBranch = 1
            )
        )
        val lastBranchPoint = graph.lastBranchPoint
        for (i in 1 until analysis.beats.size) {
            if (i == lastBranchPoint) {
                continue
            }
            val prev = analysis.beats[i - 1]
            val current = analysis.beats[i]
            val prevDistances = prev.neighbors.map { prev.which - it.dest.which }.toSet()
            for (edge in current.neighbors) {
                val distance = current.which - edge.dest.which
                assertFalse(prevDistances.contains(distance))
            }
        }
    }

    @Test
    fun usesComputedThresholdWhenCurrentThresholdIsZero() {
        val analysis = normalizeAnalysis(makeAnalysisPayload())
        val graph = buildJumpGraph(analysis, config(currentThreshold = 0, minLongBranch = 1))

        assertEquals(graph.computedThreshold, graph.currentThreshold)
        assertTrue(graph.currentThreshold > 0)
        assertEquals(0, graph.currentThreshold % 2)
    }

    @Test
    fun keepsCurrentThresholdWhenProvided() {
        val analysis = normalizeAnalysis(makeAnalysisPayload())
        val graph = buildJumpGraph(analysis, config(currentThreshold = 60, minLongBranch = 1))

        assertEquals(60, graph.currentThreshold)
        assertTrue(graph.computedThreshold > 0)
    }

    @Test
    fun reusesCachedNeighborsAndReturnsStableAllEdges() {
        val analysis = normalizeAnalysis(makeAnalysisPayload())
        val cfg = config(currentThreshold = 60, minLongBranch = 1)

        val first = buildJumpGraph(analysis, cfg)
        val firstCount = first.allEdges.size
        assertTrue(firstCount > 0)

        val second = buildJumpGraph(analysis, cfg)
        assertEquals(firstCount, second.allEdges.size)
    }

    private fun config(
        currentThreshold: Int,
        justBackwards: Boolean = false,
        justLongBranches: Boolean = false,
        removeSequentialBranches: Boolean = false,
        minLongBranch: Int
    ): JukeboxConfig {
        return JukeboxConfig(
            maxBranches = 3,
            maxBranchThreshold = 80,
            currentThreshold = currentThreshold,
            justBackwards = justBackwards,
            justLongBranches = justLongBranches,
            removeSequentialBranches = removeSequentialBranches,
            minRandomBranchChance = 0.18,
            maxRandomBranchChance = 0.5,
            randomBranchChanceDelta = 0.018,
            minLongBranch = minLongBranch
        )
    }

    private fun makeAnalysisPayload(): JsonElement {
        val sections = JsonArray(
            listOf(
                JsonObject(
                    mapOf(
                        "start" to JsonPrimitive(0.0),
                        "duration" to JsonPrimitive(4.0),
                        "confidence" to JsonPrimitive(1.0)
                    )
                )
            )
        )
        val bars = JsonArray(
            listOf(
                JsonObject(
                    mapOf(
                        "start" to JsonPrimitive(0.0),
                        "duration" to JsonPrimitive(2.0),
                        "confidence" to JsonPrimitive(0.8)
                    )
                ),
                JsonObject(
                    mapOf(
                        "start" to JsonPrimitive(2.0),
                        "duration" to JsonPrimitive(2.0),
                        "confidence" to JsonPrimitive(0.8)
                    )
                )
            )
        )
        val beats = JsonArray((0 until 4).map { i ->
            JsonObject(
                mapOf(
                    "start" to JsonPrimitive(i.toDouble()),
                    "duration" to JsonPrimitive(1.0),
                    "confidence" to JsonPrimitive(0.6)
                )
            )
        })
        val tatums = JsonArray((0 until 4).map { i ->
            JsonObject(
                mapOf(
                    "start" to JsonPrimitive(i * 0.5),
                    "duration" to JsonPrimitive(0.5),
                    "confidence" to JsonPrimitive(0.5)
                )
            )
        })
        val segments = JsonArray((0 until 4).map { i ->
            JsonObject(
                mapOf(
                    "start" to JsonPrimitive(i.toDouble()),
                    "duration" to JsonPrimitive(1.0),
                    "confidence" to JsonPrimitive(0.4),
                    "loudness_start" to JsonPrimitive(-20 + i),
                    "loudness_max" to JsonPrimitive(-5 + i * 0.2),
                    "loudness_max_time" to JsonPrimitive(0.2),
                    "pitches" to JsonArray(List(12) { JsonPrimitive(0.5 + i * 0.01) }),
                    "timbre" to JsonArray(List(12) { JsonPrimitive(1.0 + i * 0.1) })
                )
            )
        })

        return JsonObject(
            mapOf(
                "sections" to sections,
                "bars" to bars,
                "beats" to beats,
                "tatums" to tatums,
                "segments" to segments,
                "track" to JsonObject(mapOf("duration" to JsonPrimitive(4.0)))
            )
        )
    }
}

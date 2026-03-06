package com.foreverjukebox.app.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalysisParserTest {

    @Test
    fun normalizeAnalysisLinksQuantaAndOverlappingSegments() {
        val analysis = normalizeAnalysis(makeAnalysisPayload(4))

        assertEquals(4, analysis.beats.size)
        assertEquals(1, analysis.beats[0].next?.which)
        assertTrue(analysis.beats[0].overlappingSegments.isNotEmpty())
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
}

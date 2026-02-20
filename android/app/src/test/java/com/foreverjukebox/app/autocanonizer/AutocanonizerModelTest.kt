package com.foreverjukebox.app.autocanonizer

import com.foreverjukebox.app.engine.QuantumBase
import com.foreverjukebox.app.engine.Segment
import com.foreverjukebox.app.engine.TrackAnalysis
import com.foreverjukebox.app.engine.TrackMeta
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutocanonizerModelTest {
    @Test
    fun buildsDataAndHonorsDurationOverride() {
        val segments = mutableListOf(
            segment(start = 0.0, timbreSeed = 0.0),
            segment(start = 1.0, timbreSeed = 10.0),
            segment(start = 2.0, timbreSeed = 0.2),
            segment(start = 3.0, timbreSeed = 10.2)
        )
        val section = QuantumBase(start = 0.0, duration = 4.0, confidence = 1.0, which = 0)
        val beats = mutableListOf(
            beat(index = 0, start = 0.0, segment = segments[0], section = section),
            beat(index = 1, start = 1.0, segment = segments[1], section = section),
            beat(index = 2, start = 2.0, segment = segments[2], section = section),
            beat(index = 3, start = 3.0, segment = segments[3], section = section)
        )

        val analysis = TrackAnalysis(
            sections = mutableListOf(section),
            bars = mutableListOf(),
            beats = beats,
            tatums = mutableListOf(),
            segments = segments,
            track = TrackMeta(duration = 4.0)
        )

        val data = buildAutocanonizerData(analysis, durationOverride = 5.5)

        assertNotNull(data)
        assertEquals(5.5, data?.trackDuration ?: 0.0, 0.0001)
        assertEquals(4, data?.beats?.size ?: 0)
        assertEquals(0, data?.beats?.first()?.section)
        assertTrue(data?.beats?.all { it.colorHex.startsWith("#") } == true)
        assertTrue(data?.beats?.all { it.otherGain in 0.5..1.0 } == true)
    }

    @Test
    fun nearestNeighborRespectsIndexInParentParityLikeWeb() {
        val section = QuantumBase(start = 0.0, duration = 3.0, confidence = 1.0, which = 0)
        val segmentA = segment(start = 0.0, timbreSeed = 10.0)
        val segmentB = segment(start = 1.0, timbreSeed = 10.0)
        val segmentC = segment(start = 2.0, timbreSeed = 10.2)

        val beatA = beat(index = 0, start = 0.0, segment = segmentA, section = section, indexInParent = 0)
        val beatB = beat(index = 1, start = 1.0, segment = segmentB, section = section, indexInParent = 1)
        val beatC = beat(index = 2, start = 2.0, segment = segmentC, section = section, indexInParent = 0)
        val analysis = TrackAnalysis(
            sections = mutableListOf(section),
            bars = mutableListOf(),
            beats = mutableListOf(beatA, beatB, beatC),
            tatums = mutableListOf(),
            segments = mutableListOf(segmentA, segmentB, segmentC),
            track = TrackMeta(duration = 3.0)
        )

        val data = buildAutocanonizerData(analysis)

        assertEquals(2, data?.beats?.get(0)?.simIndex)
    }

    private fun beat(
        index: Int,
        start: Double,
        segment: Segment,
        section: QuantumBase,
        indexInParent: Int = index
    ): QuantumBase {
        return QuantumBase(
            start = start,
            duration = 1.0,
            confidence = 1.0,
            which = index,
            parent = section,
            indexInParent = indexInParent,
            overlappingSegments = mutableListOf(segment)
        )
    }

    private fun segment(start: Double, timbreSeed: Double): Segment {
        return Segment(
            start = start,
            duration = 1.0,
            confidence = 1.0,
            loudnessStart = -30.0,
            loudnessMax = -10.0,
            loudnessMaxTime = 0.1,
            pitches = List(12) { 0.1 * it },
            timbre = List(12) { index -> timbreSeed + index },
            which = start.toInt()
        )
    }
}

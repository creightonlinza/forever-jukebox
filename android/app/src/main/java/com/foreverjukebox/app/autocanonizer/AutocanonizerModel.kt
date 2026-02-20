package com.foreverjukebox.app.autocanonizer

import com.foreverjukebox.app.engine.QuantumBase
import com.foreverjukebox.app.engine.Segment
import com.foreverjukebox.app.engine.TrackAnalysis
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

data class AutocanonizerSection(
    val start: Double,
    val duration: Double
)

data class AutocanonizerBeat(
    val index: Int,
    val start: Double,
    val duration: Double,
    val nextIndex: Int?,
    val section: Int,
    val indexInParent: Int?,
    val overlappingSegments: List<Segment>,
    var simIndex: Int? = null,
    var simDistance: Double? = null,
    var otherIndex: Int = index,
    var otherGain: Double = 1.0,
    var volume: Double = 0.0,
    var medianVolume: Double = 0.0,
    var colorHex: String = "#333333"
)

data class AutocanonizerData(
    val beats: List<AutocanonizerBeat>,
    val trackDuration: Double,
    val sections: List<AutocanonizerSection>
)

private const val TIMBRE_WEIGHT = 1.0
private const val PITCH_WEIGHT = 10.0
private const val LOUD_START_WEIGHT = 1.0
private const val LOUD_MAX_WEIGHT = 1.0
private const val DURATION_WEIGHT = 100.0
private const val CONFIDENCE_WEIGHT = 1.0
private const val VOLUME_WINDOW = 20

fun buildAutocanonizerData(
    analysis: TrackAnalysis,
    durationOverride: Double? = null
): AutocanonizerData? {
    if (analysis.beats.isEmpty()) {
        return null
    }

    val beats = analysis.beats.mapIndexed { index, beat ->
        AutocanonizerBeat(
            index = index,
            start = beat.start,
            duration = beat.duration,
            nextIndex = if (index + 1 < analysis.beats.size) index + 1 else null,
            section = getSectionIndex(beat),
            indexInParent = beat.indexInParent,
            overlappingSegments = beat.overlappingSegments
        )
    }

    val trackDuration = durationOverride
        ?: analysis.track?.duration
        ?: (beats.last().start + beats.last().duration)

    calculateNearestNeighbors(beats)
    foldBySection(beats)
    assignNormalizedVolumes(beats)
    assignBeatColors(beats, analysis.segments)

    return AutocanonizerData(
        beats = beats,
        trackDuration = trackDuration,
        sections = analysis.sections.map { section ->
            AutocanonizerSection(start = section.start, duration = section.duration)
        }
    )
}

private fun getSectionIndex(beat: QuantumBase): Int {
    var current: QuantumBase? = beat
    while (current?.parent != null) {
        current = current.parent
    }
    return current?.which ?: 0
}

private fun calculateNearestNeighbors(beats: List<AutocanonizerBeat>) {
    for (beat in beats) {
        var bestIndex: Int? = null
        var bestDistance = Double.POSITIVE_INFINITY
        for (other in beats) {
            if (beat.index == other.index) {
                continue
            }
            val distance = compareBeats(beat, other)
            if (distance > 0.0 && distance < bestDistance) {
                bestDistance = distance
                bestIndex = other.index
            }
        }
        beat.simIndex = bestIndex
        beat.simDistance = if (bestDistance.isFinite()) bestDistance else null
    }
}

private fun compareBeats(a: AutocanonizerBeat, b: AutocanonizerBeat): Double {
    if (a.overlappingSegments.isEmpty() || b.overlappingSegments.isEmpty()) {
        return Double.POSITIVE_INFINITY
    }
    var sum = 0.0
    for (i in a.overlappingSegments.indices) {
        val seg1 = a.overlappingSegments[i]
        val seg2 = b.overlappingSegments.getOrNull(i)
        val distance = if (seg2 != null) {
            segmentDistance(seg1, seg2)
        } else {
            100.0
        }
        sum += distance
    }
    val parentDistance = if (a.indexInParent == b.indexInParent) 0.0 else 100.0
    return sum / a.overlappingSegments.size + parentDistance
}

private fun segmentDistance(a: Segment, b: Segment): Double {
    val timbre = euclideanDistance(a.timbre, b.timbre) * TIMBRE_WEIGHT
    val pitch = euclideanDistance(a.pitches, b.pitches) * PITCH_WEIGHT
    val loudStart = abs(a.loudnessStart - b.loudnessStart) * LOUD_START_WEIGHT
    val loudMax = abs(a.loudnessMax - b.loudnessMax) * LOUD_MAX_WEIGHT
    val duration = abs(a.duration - b.duration) * DURATION_WEIGHT
    val confidence = abs(a.confidence - b.confidence) * CONFIDENCE_WEIGHT
    return timbre + pitch + loudStart + loudMax + duration + confidence
}

private fun euclideanDistance(v1: List<Double>, v2: List<Double>): Double {
    var sum = 0.0
    val len = min(v1.size, v2.size)
    for (i in 0 until len) {
        val delta = v2[i] - v1[i]
        sum += delta * delta
    }
    return sqrt(sum)
}

private fun foldBySection(beats: List<AutocanonizerBeat>) {
    val bySection = beats.groupBy { it.section }
    for ((_, list) in bySection) {
        if (list.isEmpty()) {
            continue
        }
        val counter = mutableMapOf<Int, Int>()
        for (beat in list) {
            val simIndex = beat.simIndex ?: continue
            val delta = beat.index - simIndex
            counter[delta] = (counter[delta] ?: 0) + 1
        }
        var bestDelta = 0
        var bestCount = -1
        for ((delta, count) in counter) {
            if (count > bestCount) {
                bestCount = count
                bestDelta = delta
            }
        }
        for (beat in list) {
            val otherIndex = beat.index - bestDelta
            beat.otherIndex = if (otherIndex in beats.indices) otherIndex else beat.index
            beat.otherGain = 1.0
        }
    }

    for (beat in beats) {
        val prev = beats.getOrNull(beat.index - 1)
        val next = beats.getOrNull(beat.index + 1)
        if (prev != null && prev.otherIndex + 1 != beat.otherIndex) {
            prev.otherGain = 0.5
            beat.otherGain = 0.5
        }
        if (next != null && next.otherIndex - 1 != beat.otherIndex) {
            next.otherGain = 0.5
            beat.otherGain = 0.5
        }
    }
}

private fun assignNormalizedVolumes(beats: List<AutocanonizerBeat>) {
    var minVolume = 0.0
    var maxVolume = -60.0

    for (beat in beats) {
        val volume = averageVolume(beat)
        beat.volume = volume
        if (volume > maxVolume) {
            maxVolume = volume
        }
        if (volume < minVolume) {
            minVolume = volume
        }
    }

    for (beat in beats) {
        beat.volume = interpolate(beat.volume, minVolume, maxVolume)
    }

    calcWindowMedian(beats, VOLUME_WINDOW)
}

private fun averageVolume(beat: AutocanonizerBeat): Double {
    if (beat.overlappingSegments.isEmpty()) {
        return -60.0
    }
    var sum = 0.0
    for (segment in beat.overlappingSegments) {
        sum += segment.loudnessMax
    }
    return sum / beat.overlappingSegments.size
}

private fun interpolate(value: Double, minValue: Double, maxValue: Double): Double {
    if (minValue == maxValue) {
        return minValue
    }
    return (value - minValue) / (maxValue - minValue)
}

private fun calcWindowMedian(beats: List<AutocanonizerBeat>, windowSize: Int) {
    for (beat in beats) {
        val values = mutableListOf<Double>()
        for (i in 0 until windowSize) {
            val offset = i - (windowSize / 2)
            val index = beat.index - offset
            if (index in beats.indices) {
                values.add(beats[index].volume)
            }
        }
        values.sort()
        beat.medianVolume = values.getOrNull(values.size / 2) ?: beat.volume
    }
}

private fun assignBeatColors(beats: List<AutocanonizerBeat>, segments: List<Segment>) {
    val minValues = doubleArrayOf(100.0, 100.0, 100.0)
    val maxValues = doubleArrayOf(-100.0, -100.0, -100.0)

    for (segment in segments) {
        for (i in 0..2) {
            val value = segment.timbre.getOrNull(i + 1) ?: continue
            if (value < minValues[i]) {
                minValues[i] = value
            }
            if (value > maxValues[i]) {
                maxValues[i] = value
            }
        }
    }

    for (beat in beats) {
        val segment = beat.overlappingSegments.firstOrNull()
        if (segment == null) {
            beat.colorHex = "#333333"
            continue
        }
        val rgb = IntArray(3)
        for (i in 0..2) {
            val value = segment.timbre.getOrNull(i + 1) ?: 0.0
            val range = maxValues[i] - minValues[i]
            val norm = if (range == 0.0) 0.5 else (value - minValues[i]) / range
            rgb[i] = (norm * 255.0).roundToInt().coerceIn(0, 255)
        }
        beat.colorHex = toHex(rgb[1], rgb[2], rgb[0])
    }
}

private fun toHex(r: Int, g: Int, b: Int): String {
    return "#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}"
}

private fun toHexPart(value: Int): String {
    return value.coerceIn(0, 255).toString(16).padStart(2, '0')
}

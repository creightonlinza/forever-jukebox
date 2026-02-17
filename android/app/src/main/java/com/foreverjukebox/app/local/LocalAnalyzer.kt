package com.foreverjukebox.app.local

import java.io.File
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sqrt

private const val ESSENTIA_FRAME_SIZE = 2_048
private const val ESSENTIA_HOP_SIZE = 512

private data class SegmentationConfig(
    val minSegmentDuration: Double = 0.25,
    val noveltySmoothing: Int = 8,
    val peakThreshold: Double = 0.3,
    val peakProminence: Double = 0.2,
    val maxSegmentsPerSecond: Double = 2.5,
    val beatSnapTolerance: Double = 0.12
)

private val DEFAULT_SEGMENTATION = SegmentationConfig()

private data class Quantum(
    val start: Double,
    val duration: Double,
    val confidence: Double?
)

private data class Segment(
    val start: Double,
    val duration: Double,
    val confidence: Double,
    val loudnessStart: Double,
    val loudnessMax: Double,
    val loudnessMaxTime: Double,
    val pitches: List<Double>,
    val timbre: List<Double>
)

@Serializable
private data class EssentiaFeaturePayload(
    @SerialName("frame_times")
    val frameTimes: List<Double> = emptyList(),
    val mfcc: List<List<Double>> = emptyList(),
    val hpcp: List<List<Double>> = emptyList(),
    @SerialName("rms_db")
    val rmsDb: List<Double> = emptyList()
)

@Serializable
private data class MadmomBeatsPortResult(
    @SerialName("beat_times")
    val beatTimes: List<Double> = emptyList(),
    @SerialName("beat_numbers")
    val beatNumbers: List<Int> = emptyList(),
    @SerialName("beat_confidences")
    val beatConfidences: List<Double> = emptyList()
)

interface LocalAnalyzer {
    suspend fun analyze(
        essentiaSamples: FloatArray,
        essentiaSampleRate: Int,
        madmomSamples: FloatArray,
        madmomSampleRate: Int,
        essentiaProfile: String?,
        durationSeconds: Double,
        title: String?,
        artist: String?,
        madmomBeatsPortModels: List<File>,
        onStageProgress: (stage: String, percent: Int) -> Unit
    ): JsonElement
}

class NativeLocalAnalyzer(
    private val json: Json = Json { ignoreUnknownKeys = true }
) : LocalAnalyzer {
    override suspend fun analyze(
        essentiaSamples: FloatArray,
        essentiaSampleRate: Int,
        madmomSamples: FloatArray,
        madmomSampleRate: Int,
        essentiaProfile: String?,
        durationSeconds: Double,
        title: String?,
        artist: String?,
        madmomBeatsPortModels: List<File>,
        onStageProgress: (stage: String, percent: Int) -> Unit
    ): JsonElement {
        currentCoroutineContext().ensureActive()
        var essentiaProgressPercent = -1
        onStageProgress("Essentia features", 0)

        val essentiaJson = NativeAnalysisBridge.essentiaExtractFeaturesJson(
            samples = essentiaSamples,
            sampleRate = essentiaSampleRate,
            frameSize = ESSENTIA_FRAME_SIZE,
            hopSize = ESSENTIA_HOP_SIZE,
            profile = essentiaProfile,
            progressCallback = NativeAnalysisBridge.EssentiaProgressCallback { progress ->
                val mapped = (progress.coerceIn(0f, 1f) * 100f).toInt().coerceIn(0, 100)
                if (mapped > essentiaProgressPercent) {
                    essentiaProgressPercent = mapped
                    onStageProgress("Essentia features", mapped)
                }
            }
        ) ?: throw NativeLocalAnalysisNotReadyException(
            NativeAnalysisBridge.essentiaLastErrorMessage()
                ?: "Essentia feature extraction failed"
        )

        val features = json.decodeFromString<EssentiaFeaturePayload>(essentiaJson)
        if (essentiaProgressPercent < 100) {
            onStageProgress("Essentia features", 100)
        }
        currentCoroutineContext().ensureActive()

        val madmomBeatsPortConfigJson = buildMadmomBeatsPortConfigJson(madmomBeatsPortModels)
        var madmomProgressPercent = -1
        onStageProgress("madmom beats", 0)
        val madmomBeatsPortJson = NativeAnalysisBridge.madmomBeatsPortAnalyzeJson(
            samples = madmomSamples,
            sampleRate = madmomSampleRate,
            configJson = madmomBeatsPortConfigJson,
            progressCallback = NativeAnalysisBridge.MadmomBeatsPortProgressCallback { stage, progress ->
                val mapped = mapMadmomStageProgress(stage, progress)
                if (mapped > madmomProgressPercent) {
                    madmomProgressPercent = mapped
                    onStageProgress("madmom beats", mapped)
                }
            }
        ) ?: throw NativeLocalAnalysisNotReadyException(
            NativeAnalysisBridge.madmomBeatsPortLastErrorMessage() ?: "madmom_beats_port_ffi analysis failed"
        )
        val madmomBeatsPort = try {
            json.decodeFromString<MadmomBeatsPortResult>(madmomBeatsPortJson)
        } catch (error: Exception) {
            throw NativeLocalAnalysisNotReadyException(
                "Failed to parse madmom_beats_port output JSON: ${error.message}"
            )
        }
        if (madmomProgressPercent < 100) {
            onStageProgress("madmom beats", 100)
        }

        val beatTimes = madmomBeatsPort.beatTimes.ifEmpty { listOf(0.0) }
        val beatNumbers = if (madmomBeatsPort.beatNumbers.isNotEmpty()) {
            madmomBeatsPort.beatNumbers
        } else {
            beatTimes.indices.map { (it % 4) + 1 }
        }
        val beatConfidences = if (madmomBeatsPort.beatConfidences.isNotEmpty()) {
            madmomBeatsPort.beatConfidences
        } else {
            beatTimes.map { 1.0 }
        }

        val novelty = computeNovelty(features.mfcc, features.hpcp, features.rmsDb)
        val frameTimes = features.frameTimes.ifEmpty { listOf(0.0) }
        val boundaries = segmentFromNovelty(
            frameTimes = frameTimes,
            novelty = novelty,
            beats = beatTimes,
            config = DEFAULT_SEGMENTATION,
            duration = durationSeconds
        )

        val segments = computeSegments(
            frameTimes = frameTimes,
            mfcc = features.mfcc,
            hpcp = features.hpcp,
            rmsDb = features.rmsDb,
            novelty = novelty,
            boundaries = boundaries
        )

        val beats = makeQuanta(beatTimes, durationSeconds, beatConfidences)

        val barStarts = mutableListOf<Double>()
        val barConfidences = mutableListOf<Double>()
        for (index in beatTimes.indices) {
            if (beatNumbers.getOrNull(index) == 1) {
                barStarts += beatTimes[index]
                barConfidences += beatConfidences.getOrElse(index) { 1.0 }
            }
        }
        if (barStarts.isEmpty()) {
            barStarts += beatTimes.firstOrNull() ?: 0.0
            barConfidences += beatConfidences.firstOrNull() ?: 1.0
        }
        val bars = makeQuanta(barStarts, durationSeconds, barConfidences)

        val tatumStarts = mutableListOf<Double>()
        val tatumConfidences = mutableListOf<Double>()
        for (i in beatTimes.indices) {
            val beat = beatTimes[i]
            val next = beatTimes.getOrNull(i + 1) ?: durationSeconds
            val beatDuration = max(0.0, next - beat)
            repeat(2) { t ->
                tatumStarts += beat + (beatDuration * t) / 2.0
                tatumConfidences += beatConfidences.getOrElse(i) { 1.0 }
            }
        }
        val tatums = makeQuanta(tatumStarts, durationSeconds, tatumConfidences)
            .map { it.copy(start = round(it.start * 1000.0) / 1000.0) }

        val sections = computeSections(bars, segments, durationSeconds)
        val tempo = computeTempo(beatTimes)

        return buildJsonObject {
            put("engine_version", JsonPrimitive(2))
            put("sections", quantaJson(sections))
            put("bars", quantaJson(bars))
            put("beats", quantaJson(beats))
            put("tatums", quantaJson(tatums))
            put("segments", segmentsJson(segments))
            put(
                "track",
                buildJsonObject {
                    put("duration", JsonPrimitive(durationSeconds))
                    put("tempo", JsonPrimitive(tempo))
                    put("time_signature", JsonPrimitive(4))
                    if (!title.isNullOrBlank()) put("title", JsonPrimitive(title))
                    if (!artist.isNullOrBlank()) put("artist", JsonPrimitive(artist))
                }
            )
        }
    }

    private fun mapMadmomStageProgress(stage: Int, progress: Float): Int {
        val clamped = progress.coerceIn(0f, 1f)
        val normalized = when (stage) {
            0 -> clamped * 0.35f
            1 -> 0.35f + (clamped * 0.55f)
            2 -> 0.90f + (clamped * 0.10f)
            else -> clamped
        }
        return (normalized * 100f).toInt().coerceIn(0, 100)
    }

    private fun buildMadmomBeatsPortConfigJson(models: List<File>): String {
        val modelJson = models.firstOrNull { it.name.endsWith(".json") }
        val weightsNpz = models.firstOrNull { it.name.endsWith(".npz") }

        if (modelJson == null || weightsNpz == null) {
            throw NativeLocalAnalysisNotReadyException(
                "madmom_beats_port model files are missing. Expected .json and .npz"
            )
        }

        val defaultConfigJson = NativeAnalysisBridge.madmomBeatsPortDefaultConfigJson()
            ?: throw NativeLocalAnalysisNotReadyException(
                "madmom_beats_port_default_config_json is unavailable in the loaded madmom_beats_port_ffi build"
            )
        if (defaultConfigJson.isBlank()) {
            throw NativeLocalAnalysisNotReadyException(
                "madmom_beats_port_default_config_json returned an empty payload"
            )
        }

        val defaultConfig = runCatching {
            json.parseToJsonElement(defaultConfigJson).jsonObject
        }.getOrElse { error ->
            throw NativeLocalAnalysisNotReadyException(
                "Failed to parse madmom_beats_port default config JSON: ${error.message}"
            )
        }

        val modelConfig = defaultConfig["model"]?.jsonObject ?: buildJsonObject { }
        val patchedModelConfig = buildJsonObject {
            modelConfig.forEach { (key, value) -> put(key, value) }
            put("model_json", JsonPrimitive(modelJson.absolutePath))
            put("weights_npz", JsonPrimitive(weightsNpz.absolutePath))
        }
        val patchedConfig = buildJsonObject {
            defaultConfig.forEach { (key, value) ->
                if (key != "model") {
                    put(key, value)
                }
            }
            put("model", patchedModelConfig)
        }

        val featureConfig = patchedConfig["feature"]?.jsonObject
            ?: throw NativeLocalAnalysisNotReadyException(
                "Invalid madmom_beats_port default config: missing feature section"
            )
        val sampleRate = featureConfig["sample_rate"]?.jsonPrimitive?.content?.toIntOrNull()
            ?: throw NativeLocalAnalysisNotReadyException(
                "Invalid madmom_beats_port default config: missing feature.sample_rate"
            )
        if (sampleRate <= 0) {
            throw NativeLocalAnalysisNotReadyException(
                "Invalid madmom_beats_port default config: feature.sample_rate must be > 0"
            )
        }

        return patchedConfig.toString()
    }

    private suspend fun computeNovelty(
        mfcc: List<List<Double>>,
        hpcp: List<List<Double>>,
        rmsDb: List<Double>
    ): List<Double> {
        val frameCount = minOf(mfcc.size, hpcp.size, rmsDb.size)
        if (frameCount <= 0) {
            return listOf(0.0)
        }

        val mfccNorm = zscore2d(mfcc.take(frameCount))
        val hpcpNorm = zscore2d(hpcp.take(frameCount))
        val rmsNorm = zscore1d(rmsDb.take(frameCount))

        val novelty = MutableList(frameCount) { 0.0 }
        for (i in 1 until frameCount) {
            currentCoroutineContext().ensureActive()
            var sum = 0.0
            val prev = mfccNorm[i - 1] + hpcpNorm[i - 1] + listOf(rmsNorm[i - 1])
            val cur = mfccNorm[i] + hpcpNorm[i] + listOf(rmsNorm[i])
            val dim = min(prev.size, cur.size)
            for (j in 0 until dim) {
                val delta = cur[j] - prev[j]
                sum += delta * delta
            }
            novelty[i] = sqrt(sum)
        }
        return novelty
    }

    private suspend fun segmentFromNovelty(
        frameTimes: List<Double>,
        novelty: List<Double>,
        beats: List<Double>,
        config: SegmentationConfig,
        duration: Double
    ): List<Double> {
        if (duration <= 0.0) {
            return listOf(0.0)
        }

        val smoothNovelty = smooth(novelty, max(1, config.noveltySmoothing))
        val peaks = findPeaks(
            smoothNovelty,
            height = config.peakThreshold,
            prominence = config.peakProminence
        )

        val boundaries = mutableListOf<Double>()
        boundaries += 0.0
        for (idx in peaks) {
            boundaries += frameTimes.getOrElse(idx) { 0.0 }
        }
        boundaries += duration

        val snapped = mutableListOf<Double>()
        snapped += 0.0

        for (i in 1 until boundaries.lastIndex) {
            currentCoroutineContext().ensureActive()
            val t = boundaries[i]
            var nearest = t
            if (beats.isNotEmpty()) {
                nearest = beats.minByOrNull { abs(it - t) } ?: t
            }
            snapped += if (abs(nearest - t) <= config.beatSnapTolerance) nearest else t
        }
        snapped += duration

        val unique = snapped
            .map { it.coerceIn(0.0, duration) }
            .toSortedSet()
            .toMutableList()

        if (unique.isEmpty() || unique.first() > 0.0) {
            unique.add(0, 0.0)
        }
        if (unique.last() < duration) {
            unique += duration
        }

        val merged = mutableListOf(unique.first())
        for (i in 1 until unique.size) {
            val candidate = unique[i]
            if (candidate - merged.last() < config.minSegmentDuration) {
                continue
            }
            merged += candidate
        }
        if (merged.last() < duration) {
            merged += duration
        }

        val maxSegments = max(1, floor(duration * config.maxSegmentsPerSecond).toInt())
        if (merged.size - 1 > maxSegments) {
            val step = max(1, floor((merged.size - 1).toDouble() / maxSegments.toDouble()).toInt())
            val trimmed = mutableListOf(merged.first())
            var idx = 1
            while (idx < merged.lastIndex) {
                trimmed += merged[idx]
                idx += step
            }
            trimmed += merged.last()
            return trimmed.toSortedSet().toList()
        }

        return merged
    }

    private suspend fun computeSegments(
        frameTimes: List<Double>,
        mfcc: List<List<Double>>,
        hpcp: List<List<Double>>,
        rmsDb: List<Double>,
        novelty: List<Double>,
        boundaries: List<Double>
    ): List<Segment> {
        val segments = mutableListOf<Segment>()

        for (i in 0 until max(0, boundaries.size - 1)) {
            currentCoroutineContext().ensureActive()
            val start = boundaries[i]
            val end = boundaries[i + 1]

            val indices = mutableListOf<Int>()
            for (j in frameTimes.indices) {
                val t = frameTimes[j]
                if (t >= start && t < end) {
                    indices += j
                }
            }

            if (indices.isEmpty()) {
                if (frameTimes.isEmpty()) {
                    val zeros = List(12) { 0.0 }
                    segments += Segment(
                        start = start,
                        duration = max(0.0, end - start),
                        confidence = 0.5,
                        loudnessStart = 0.0,
                        loudnessMax = 0.0,
                        loudnessMaxTime = 0.0,
                        pitches = zeros,
                        timbre = zeros
                    )
                    continue
                }

                var candidate = 0
                while (candidate < frameTimes.size && frameTimes[candidate] < start) {
                    candidate += 1
                }
                candidate = candidate.coerceIn(0, frameTimes.lastIndex)
                indices += candidate
            }

            val mfccFrames = indices.map { mfcc.getOrElse(it) { emptyList() } }
            val hpcpFrames = indices.map { hpcp.getOrElse(it) { emptyList() } }
            val rmsSeq = indices.map { rmsDb.getOrElse(it) { 0.0 } }
            val segTimes = indices.map { frameTimes.getOrElse(it) { start } }

            val weights = rmsSeq.map { 10.0.pow(it / 20.0) }.toMutableList()
            var weightSum = 0.0
            if (weights.isNotEmpty()) {
                val sorted = weights.sorted()
                val p10 = sorted[(0.1 * (sorted.size - 1)).toInt()]
                val p90 = sorted[(0.9 * (sorted.size - 1)).toInt()]
                for (idx in weights.indices) {
                    val clipped = weights[idx].coerceIn(p10, p90)
                    weights[idx] = clipped
                    weightSum += clipped
                }
            }

            val timbre = MutableList(12) { 0.0 }
            if (weightSum > 0.0) {
                for (row in mfccFrames.indices) {
                    val coeffs = mfccFrames[row]
                    val weight = weights.getOrElse(row) { 0.0 }
                    for (c in 0 until 12) {
                        timbre[c] += weight * (coeffs.getOrElse(c + 1) { 0.0 })
                    }
                }
                for (c in 0 until 12) {
                    timbre[c] /= weightSum
                }
            } else if (mfccFrames.isNotEmpty()) {
                val dim = mfccFrames.maxOf { it.size }
                val mean = MutableList(dim) { 0.0 }
                for (row in mfccFrames) {
                    for (c in 0 until dim) {
                        mean[c] += row.getOrElse(c) { 0.0 }
                    }
                }
                for (c in 0 until dim) {
                    mean[c] /= mfccFrames.size.toDouble()
                }
                for (c in 0 until 12) {
                    timbre[c] = mean.getOrElse(c + 1) { 0.0 }
                }
            }

            val pitches = MutableList(12) { 0.0 }
            if (hpcpFrames.isNotEmpty()) {
                for (row in hpcpFrames) {
                    for (c in 0 until 12) {
                        pitches[c] += row.getOrElse(c) { 0.0 }
                    }
                }
                for (c in 0 until 12) {
                    pitches[c] /= hpcpFrames.size.toDouble()
                }
            }
            val maxVal = pitches.maxOrNull() ?: 0.0
            if (maxVal > 0.0) {
                for (c in 0 until 12) {
                    pitches[c] /= maxVal
                }
            }

            val loudnessStart = rmsSeq.firstOrNull() ?: 0.0
            var loudnessMax = loudnessStart
            var loudnessMaxTime = 0.0
            if (rmsSeq.isNotEmpty()) {
                loudnessMax = rmsSeq.maxOrNull() ?: loudnessStart
                val maxIdx = rmsSeq.indexOf(loudnessMax).coerceAtLeast(0)
                loudnessMaxTime = segTimes.getOrElse(maxIdx) { start } - start
            }

            segments += Segment(
                start = start,
                duration = max(0.0, end - start),
                confidence = segmentConfidence(novelty, frameTimes, start),
                loudnessStart = loudnessStart,
                loudnessMax = loudnessMax,
                loudnessMaxTime = loudnessMaxTime,
                pitches = pitches,
                timbre = timbre
            )
        }

        return segments
    }

    private fun segmentConfidence(
        novelty: List<Double>,
        frameTimes: List<Double>,
        start: Double
    ): Double {
        if (novelty.isEmpty()) {
            return 0.5
        }

        var idx = 0
        while (idx < frameTimes.size && frameTimes[idx] < start) {
            idx += 1
        }
        idx = idx.coerceIn(0, novelty.lastIndex)

        val minValue = novelty.minOrNull() ?: 0.0
        val maxValue = novelty.maxOrNull() ?: minValue
        val range = maxValue - minValue
        if (range < 1e-6) {
            return 0.5
        }
        return (novelty[idx] - minValue) / range
    }

    private fun smooth(values: List<Double>, window: Int): List<Double> {
        if (window <= 1 || values.isEmpty()) {
            return values
        }
        val windowSize = max(1, window)
        val half = windowSize / 2
        return List(values.size) { i ->
            var acc = 0.0
            repeat(windowSize) { j ->
                val idx = (i - half + j).coerceIn(0, values.lastIndex)
                acc += values[idx]
            }
            acc / windowSize.toDouble()
        }
    }

    private fun findPeaks(
        values: List<Double>,
        height: Double,
        prominence: Double
    ): List<Int> {
        if (values.size < 3) {
            return emptyList()
        }

        val peaks = mutableListOf<Int>()
        for (i in 1 until values.lastIndex) {
            val current = values[i]
            if (current <= values[i - 1] || current < values[i + 1]) {
                continue
            }
            if (current < height) {
                continue
            }

            var leftMin = current
            for (j in i - 1 downTo 0) {
                leftMin = min(leftMin, values[j])
                if (values[j] > current) {
                    break
                }
            }

            var rightMin = current
            for (j in i + 1 until values.size) {
                rightMin = min(rightMin, values[j])
                if (values[j] > current) {
                    break
                }
            }

            val prom = current - max(leftMin, rightMin)
            if (prom >= prominence) {
                peaks += i
            }
        }
        return peaks
    }

    private fun zscore2d(values: List<List<Double>>): List<List<Double>> {
        if (values.isEmpty()) {
            return values
        }
        val dim = values.maxOf { it.size }
        if (dim == 0) {
            return values
        }

        val mean = MutableList(dim) { 0.0 }
        val std = MutableList(dim) { 0.0 }

        for (row in values) {
            for (i in 0 until dim) {
                mean[i] += row.getOrElse(i) { 0.0 }
            }
        }
        for (i in 0 until dim) {
            mean[i] /= values.size.toDouble()
        }

        for (row in values) {
            for (i in 0 until dim) {
                val delta = row.getOrElse(i) { 0.0 } - mean[i]
                std[i] += delta * delta
            }
        }
        for (i in 0 until dim) {
            std[i] = sqrt(std[i] / values.size.toDouble())
            if (std[i] < 1e-6) {
                std[i] = 1.0
            }
        }

        return values.map { row ->
            List(dim) { i ->
                (row.getOrElse(i) { 0.0 } - mean[i]) / std[i]
            }
        }
    }

    private fun zscore1d(values: List<Double>): List<Double> {
        if (values.isEmpty()) {
            return values
        }
        val mean = values.sum() / values.size.toDouble()
        var variance = 0.0
        for (value in values) {
            val delta = value - mean
            variance += delta * delta
        }
        val std = sqrt(variance / values.size.toDouble()).let { if (it < 1e-6) 1.0 else it }
        return values.map { (it - mean) / std }
    }

    private fun makeQuanta(
        starts: List<Double>,
        duration: Double,
        confidences: List<Double>? = null
    ): List<Quantum> {
        if (starts.isEmpty()) {
            return listOf(Quantum(0.0, max(0.0, duration), 1.0))
        }

        return starts.indices.map { index ->
            val start = starts[index]
            val end = starts.getOrElse(index + 1) { duration }
            Quantum(
                start = start,
                duration = max(0.0, end - start),
                confidence = confidences?.getOrNull(index)
            )
        }
    }

    private fun median(values: List<Double>): Double {
        if (values.isEmpty()) {
            return 0.0
        }
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 0) {
            (sorted[mid - 1] + sorted[mid]) / 2.0
        } else {
            sorted[mid]
        }
    }

    private fun computeTempo(beatTimes: List<Double>): Double {
        val tempos = mutableListOf<Double>()
        for (i in 0 until max(0, beatTimes.size - 1)) {
            val dt = beatTimes[i + 1] - beatTimes[i]
            if (dt > 0) {
                tempos += 60.0 / dt
            }
        }
        return median(tempos)
    }

    private suspend fun computeSections(
        bars: List<Quantum>,
        segments: List<Segment>,
        duration: Double
    ): List<Quantum> {
        if (bars.size <= 1) {
            return makeQuanta(listOf(0.0), duration, listOf(1.0))
        }

        val features = mutableListOf<List<Double>>()

        for (bar in bars) {
            currentCoroutineContext().ensureActive()
            val start = bar.start
            val end = bar.start + bar.duration
            val overlaps = segments.filter { seg ->
                seg.start < end && seg.start + seg.duration > start
            }

            if (overlaps.isEmpty()) {
                features += List(25) { 0.0 }
                continue
            }

            val pitches = MutableList(12) { 0.0 }
            val timbre = MutableList(12) { 0.0 }
            var loudSum = 0.0
            for (seg in overlaps) {
                for (i in 0 until 12) {
                    pitches[i] += seg.pitches.getOrElse(i) { 0.0 }
                    timbre[i] += seg.timbre.getOrElse(i) { 0.0 }
                }
                loudSum += (seg.loudnessStart + seg.loudnessMax) * 0.5
            }

            for (i in 0 until 12) {
                pitches[i] /= overlaps.size.toDouble()
                timbre[i] /= overlaps.size.toDouble()
            }

            val loudness = loudSum / overlaps.size.toDouble()
            features += pitches + timbre + listOf(loudness)
        }

        val normalized = zscore2d(features)
        val diffs = mutableListOf<Double>()
        for (i in 1 until normalized.size) {
            var sum = 0.0
            val dim = min(normalized[i].size, normalized[i - 1].size)
            for (j in 0 until dim) {
                val delta = normalized[i][j] - normalized[i - 1][j]
                sum += delta * delta
            }
            diffs += sqrt(sum)
        }

        val smoothed = smooth(diffs, 3)
        val candidates = mutableListOf<Int>()
        for (i in 1 until max(0, smoothed.size - 1)) {
            if (smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
                candidates += i
            }
        }

        candidates.sortByDescending { smoothed[it] }
        val selected = mutableListOf<Int>()
        val minGap = 8
        for (idx in candidates) {
            val barIndex = idx + 1
            if (selected.all { abs(barIndex - it) >= minGap }) {
                selected += barIndex
            }
        }
        selected.sort()

        val maxSections = 12
        val maxBoundaries = maxSections - 1
        if (selected.size > maxBoundaries) {
            selected.sortByDescending { smoothed[(it - 1).coerceAtLeast(0)] }
            while (selected.size > maxBoundaries) {
                selected.removeAt(selected.lastIndex)
            }
            selected.sort()
        }

        val sectionStarts = mutableListOf<Double>()
        sectionStarts += bars.first().start
        sectionStarts += selected.map { bars.getOrElse(it) { bars.last() }.start }

        val sectionConfidences = mutableListOf<Double>()
        var barIndex = 0
        for (i in sectionStarts.indices) {
            val start = sectionStarts[i]
            val end = sectionStarts.getOrElse(i + 1) { duration }
            val confidences = mutableListOf<Double>()
            while (barIndex < bars.size && bars[barIndex].start < end) {
                if (bars[barIndex].start >= start) {
                    bars[barIndex].confidence?.let { confidences += it }
                }
                barIndex += 1
            }
            sectionConfidences += if (confidences.isNotEmpty()) {
                confidences.sum() / confidences.size.toDouble()
            } else {
                1.0
            }
        }

        return makeQuanta(sectionStarts, duration, sectionConfidences)
    }

    private fun quantaJson(quanta: List<Quantum>): JsonArray = buildJsonArray {
        for (item in quanta) {
            add(
                buildJsonObject {
                    put("start", JsonPrimitive(item.start))
                    put("duration", JsonPrimitive(item.duration))
                    item.confidence?.let { put("confidence", JsonPrimitive(it)) }
                }
            )
        }
    }

    private fun segmentsJson(segments: List<Segment>): JsonArray = buildJsonArray {
        for (segment in segments) {
            add(
                buildJsonObject {
                    put("start", JsonPrimitive(segment.start))
                    put("duration", JsonPrimitive(segment.duration))
                    put("confidence", JsonPrimitive(segment.confidence))
                    put("loudness_start", JsonPrimitive(segment.loudnessStart))
                    put("loudness_max", JsonPrimitive(segment.loudnessMax))
                    put("loudness_max_time", JsonPrimitive(segment.loudnessMaxTime))
                    put(
                        "pitches",
                        buildJsonArray {
                            for (pitch in segment.pitches) {
                                add(JsonPrimitive(pitch))
                            }
                        }
                    )
                    put(
                        "timbre",
                        buildJsonArray {
                            for (value in segment.timbre) {
                                add(JsonPrimitive(value))
                            }
                        }
                    )
                }
            )
        }
    }
}

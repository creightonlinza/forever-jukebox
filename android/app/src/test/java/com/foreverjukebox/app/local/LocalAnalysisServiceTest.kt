package com.foreverjukebox.app.local

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class LocalAnalysisServiceTest {
    @Test
    fun emitsExpectedStageNamesAndCompletes() = runTest {
        val cacheDir = Files.createTempDirectory("fj-local-analysis-test").toFile()
        val service = LocalAnalysisService(
            decoder = FakeDecoder(),
            resampler = PassThroughResampler(),
            analyzer = FakeAnalyzer(),
            modelExtractor = NoopModelProvider(),
            cacheDir = cacheDir
        )

        val updates = service.analyze("file:///tmp/test.mp3", "Fixture Track").toList()
        val stageOrder = updates
            .filterIsInstance<LocalAnalysisUpdate.Progress>()
            .map { it.status }
            .distinct()

        assertTrue(stageOrder.contains("Processing audio"))
        assertTrue(stageOrder.contains("Processing features"))
        assertTrue(stageOrder.contains("Processing beats"))
        assertTrue(stageOrder.contains("Wrapping up"))
        assertTrue(updates.any { it is LocalAnalysisUpdate.Completed })
    }

    @Test
    fun writesAnalysisJsonArtifactToCache() = runTest {
        val cacheDir = Files.createTempDirectory("fj-local-analysis-test").toFile()
        val service = LocalAnalysisService(
            decoder = FakeDecoder(),
            resampler = PassThroughResampler(),
            analyzer = FakeAnalyzer(),
            modelExtractor = NoopModelProvider(),
            cacheDir = cacheDir
        )

        val updates = service.analyze("file:///tmp/test.mp3", "Fixture Track").toList()
        val completed = updates.filterIsInstance<LocalAnalysisUpdate.Completed>().first()

        assertTrue(completed.artifact.analysisJsonFile.exists())
        assertTrue(completed.artifact.analysisJsonFile.readText().contains("\"engine_version\""))
        assertTrue(completed.artifact.sourceUri.startsWith("file:///"))
    }
}

private class FakeDecoder : LocalAudioDecoderPort {
    override suspend fun decodeToMono(
        uriString: String,
        onDecodeProgress: (Int) -> Unit
    ): DecodedLocalAudio {
        onDecodeProgress(10)
        onDecodeProgress(60)
        onDecodeProgress(100)
        return DecodedLocalAudio(
            monoSamples = FloatArray(22_050) { 0f },
            sampleRate = 22_050,
            durationSeconds = 1.0,
            sourceUri = uriString,
            displayName = "Fixture Track"
        )
    }
}

private class PassThroughResampler : AudioResampler {
    override fun resample(samples: FloatArray, fromRate: Int, toRate: Int): FloatArray = samples
}

private class FakeAnalyzer : LocalAnalyzer {
    override suspend fun analyze(
        mono22050: FloatArray,
        mono44100: FloatArray,
        durationSeconds: Double,
        title: String?,
        artist: String?,
        madmomBeatsPortModels: List<File>,
        onStageProgress: (stage: String, percent: Int) -> Unit
    ) = buildJsonObject {
        onStageProgress("madmom beats", 50)
        onStageProgress("madmom beats", 100)
        put("engine_version", JsonPrimitive(2))
        put(
            "sections",
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("start", JsonPrimitive(0))
                        put("duration", JsonPrimitive(1))
                        put("confidence", JsonPrimitive(1))
                    }
                )
            }
        )
        put("bars", buildJsonArray { })
        put("beats", buildJsonArray { })
        put("tatums", buildJsonArray { })
        put("segments", buildJsonArray { })
        put(
            "track",
            buildJsonObject {
                put("duration", JsonPrimitive(1.0))
                put("tempo", JsonPrimitive(120))
                put("time_signature", JsonPrimitive(4))
            }
        )
    }
}

private class NoopModelProvider : MadmomBeatsPortModelProvider {
    override fun ensureExtracted(): List<File> = emptyList()
}

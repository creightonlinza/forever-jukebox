package com.foreverjukebox.app.local

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

class LocalAnalysisService(
    private val decoder: LocalAudioDecoderPort,
    private val resampler: AudioResampler,
    private val analyzer: LocalAnalyzer,
    private val modelExtractor: MadmomBeatsPortModelProvider,
    private val cacheDir: File
) {
    private val cancelled = AtomicBoolean(false)
    private val json = Json { ignoreUnknownKeys = true }

    fun cancel() {
        cancelled.set(true)
        NativeAnalysisBridge.cancel()
    }

    fun analyze(
        uriString: String,
        fallbackTitle: String?
    ): Flow<LocalAnalysisUpdate> = callbackFlow {
        cancelled.set(false)
        NativeAnalysisBridge.resetCancellationState()
        if (!cacheDir.exists()) {
            cacheDir.mkdirs()
        }
        val cacheKey = analysisCacheKey(uriString)
        val localId = "local-$cacheKey"
        val analysisFile = cacheDir.resolve("$cacheKey.analysis.json")
        logInfo("Local analysis start: localId=$localId")
        fun emitProgress(percent: Int, status: String) {
            trySend(
                LocalAnalysisUpdate.Progress(
                    percent = percent.coerceIn(0, 100),
                    status = status
                )
            )
        }

        try {
            withContext(Dispatchers.Default) {
                if (analysisFile.exists()) {
                    emitProgress(95, "Wrapping up")
                    val cachedText = analysisFile.readText()
                    val cachedJson = json.parseToJsonElement(cachedText)
                    emitProgress(100, "Wrapping up")
                    trySend(
                        LocalAnalysisUpdate.Completed(
                            LocalAnalysisArtifact(
                                localId = localId,
                                analysisJson = cachedJson,
                                analysisJsonFile = analysisFile,
                                sourceUri = uriString,
                                title = extractTrackField(cachedJson, "title") ?: fallbackTitle,
                                artist = extractTrackField(cachedJson, "artist")
                            )
                        )
                    )
                    close()
                    return@withContext
                }

                emitProgress(1, "Processing audio")
                logInfo("Stage Decoding start")
                val decoded = decoder.decodeToMono(uriString) { decodePercent ->
                    val mapped = 1 + (decodePercent * 0.19).toInt()
                    emitProgress(mapped, "Processing audio")
                }
                logInfo(
                    "Stage Decoding complete: samples=${decoded.monoSamples.size}, sampleRate=${decoded.sampleRate}, heap=${heapSummary()}"
                )
                ensureNotCancelled()

                emitProgress(22, "Processing audio")
                val monoSource = decoded.monoSamples
                ensureNotCancelled()

                emitProgress(30, "Processing audio")
                logInfo("Stage Resample 22050 start: sourceSamples=${monoSource.size}, heap=${heapSummary()}")
                val mono22050 = resampler.resample(monoSource, decoded.sampleRate, 22_050)
                decoded.monoSamples = FloatArray(0)
                logInfo("Stage Resample 22050 complete: samples=${mono22050.size}, heap=${heapSummary()}")
                ensureNotCancelled()

                emitProgress(45, "Processing features")
                ensureNotCancelled()

                emitProgress(62, "Processing audio")
                logInfo("Stage Upsample 44100 start: sourceSamples=${mono22050.size}, heap=${heapSummary()}")
                val mono44100 = resampler.resample(mono22050, 22_050, 44_100)
                logInfo("Stage Upsample 44100 complete: samples=${mono44100.size}, heap=${heapSummary()}")
                ensureNotCancelled()

                val madmomBeatsPortModels = modelExtractor.ensureExtracted()
                logInfo("madmom_beats_port models ready: count=${madmomBeatsPortModels.size}")

                val analysisJson = analyzer.analyze(
                    mono22050 = mono22050,
                    mono44100 = mono44100,
                    durationSeconds = decoded.durationSeconds,
                    title = decoded.displayName ?: fallbackTitle,
                    artist = null,
                    madmomBeatsPortModels = madmomBeatsPortModels
                ) { stage, stagePercent ->
                    val mapped = when (stage) {
                        "madmom beats" -> 70 + (stagePercent * 0.20).toInt()
                        else -> null
                    }
                    if (mapped != null) {
                        emitProgress(mapped, "Processing beats")
                    }
                }
                logInfo("Stage Analyzer complete: heap=${heapSummary()}")
                ensureNotCancelled()

                emitProgress(95, "Wrapping up")
                analysisFile.writeText(analysisJson.toString())

                emitProgress(100, "Wrapping up")
                trySend(
                    LocalAnalysisUpdate.Completed(
                        LocalAnalysisArtifact(
                            localId = localId,
                            analysisJson = analysisJson,
                            analysisJsonFile = analysisFile,
                            sourceUri = decoded.sourceUri,
                            title = decoded.displayName ?: fallbackTitle,
                            artist = null
                        )
                    )
                )
                close()
            }
        } catch (cancelledError: CancellationException) {
            logInfo("Local analysis cancelled: localId=$localId")
            close(cancelledError)
        } catch (unsupported: UnsupportedAudioFormatException) {
            logError("Local analysis unsupported format: ${unsupported.message}", unsupported)
            close(unsupported)
        } catch (error: Throwable) {
            logError("Local analysis failed: ${error.message}", error)
            close(error)
        }

        awaitClose {}
    }

    private suspend fun ensureNotCancelled() {
        currentCoroutineContext().ensureActive()
        if (cancelled.get()) {
            throw CancellationException("Local analysis cancelled")
        }
    }

    companion object {
        private const val TAG = "LocalAnalysisService"

        private fun heapSummary(): String {
            val runtime = Runtime.getRuntime()
            val usedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
            val maxMb = runtime.maxMemory() / (1024 * 1024)
            return "${usedMb}MB/${maxMb}MB"
        }

        private fun logInfo(message: String) {
            runCatching { Log.i(TAG, message) }
        }

        private fun logError(message: String, error: Throwable? = null) {
            runCatching { Log.e(TAG, message, error) }
        }

        private fun analysisCacheKey(uriString: String): String {
            val hash = MessageDigest.getInstance("SHA-256")
                .digest(uriString.toByteArray(Charsets.UTF_8))
            return hash.take(8).joinToString("") { "%02x".format(it) }
        }

        private fun extractTrackField(analysisJson: JsonElement, field: String): String? {
            val track = analysisJson.jsonObject["track"]?.jsonObject ?: return null
            return (track[field] as? JsonPrimitive)?.contentOrNull
        }

        fun create(context: Context): LocalAnalysisService {
            return LocalAnalysisService(
                decoder = LocalAudioDecoder(context),
                resampler = NativeSpeexAudioResampler(),
                analyzer = NativeLocalAnalyzer(),
                modelExtractor = MadmomBeatsPortModelExtractor(context),
                cacheDir = File(context.cacheDir, "jukebox-cache")
            )
        }
    }
}

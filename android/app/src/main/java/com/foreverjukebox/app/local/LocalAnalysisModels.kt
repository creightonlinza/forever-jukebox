package com.foreverjukebox.app.local

import kotlinx.serialization.json.JsonElement
import java.io.File

data class DecodedLocalAudio(
    var monoSamples: FloatArray,
    val sampleRate: Int,
    val durationSeconds: Double,
    val sourceUri: String,
    val displayName: String?
)

data class LocalAnalysisArtifact(
    val localId: String,
    val analysisJson: JsonElement,
    val analysisJsonFile: File,
    val sourceUri: String,
    val title: String?,
    val artist: String?
)

sealed interface LocalAnalysisUpdate {
    data class Progress(
        val percent: Int,
        val status: String
    ) : LocalAnalysisUpdate

    data class Completed(
        val artifact: LocalAnalysisArtifact
    ) : LocalAnalysisUpdate
}

package com.foreverjukebox.app.ui

import com.foreverjukebox.app.visualization.visualizationCount
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class CastStatusMessage(
    val songId: String,
    val title: String,
    val artist: String,
    val trackDurationSeconds: Double?,
    val totalBeats: Int?,
    val totalBranches: Int?,
    val isPlaying: Boolean,
    val isLoading: Boolean,
    val playbackState: String,
    val error: String,
    val activeVizIndex: Int?,
    val resolvedThreshold: Int?
)

fun parseCastStatusMessage(message: String): CastStatusMessage? {
    val json = runCatching { Json.parseToJsonElement(message).jsonObject }.getOrNull() ?: return null
    val type = json["type"]?.jsonPrimitive?.contentOrNull
    if (type != "status") {
        return null
    }

    fun stringField(name: String): String {
        return json[name]
            ?.jsonPrimitive
            ?.contentOrNull
            ?.takeUnless { it == "null" }
            ?: ""
    }

    val songId = stringField("songId")
    val title = stringField("title")
    val artist = stringField("artist")
    val trackDurationSeconds = json["trackDurationSeconds"]
        ?.jsonPrimitive
        ?.contentOrNull
        ?.toDoubleOrNull()
        ?.takeIf { it > 0.0 }
    val totalBeats = json["totalBeats"]
        ?.jsonPrimitive
        ?.contentOrNull
        ?.toIntOrNull()
        ?.takeIf { it >= 0 }
    val totalBranches = json["totalBranches"]
        ?.jsonPrimitive
        ?.contentOrNull
        ?.toIntOrNull()
        ?.takeIf { it >= 0 }
    val isPlaying = json["isPlaying"]?.jsonPrimitive?.booleanOrNull ?: false
    val isLoading = json["isLoading"]?.jsonPrimitive?.booleanOrNull ?: false
    val playbackState = stringField("playbackState")
    val error = stringField("error")
    val activeVizIndex = json["activeVizIndex"]?.jsonPrimitive?.intOrNull
    val resolvedThreshold = json["resolvedThreshold"]
        ?.jsonPrimitive
        ?.contentOrNull
        ?.toIntOrNull()
        ?.takeIf { it >= 2 }
    return CastStatusMessage(
        songId = songId,
        title = title,
        artist = artist,
        trackDurationSeconds = trackDurationSeconds,
        totalBeats = totalBeats,
        totalBranches = totalBranches,
        isPlaying = isPlaying,
        isLoading = isLoading,
        playbackState = playbackState,
        error = error,
        activeVizIndex = activeVizIndex,
        resolvedThreshold = resolvedThreshold
    )
}

fun reduceCastStatus(current: UiState, status: CastStatusMessage): UiState {
    val hasTitle = status.title.isNotBlank()
    val hasArtist = status.artist.isNotBlank()
    val displayTitle = if (hasArtist) {
        "${if (hasTitle) status.title else "Unknown"} — ${status.artist}"
    } else if (hasTitle) {
        status.title
    } else {
        null
    }
    val resolvedIsLoading = when (status.playbackState) {
        "loading" -> true
        "playing", "paused", "idle", "error" -> false
        else -> status.isLoading
    }
    val resolvedIsRunning = when (status.playbackState) {
        "playing" -> true
        "paused", "idle", "error" -> false
        "loading" -> current.playback.isRunning
        else -> if (resolvedIsLoading) current.playback.isRunning else status.isPlaying
    }
    val nextPlayback = current.playback.copy(
        playMode = PlaybackMode.Jukebox,
        isRunning = resolvedIsRunning,
        playTitle = displayTitle ?: current.playback.playTitle,
        trackTitle = if (hasTitle) status.title else current.playback.trackTitle,
        trackArtist = if (hasArtist) status.artist else current.playback.trackArtist,
        trackDurationSeconds = status.trackDurationSeconds ?: current.playback.trackDurationSeconds,
        castTotalBeats = status.totalBeats ?: current.playback.castTotalBeats,
        castTotalBranches = status.totalBranches ?: current.playback.castTotalBranches,
        lastYouTubeId = if (status.songId.isBlank()) current.playback.lastYouTubeId else status.songId,
        analysisErrorMessage = if (status.error.isNotBlank()) status.error else current.playback.analysisErrorMessage,
        analysisInFlight = resolvedIsLoading,
        isCastLoading = resolvedIsLoading,
        activeVizIndex = if ((status.activeVizIndex ?: -1) in 0 until visualizationCount) {
            status.activeVizIndex ?: current.playback.activeVizIndex
        } else {
            current.playback.activeVizIndex
        }
    )
    return current.copy(
        playback = nextPlayback,
        tuning = if (status.resolvedThreshold != null) {
            current.tuning.copy(threshold = status.resolvedThreshold)
        } else {
            current.tuning
        }
    )
}

package com.foreverjukebox.app.ui

import com.foreverjukebox.app.data.AppMode
import com.foreverjukebox.app.data.SpotifySearchItem
import com.foreverjukebox.app.data.ThemeMode
import com.foreverjukebox.app.data.TopSongItem
import com.foreverjukebox.app.data.YoutubeSearchItem
import com.foreverjukebox.app.data.FavoriteTrack
import com.foreverjukebox.app.autocanonizer.AutocanonizerData
import com.foreverjukebox.app.engine.VisualizationData
import com.foreverjukebox.app.visualization.JumpLine
import com.foreverjukebox.app.visualization.defaultVisualizationIndex
import kotlinx.serialization.Serializable
import java.net.URI

enum class TabId {
    Input,
    Top,
    Search,
    Play,
    Faq
}

enum class TopSongsTab {
    TopSongs,
    Trending,
    Recent,
    Favorites
}

enum class PlaybackMode {
    Jukebox,
    Autocanonizer
}

data class UiState(
    val appMode: AppMode? = null,
    val baseUrl: String = "",
    val castEnabled: Boolean = false,
    val showAppModeGate: Boolean = true,
    val showBaseUrlPrompt: Boolean = false,
    val localSelectedFileName: String? = null,
    val localAnalysisJsonPath: String? = null,
    val themeMode: ThemeMode = ThemeMode.System,
    val activeTab: TabId = TabId.Top,
    val topSongsTab: TopSongsTab = TopSongsTab.TopSongs,
    val cacheSizeBytes: Long = 0,
    val favorites: List<FavoriteTrack> = emptyList(),
    val favoritesSyncCode: String? = null,
    val allowFavoritesSync: Boolean = false,
    val maxTrackLengthMinutes: Double? = null,
    val trackLengthLimitErrorMessage: String? = null,
    val favoritesSyncLoading: Boolean = false,
    val versionUpdatePrompt: VersionUpdatePrompt? = null,
    val search: SearchState = SearchState(),
    val playback: PlaybackState = PlaybackState(),
    val tuning: TuningState = TuningState()
)

data class VersionUpdatePrompt(
    val latestVersion: String,
    val downloadUrl: String
)

data class SearchState(
    val query: String = "",
    val topSongs: List<TopSongItem> = emptyList(),
    val topSongsLoading: Boolean = false,
    val trendingSongs: List<TopSongItem> = emptyList(),
    val trendingSongsLoading: Boolean = false,
    val recentSongs: List<TopSongItem> = emptyList(),
    val recentSongsLoading: Boolean = false,
    val spotifyResults: List<SpotifySearchItem> = emptyList(),
    val spotifyLoading: Boolean = false,
    val youtubeMatches: List<YoutubeSearchItem> = emptyList(),
    val youtubeLoading: Boolean = false,
    val pendingTrackName: String? = null,
    val pendingTrackArtist: String? = null
)

data class PlaybackState(
    val playMode: PlaybackMode = PlaybackMode.Jukebox,
    val canonizerFinishOutSong: Boolean = false,
    val analysisProgress: Int? = null,
    val analysisMessage: String? = null,
    val analysisErrorMessage: String? = null,
    val analysisInFlight: Boolean = false,
    val analysisCalculating: Boolean = false,
    val audioLoading: Boolean = false,
    val playTitle: String = "",
    val audioLoaded: Boolean = false,
    val analysisLoaded: Boolean = false,
    val isRunning: Boolean = false,
    val isPaused: Boolean = false,
    val beatsPlayed: Int = 0,
    val listenTime: String = "00:00:00",
    val trackDurationSeconds: Double? = null,
    val castTotalBeats: Int? = null,
    val castTotalBranches: Int? = null,
    val trackTitle: String? = null,
    val trackArtist: String? = null,
    val vizData: VisualizationData? = null,
    val autocanonizerData: AutocanonizerData? = null,
    val activeVizIndex: Int = defaultVisualizationIndex,
    val currentBeatIndex: Int = -1,
    val canonizerOtherIndex: Int? = null,
    val canonizerTileColorOverrides: Map<Int, String> = emptyMap(),
    val lastJumpFromIndex: Int? = null,
    val jumpLine: JumpLine? = null,
    val lastJobId: String? = null,
    val lastYouTubeId: String? = null,
    val isCastLoading: Boolean = false,
    val deleteEligible: Boolean = false,
    val isCasting: Boolean = false,
    val castDeviceName: String? = null
)

data class TuningState(
    val threshold: Int = 2,
    val minProb: Int = 18,
    val maxProb: Int = 50,
    val ramp: Int = 2,
    val highlightAnchorBranch: Boolean = false,
    val justBackwards: Boolean = false,
    val justLong: Boolean = false,
    val removeSequential: Boolean = false
)

@Serializable
data class TrackMetaJson(
    val title: String? = null,
    val artist: String? = null,
    val duration: Double? = null
)

val serverModeTabs: List<TabId> = listOf(TabId.Top, TabId.Search, TabId.Play, TabId.Faq)
val localModeTabs: List<TabId> = listOf(TabId.Input, TabId.Play, TabId.Faq)
val defaultOnboardingMode: AppMode = AppMode.Local

fun tabsForMode(mode: AppMode?): List<TabId> {
    return when (mode) {
        AppMode.Local -> localModeTabs
        AppMode.Server, null -> serverModeTabs
    }
}

fun defaultTabForMode(mode: AppMode?): TabId {
    return when (mode) {
        AppMode.Local -> TabId.Input
        AppMode.Server, null -> TabId.Top
    }
}

fun coerceTabForMode(mode: AppMode?, tabId: TabId): TabId {
    return if (tabsForMode(mode).contains(tabId)) {
        tabId
    } else {
        defaultTabForMode(mode)
    }
}

fun shouldShowAppModeGate(mode: AppMode?): Boolean = mode == null

fun shouldShowBaseUrlPrompt(mode: AppMode?, baseUrl: String): Boolean {
    return mode == AppMode.Server && !isValidBaseUrl(baseUrl)
}

fun shouldShowServerListenActions(mode: AppMode?): Boolean = mode == AppMode.Server

fun shouldShowLocalLoadingCancel(mode: AppMode?, playback: PlaybackState): Boolean {
    return mode == AppMode.Local &&
        !playback.isCasting &&
        (playback.analysisInFlight || playback.analysisCalculating || playback.audioLoading)
}

fun PlaybackState.hasCastTrack(): Boolean {
    return lastYouTubeId != null || lastJobId != null
}

fun PlaybackState.castControlsReady(): Boolean {
    return isCasting &&
        hasCastTrack() &&
        !isCastLoading &&
        !analysisInFlight &&
        analysisErrorMessage.isNullOrBlank()
}

fun shouldShowPlaybackTransport(playback: PlaybackState): Boolean {
    return !playback.isCasting || playback.castControlsReady()
}

fun resolvePlaybackHeaderTitle(playback: PlaybackState): String? {
    if (playback.isCasting && (playback.isCastLoading || playback.analysisInFlight)) {
        return "Loading track on cast device..."
    }
    return playback.playTitle.takeIf { it.isNotBlank() }
}

fun PlaybackState.shouldShowCastNotification(): Boolean {
    if (!isCasting) return false
    if (isRunning) return true
    if (!trackTitle.isNullOrBlank() || !trackArtist.isNullOrBlank()) return true
    if (!lastYouTubeId.isNullOrBlank() || !lastJobId.isNullOrBlank()) return true
    return playTitle.isNotBlank()
}

fun PlaybackState.castNotificationTitle(): String? {
    val title = trackTitle?.takeIf { it.isNotBlank() }
    if (title != null) {
        return title
    }
    val fallback = playTitle.takeIf { it.isNotBlank() } ?: return null
    val split = fallback.substringBefore(" — ").trim()
    return split.ifBlank { fallback }
}

fun shouldCancelLocalAnalysisOnTabChange(
    mode: AppMode?,
    isLocalAnalysisRunning: Boolean,
    targetTab: TabId
): Boolean {
    if (mode != AppMode.Local || !isLocalAnalysisRunning) {
        return false
    }
    return when (targetTab) {
        TabId.Input, TabId.Play, TabId.Faq -> false
        TabId.Top, TabId.Search -> false
    }
}

fun shouldCancelLocalAnalysisOnInputChange(
    mode: AppMode?,
    isLocalAnalysisRunning: Boolean
): Boolean {
    return mode == AppMode.Local && isLocalAnalysisRunning
}

fun stateAfterModeChangeReset(
    current: UiState,
    targetMode: AppMode,
    castEnabled: Boolean
): UiState {
    return current.copy(
        appMode = targetMode,
        showAppModeGate = false,
        showBaseUrlPrompt = shouldShowBaseUrlPrompt(targetMode, current.baseUrl),
        castEnabled = castEnabled,
        localSelectedFileName = null,
        localAnalysisJsonPath = null,
        activeTab = defaultTabForMode(targetMode),
        topSongsTab = TopSongsTab.TopSongs,
        search = SearchState(),
        playback = PlaybackState(),
        tuning = TuningState(highlightAnchorBranch = current.tuning.highlightAnchorBranch)
    )
}

fun stateAfterLocalAnalysisCancel(current: UiState): UiState {
    return current.copy(
        activeTab = TabId.Input,
        localSelectedFileName = null,
        localAnalysisJsonPath = null
    )
}

fun isValidBaseUrl(value: String): Boolean {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return false
    val parsed = runCatching { URI(trimmed) }.getOrNull() ?: return false
    val scheme = parsed.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return false
    return !parsed.host.isNullOrBlank()
}

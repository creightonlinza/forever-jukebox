package com.foreverjukebox.app.ui

import android.app.Application
import android.net.Uri
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.foreverjukebox.app.data.ApiClient
import com.foreverjukebox.app.data.AppPreferences
import com.foreverjukebox.app.data.AnalysisResponse
import com.foreverjukebox.app.data.FavoriteSourceType
import com.foreverjukebox.app.data.FavoriteTrack
import com.foreverjukebox.app.data.SpotifySearchItem
import com.foreverjukebox.app.data.ThemeMode
import com.foreverjukebox.app.playback.ForegroundPlaybackService
import com.foreverjukebox.app.playback.PlaybackControllerHolder
import com.foreverjukebox.app.visualization.JumpLine
import com.foreverjukebox.app.visualization.visualizationCount
import com.foreverjukebox.app.cast.CastAppIdResolver
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlin.math.roundToInt
import org.json.JSONObject

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = AppPreferences(application)
    private val api = ApiClient()
    private val controller = PlaybackControllerHolder.get(application)
    private val engine = controller.engine
    private val defaultConfig = engine.getConfig()
    private val json = Json { ignoreUnknownKeys = true }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private var refreshTopSongsJob: Job? = null
    private var topSongsLoaded = false
    private var appConfigLoaded = false
    private val tabHistory = ArrayDeque<TabId>()
    private val castController = CastController(getApplication())
    private val favoritesController = FavoritesController(
        scope = viewModelScope,
        api = api,
        preferences = preferences,
        getState = { state.value },
        updateState = { updater -> _state.update(updater) },
        showToast = ::showToast
    )
    private val playbackCoordinator = PlaybackCoordinator(
        application = getApplication(),
        scope = viewModelScope,
        api = api,
        controller = controller,
        engine = engine,
        json = json,
        defaultConfig = defaultConfig,
        getState = { state.value },
        updateState = { updater -> _state.update(updater) },
        updatePlaybackState = ::updatePlaybackState,
        applyActiveTab = ::applyActiveTab
    )

    init {
        viewModelScope.launch {
            preferences.baseUrl.collect { url ->
                val resolvedAppId = CastAppIdResolver.resolve(getApplication(), url)
                _state.update { current ->
                    current.copy(
                        baseUrl = url.orEmpty(),
                        showBaseUrlPrompt = url.isNullOrBlank(),
                        castEnabled = !resolvedAppId.isNullOrBlank()
                    )
                }
                if (!url.isNullOrBlank()) {
                    if (!appConfigLoaded) {
                        appConfigLoaded = true
                        viewModelScope.launch {
                            runCatching { api.getAppConfig(url).also { preferences.setAppConfig(it) } }
                        }
                    }
                    if (state.value.activeTab == TabId.Top && !topSongsLoaded) {
                        refreshTopSongs()
                    }
                    favoritesController.maybeHydrateFavoritesFromSync()
                }
            }
        }
        viewModelScope.launch {
            preferences.favorites.collect { favorites ->
                val sorted = favoritesController.sortFavorites(favorites).take(MAX_FAVORITES)
                if (sorted.size != favorites.size) {
                    favoritesController.updateFavorites(sorted, sync = false)
                } else {
                    _state.update { it.copy(favorites = sorted) }
                }
            }
        }
        viewModelScope.launch {
            preferences.favoritesSyncCode.collect { code ->
                _state.update { it.copy(favoritesSyncCode = code) }
                favoritesController.maybeHydrateFavoritesFromSync()
            }
        }
        viewModelScope.launch {
            preferences.appConfig.collect { config ->
                if (config != null) {
                    _state.update { it.copy(allowFavoritesSync = config.allowFavoritesSync) }
                    favoritesController.maybeHydrateFavoritesFromSync()
                }
            }
        }
        viewModelScope.launch {
            preferences.themeMode.collect { mode ->
                _state.update { it.copy(themeMode = mode) }
            }
        }
        viewModelScope.launch {
            preferences.activeVizIndex.collect { index ->
                val resolvedIndex = if (index in 0 until visualizationCount) index else 0
                _state.update {
                    it.copy(playback = it.playback.copy(activeVizIndex = resolvedIndex))
                }
            }
        }
        engine.onUpdate { engineState ->
            val currentBeatIndex = engineState.currentBeatIndex
            val lastJumpFrom = engineState.lastJumpFromIndex
            val jumpLine = if (engineState.lastJumped && lastJumpFrom != null) {
                JumpLine(lastJumpFrom, currentBeatIndex, SystemClock.elapsedRealtime())
            } else {
                null
            }
            _state.update {
                it.copy(
                    playback = it.playback.copy(
                        beatsPlayed = engineState.beatsPlayed,
                        currentBeatIndex = currentBeatIndex,
                        lastJumpFromIndex = lastJumpFrom,
                        jumpLine = jumpLine
                    )
                )
            }
            playbackCoordinator.maybeUpdateNotification()
        }

        playbackCoordinator.restorePlaybackState()
    }

    override fun onCleared() {
        super.onCleared()
        playbackCoordinator.onCleared()
        controller.player.release()
    }

    fun setBaseUrl(url: String) {
        viewModelScope.launch {
            preferences.setBaseUrl(url.trim())
            delay(100)
            refreshTopSongs()
        }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch {
            preferences.setThemeMode(mode)
        }
    }

    fun setActiveTab(tabId: TabId) {
        if (tabId == TabId.Top && state.value.activeTab == TabId.Top) {
            setTopSongsTab(TopSongsTab.TopSongs)
            return
        }
        applyActiveTab(tabId, recordHistory = true)
    }

    fun canNavigateBack(): Boolean = tabHistory.isNotEmpty()

    fun navigateBack(): Boolean {
        if (tabHistory.isEmpty()) return false
        val previous = tabHistory.removeLast()
        applyActiveTab(previous, recordHistory = false)
        return true
    }

    fun setTopSongsTab(tab: TopSongsTab) {
        _state.update { it.copy(topSongsTab = tab) }
    }

    fun refreshFavoritesFromSync() {
        favoritesController.refreshFavoritesFromSync()
    }

    fun createFavoritesSyncCode() {
        favoritesController.createFavoritesSyncCode()
    }

    suspend fun fetchFavoritesPreview(code: String): List<FavoriteTrack>? {
        return favoritesController.fetchFavoritesPreview(code)
    }

    fun applyFavoritesSync(code: String, favorites: List<FavoriteTrack>) {
        favoritesController.applyFavoritesSync(code, favorites)
    }

    private fun applyActiveTab(tabId: TabId, recordHistory: Boolean) {
        val current = state.value.activeTab
        if (tabId == current) return
        if (recordHistory && tabHistory.lastOrNull() != current) {
            tabHistory.addLast(current)
        }
        _state.update {
            val nextTopTab = if (tabId == TabId.Top) TopSongsTab.TopSongs else it.topSongsTab
            it.copy(activeTab = tabId, topSongsTab = nextTopTab)
        }
        if (tabId == TabId.Top) {
            scheduleTopSongsRefresh()
        }
        if (tabId != TabId.Play) {
            _state.update { it.copy(playback = it.playback.copy()) }
        }
    }

    private fun scheduleTopSongsRefresh() {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank() || topSongsLoaded) return
        refreshTopSongsJob?.cancel()
        refreshTopSongsJob = viewModelScope.launch {
            delay(250)
            refreshTopSongs()
        }
    }

    private fun updateSearchState(transform: (SearchState) -> SearchState) {
        _state.update { it.copy(search = transform(it.search)) }
    }

    private fun setSearchQuery(value: String) {
        updateSearchState { it.copy(query = value) }
    }

    private fun updatePlaybackState(transform: (PlaybackState) -> PlaybackState) {
        _state.update { it.copy(playback = transform(it.playback)) }
    }

    private fun resolveTrackMeta(youtubeId: String): Pair<String?, String?> {
        val topMatch = state.value.search.topSongs.firstOrNull { it.youtubeId == youtubeId }
        if (topMatch != null) {
            return topMatch.title to topMatch.artist
        }
        val favoriteMatch = state.value.favorites.firstOrNull { it.uniqueSongId == youtubeId }
        if (favoriteMatch != null) {
            return favoriteMatch.title to favoriteMatch.artist
        }
        return null to null
    }

    private suspend fun maybeRepairMissing(
        response: AnalysisResponse
    ): AnalysisResponse {
        return response
    }

    fun toggleFavoriteForCurrent(): Boolean {
        val currentId = state.value.playback.lastYouTubeId ?: return false
        val favorites = state.value.favorites
        val existing = favorites.any { it.uniqueSongId == currentId }
        return if (existing) {
            favoritesController.updateFavorites(favorites.filterNot { it.uniqueSongId == currentId })
            false
        } else {
            if (favorites.size >= MAX_FAVORITES) {
                true
            } else {
                val playback = state.value.playback
                val title = playback.trackTitle?.takeIf { it.isNotBlank() } ?: "Untitled"
                val artist = playback.trackArtist?.takeIf { it.isNotBlank() } ?: "Unknown"
                val newFavorite = FavoriteTrack(
                    uniqueSongId = currentId,
                    title = title,
                    artist = artist,
                    duration = playback.trackDurationSeconds,
                    sourceType = FavoriteSourceType.Youtube,
                    tuningParams = playbackCoordinator.buildTuningParamsString()
                )
                favoritesController.updateFavorites(favorites + newFavorite)
                false
            }
        }
    }

    fun removeFavorite(uniqueSongId: String) {
        val favorites = state.value.favorites
        if (favorites.none { it.uniqueSongId == uniqueSongId }) return
        favoritesController.updateFavorites(favorites.filterNot { it.uniqueSongId == uniqueSongId })
    }

    fun refreshTopSongs() {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        topSongsLoaded = true
        viewModelScope.launch {
            updateSearchState { it.copy(topSongsLoading = true) }
            try {
                val items = api.fetchTopSongs(baseUrl)
                updateSearchState { it.copy(topSongs = items) }
            } catch (err: Exception) {
                updateSearchState { it.copy(topSongs = emptyList()) }
            } finally {
                updateSearchState { it.copy(topSongsLoading = false) }
            }
        }
    }

    fun runSpotifySearch(query: String) {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        setSearchQuery(query)
        _state.update {
            it.copy(
                search = it.search.copy(
                    youtubeMatches = emptyList(),
                    spotifyResults = emptyList(),
                    spotifyLoading = true
                )
            )
        }
        viewModelScope.launch {
            try {
                val items = api.searchSpotify(baseUrl, query).take(10)
                updateSearchState { it.copy(spotifyResults = items) }
            } catch (_: Exception) {
                updateSearchState { it.copy(spotifyResults = emptyList()) }
            } finally {
                updateSearchState { it.copy(spotifyLoading = false) }
            }
        }
    }

    fun selectSpotifyTrack(item: SpotifySearchItem) {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        val name = item.name ?: "Untitled"
        val artist = item.artist ?: ""
        val duration = item.duration ?: return
        viewModelScope.launch {
            if (artist.isNotBlank()) {
                try {
                    val response = maybeRepairMissing(
                        api.getJobByTrack(baseUrl, name, artist)
                    )
                    val jobId = response.id
                    val youtubeId = response.youtubeId
                    if (jobId != null && youtubeId != null && response.status != "failed") {
                        if (state.value.playback.isCasting) {
                            castTrackId(youtubeId, name, artist, null)
                            applyActiveTab(TabId.Play, recordHistory = true)
                            return@launch
                        }
                        loadExistingJob(
                            jobId,
                            youtubeId,
                            response,
                            name,
                            artist
                        )
                        return@launch
                    }
                } catch (_: Exception) {
                    // Fall back to YouTube matches.
                    if (state.value.playback.isCasting) {
                        showToast("Only existing songs can be cast.")
                        return@launch
                    }
                }
            }
            if (state.value.playback.isCasting) {
                showToast("Only existing songs can be cast.")
                return@launch
            }
            fetchYoutubeMatches(name, artist, duration)
        }
    }

    fun fetchYoutubeMatches(name: String, artist: String, duration: Double) {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        val query = if (artist.isNotBlank()) "$artist - $name" else name
        _state.update {
            it.copy(
                search = it.search.copy(
                    pendingTrackName = name,
                    pendingTrackArtist = artist,
                    spotifyResults = emptyList(),
                    youtubeMatches = emptyList(),
                    youtubeLoading = true
                )
            )
        }
        viewModelScope.launch {
            try {
                val items = api.searchYoutube(baseUrl, query, duration).take(10)
                updateSearchState { it.copy(youtubeMatches = items) }
            } catch (_: Exception) {
                updateSearchState { it.copy(youtubeMatches = emptyList()) }
            } finally {
                updateSearchState { it.copy(youtubeLoading = false) }
            }
        }
    }

    fun startYoutubeAnalysis(youtubeId: String, title: String? = null, artist: String? = null) {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        val resolvedTitle = title ?: state.value.search.pendingTrackName.orEmpty()
        val resolvedArtist = artist ?: state.value.search.pendingTrackArtist.orEmpty()
        if (state.value.playback.isCasting) {
            castTrackId(youtubeId, resolvedTitle, resolvedArtist, null)
            _state.update {
                it.copy(playback = it.playback.copy(lastYouTubeId = youtubeId))
            }
            applyActiveTab(TabId.Play, recordHistory = true)
            return
        }
        playbackCoordinator.resetForNewTrack()
        _state.update {
            it.copy(
                search = it.search.copy(
                    query = "",
                    spotifyResults = emptyList(),
                    youtubeMatches = emptyList(),
                    youtubeLoading = false,
                    pendingTrackName = null,
                    pendingTrackArtist = null
                ),
                playback = it.playback.copy(
                    audioLoading = false,
                    lastYouTubeId = youtubeId
                )
            )
        }
        applyActiveTab(TabId.Play, recordHistory = true)
        viewModelScope.launch {
            if (playbackCoordinator.tryLoadCachedTrack(youtubeId)) {
                return@launch
            }
            playbackCoordinator.setAnalysisQueued(null, "Fetching audio...")
            try {
                val response = api.startYoutubeAnalysis(
                    baseUrl,
                    youtubeId,
                    resolvedTitle,
                    resolvedArtist
                )
                if (response.id == null) {
                    throw IllegalStateException("Invalid job response")
                }
                playbackCoordinator.setAnalysisQueued(response.progress?.roundToInt(), response.message)
                playbackCoordinator.setLastJobId(response.id)
                playbackCoordinator.startPoll(response.id)
            } catch (err: Exception) {
                playbackCoordinator.setAnalysisError("Loading failed.")
            }
        }
    }

    fun loadTrackByYoutubeId(
        youtubeId: String,
        title: String? = null,
        artist: String? = null,
        tuningParams: String? = null
    ) {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        val (resolvedTitle, resolvedArtist) = if (title == null && artist == null) {
            resolveTrackMeta(youtubeId)
        } else {
            title to artist
        }
        if (state.value.playback.isCasting) {
            castTrackId(youtubeId, resolvedTitle, resolvedArtist, tuningParams)
            _state.update {
                it.copy(
                    playback = it.playback.copy(
                        lastYouTubeId = youtubeId,
                        trackTitle = resolvedTitle,
                        trackArtist = resolvedArtist
                    )
                )
            }
            applyActiveTab(TabId.Play, recordHistory = true)
            return
        }
        playbackCoordinator.resetForNewTrack()
        playbackCoordinator.setPendingTuningParams(tuningParams)
        _state.update {
            it.copy(
                playback = it.playback.copy(
                    audioLoading = false,
                    lastYouTubeId = youtubeId,
                    trackTitle = resolvedTitle,
                    trackArtist = resolvedArtist
                )
            )
        }
        applyActiveTab(TabId.Play, recordHistory = true)
        viewModelScope.launch {
            if (playbackCoordinator.tryLoadCachedTrack(youtubeId)) {
                return@launch
            }
            playbackCoordinator.setAnalysisQueued(null, "Fetching audio...")
            try {
                val response = maybeRepairMissing(api.getJobByYoutube(baseUrl, youtubeId))
                if (response.id == null) {
                    playbackCoordinator.setAnalysisError("Loading failed.")
                    return@launch
                }
                playbackCoordinator.updateDeleteEligibility(response)
                playbackCoordinator.setLastJobId(response.id)
                if (response.status == "complete" && response.result != null) {
                    if (!state.value.playback.audioLoaded) {
                        val loaded = playbackCoordinator.loadAudioFromJob(response.id)
                        if (!loaded) {
                            playbackCoordinator.startPoll(response.id)
                            return@launch
                        }
                    }
                    if (playbackCoordinator.applyAnalysisResult(response)) {
                        return@launch
                    }
                    return@launch
                }
                playbackCoordinator.startPoll(response.id)
            } catch (err: Exception) {
                playbackCoordinator.setAnalysisError("Loading failed.")
            }
        }
    }

    fun loadTrackByJobId(
        jobId: String,
        title: String? = null,
        artist: String? = null,
        tuningParams: String? = null
    ) {
        val baseUrl = state.value.baseUrl
        if (baseUrl.isBlank()) return
        if (state.value.playback.isCasting) {
            castTrackId(jobId, title, artist, tuningParams)
            _state.update {
                it.copy(
                    playback = it.playback.copy(
                        lastYouTubeId = null,
                        lastJobId = jobId,
                        trackTitle = title,
                        trackArtist = artist
                    )
                )
            }
            applyActiveTab(TabId.Play, recordHistory = true)
            return
        }
        playbackCoordinator.resetForNewTrack()
        playbackCoordinator.setPendingTuningParams(tuningParams)
        _state.update {
            it.copy(
                playback = it.playback.copy(
                    audioLoading = false,
                    lastYouTubeId = null,
                    lastJobId = jobId,
                    trackTitle = title,
                    trackArtist = artist
                )
            )
        }
        applyActiveTab(TabId.Play, recordHistory = true)
        viewModelScope.launch {
            if (playbackCoordinator.tryLoadCachedTrack(jobId)) {
                return@launch
            }
            playbackCoordinator.setAnalysisQueued(null, "Fetching audio...")
            try {
                val response = maybeRepairMissing(api.getAnalysis(baseUrl, jobId))
                if (response.id == null) {
                    playbackCoordinator.setAnalysisError("Loading failed.")
                    return@launch
                }
                playbackCoordinator.updateDeleteEligibility(response)
                playbackCoordinator.setLastJobId(response.id)
                if (response.status == "complete" && response.result != null) {
                    if (!state.value.playback.audioLoaded) {
                        val loaded = playbackCoordinator.loadAudioFromJob(response.id)
                        if (!loaded) {
                            playbackCoordinator.startPoll(response.id)
                            return@launch
                        }
                    }
                    if (playbackCoordinator.applyAnalysisResult(response)) {
                        return@launch
                    }
                    return@launch
                }
                playbackCoordinator.startPoll(response.id)
            } catch (_: Exception) {
                playbackCoordinator.setAnalysisError("Loading failed.")
            }
        }
    }

    private suspend fun loadExistingJob(
        jobId: String,
        youtubeId: String,
        response: AnalysisResponse,
        title: String? = null,
        artist: String? = null
    ) {
        if (state.value.playback.isCasting) {
            castTrackId(youtubeId, title, artist, null)
            _state.update {
                it.copy(
                    playback = it.playback.copy(
                        lastYouTubeId = youtubeId,
                        trackTitle = title,
                        trackArtist = artist
                    )
                )
            }
            applyActiveTab(TabId.Play, recordHistory = true)
            return
        }
        playbackCoordinator.resetForNewTrack()
        _state.update {
            it.copy(
                search = it.search.copy(
                    query = "",
                    spotifyResults = emptyList(),
                    youtubeMatches = emptyList(),
                    youtubeLoading = false,
                    pendingTrackName = null,
                    pendingTrackArtist = null
                ),
                playback = it.playback.copy(
                    lastYouTubeId = youtubeId,
                    trackTitle = title,
                    trackArtist = artist
                )
            )
        }
        applyActiveTab(TabId.Play, recordHistory = true)
        playbackCoordinator.setAnalysisQueued(null, response.message)
        playbackCoordinator.setLastJobId(jobId)
        playbackCoordinator.updateDeleteEligibility(response)
        try {
            if (response.status == "complete" && response.result != null) {
                if (!state.value.playback.audioLoaded) {
                    val loaded = playbackCoordinator.loadAudioFromJob(jobId)
                    if (!loaded) {
                        playbackCoordinator.startPoll(jobId)
                        return
                    }
                }
                if (playbackCoordinator.applyAnalysisResult(response)) {
                    return
                }
                return
            }
            playbackCoordinator.startPoll(jobId)
        } catch (_: Exception) {
            playbackCoordinator.setAnalysisError("Loading failed.")
        }
    }

    fun togglePlayback() {
        val current = state.value.playback
        if (current.isCasting) {
            if (!state.value.castEnabled) {
                notifyCastUnavailable()
                return
            }
            val trackId = current.lastYouTubeId ?: current.lastJobId
            if (trackId.isNullOrBlank()) {
                viewModelScope.launch { showToast("Select a track before playing.") }
                return
            }
            val command = if (current.isRunning) "stop" else "play"
            val sent = sendCastCommand(command)
            if (!sent) {
                viewModelScope.launch { showToast("Connect to a Cast device first.") }
                return
            }
            return
        }
        if (!current.audioLoaded || !current.analysisLoaded) return
        if (!current.isRunning) {
            try {
                val running = controller.togglePlayback()
                playbackCoordinator.updateListenTimeDisplay()
                _state.update {
                    it.copy(
                        playback = it.playback.copy(
                            beatsPlayed = 0,
                            currentBeatIndex = -1,
                            isRunning = running
                        )
                    )
                }
                if (running) {
                    playbackCoordinator.startListenTimer()
                    ForegroundPlaybackService.start(getApplication())
                }
            } catch (err: Exception) {
                playbackCoordinator.setAnalysisError("Playback failed.")
            }
        } else {
            controller.stopPlayback()
            playbackCoordinator.stopListenTimer()
            playbackCoordinator.updateListenTimeDisplay()
            _state.update { it.copy(playback = it.playback.copy(isRunning = false)) }
            ForegroundPlaybackService.stop(getApplication())
        }
    }

    fun castCurrentTrack() {
        if (!state.value.castEnabled) {
            notifyCastUnavailable()
            return
        }
        val baseUrl = state.value.baseUrl.trim()
        if (baseUrl.isBlank()) {
            viewModelScope.launch { showToast("Set a base URL before casting.") }
            return
        }
        val playback = state.value.playback
        val trackId = playback.lastYouTubeId ?: playback.lastJobId
        if (trackId.isNullOrBlank()) {
            viewModelScope.launch { showToast("Load a track before casting.") }
            return
        }
        val castContext = try {
            CastContext.getSharedInstance(getApplication())
        } catch (_: Exception) {
            viewModelScope.launch { showToast("Cast is unavailable on this device.") }
            return
        }
        val session = castContext.sessionManager.currentCastSession
        if (session == null) {
            viewModelScope.launch { showToast("Connect to a Cast device first.") }
            return
        }
        castTrackId(trackId, playback.trackTitle, playback.trackArtist, playbackCoordinator.buildTuningParamsString())
    }

    fun setCastingConnected(isConnected: Boolean, deviceName: String? = null) {
        if (isConnected) {
            val currentState = state.value
            val playback = currentState.playback
            if (playback.isCasting) {
                _state.update {
                    it.copy(
                        playback = it.playback.copy(
                            castDeviceName = deviceName
                        )
                    )
                }
                return
            }
            val trackId = playback.lastYouTubeId ?: playback.lastJobId
            val shouldAutoCast = !trackId.isNullOrBlank() &&
                playback.audioLoaded &&
                playback.analysisLoaded
            val preservedYouTubeId = playback.lastYouTubeId
            val preservedJobId = playback.lastJobId
            val preservedTitle = playback.trackTitle
            val preservedArtist = playback.trackArtist
            _state.update {
                it.copy(
                    playback = it.playback.copy(
                        isCasting = true,
                        castDeviceName = deviceName
                    )
                )
            }
            castController.resetStatusListener()
            playbackCoordinator.resetForNewTrack()
            if (shouldAutoCast) {
                _state.update {
                    it.copy(
                        playback = it.playback.copy(
                            lastYouTubeId = preservedYouTubeId,
                            lastJobId = preservedJobId,
                            trackTitle = preservedTitle,
                            trackArtist = preservedArtist
                        )
                    )
                }
                if (!trackId.isNullOrBlank()) {
                    castTrackId(trackId, preservedTitle, preservedArtist, null)
                }
            }
            requestCastStatus()
        } else {
            if (!state.value.playback.isCasting) {
                return
            }
            _state.update {
                it.copy(
                    playback = it.playback.copy(
                        isCasting = false,
                        castDeviceName = null
                    )
                )
            }
            castController.resetStatusListener()
            playbackCoordinator.resetForNewTrack()
            applyActiveTab(TabId.Top, recordHistory = true)
        }
    }

    fun stopCasting() {
        castController.endSession()
        setCastingConnected(false)
    }

    fun requestCastStatus() {
        if (!state.value.castEnabled) {
            return
        }
        val session = castController.getSession() ?: return
        ensureCastStatusListener(session)
        castController.requestStatus(session, CAST_COMMAND_NAMESPACE)
    }

    private fun ensureCastStatusListener(session: CastSession) {
        castController.ensureStatusListener(session, CAST_COMMAND_NAMESPACE, ::handleCastStatusMessage)
    }

    private fun handleCastStatusMessage(message: String) {
        val json = runCatching { JSONObject(message) }.getOrNull() ?: return
        if (json.optString("type") != "status") {
            return
        }
        val songId = json.optString("songId", "").takeUnless { it == "null" } ?: ""
        val title = json.optString("title", "").takeUnless { it == "null" } ?: ""
        val artist = json.optString("artist", "").takeUnless { it == "null" } ?: ""
        val isPlaying = json.optBoolean("isPlaying", false)
        val isLoading = json.optBoolean("isLoading", false)
        val playbackState = json.optString("playbackState", "").takeUnless { it == "null" } ?: ""
        val error = json.optString("error", "").takeUnless { it == "null" } ?: ""
        val hasTitle = title.isNotBlank()
        val hasArtist = artist.isNotBlank()
        val displayTitle = if (hasArtist) {
            "${if (hasTitle) title else "Unknown"} — $artist"
        } else if (hasTitle) {
            title
        } else {
            null
        }
        _state.update {
            val resolvedIsLoading = when (playbackState) {
                "loading" -> true
                "playing", "paused", "idle", "error" -> false
                else -> isLoading
            }
            val resolvedIsRunning = when (playbackState) {
                "playing" -> true
                "paused", "idle", "error" -> false
                "loading" -> it.playback.isRunning
                else -> if (resolvedIsLoading) it.playback.isRunning else isPlaying
            }
            it.copy(
                playback = it.playback.copy(
                    isRunning = resolvedIsRunning,
                    playTitle = displayTitle ?: it.playback.playTitle,
                    trackTitle = if (hasTitle) title else it.playback.trackTitle,
                    trackArtist = if (hasArtist) artist else it.playback.trackArtist,
                    lastYouTubeId = if (songId.isBlank()) it.playback.lastYouTubeId else songId,
                    analysisErrorMessage = if (error.isNotBlank()) error else it.playback.analysisErrorMessage,
                    analysisInFlight = resolvedIsLoading
                )
            )
        }
    }

    private fun castTrackId(
        trackId: String,
        title: String? = null,
        artist: String? = null,
        tuningParams: String? = null
    ) {
        if (!state.value.castEnabled) {
            notifyCastUnavailable()
            return
        }
        val baseUrl = state.value.baseUrl.trim()
        if (baseUrl.isBlank()) return
        val session = castController.getSession() ?: return
        val displayTitle = if (artist.isNullOrBlank()) {
            title?.takeIf { it.isNotBlank() } ?: "Unknown"
        } else {
            "${title?.takeIf { it.isNotBlank() } ?: "Unknown"} — $artist"
        }
        _state.update {
            it.copy(
                playback = it.playback.copy(
                    playTitle = displayTitle,
                    trackTitle = title,
                    trackArtist = artist,
                    isRunning = true,
                    listenTime = "00:00:00",
                    beatsPlayed = 0
                )
            )
        }
        castController.loadTrack(
            session = session,
            baseUrl = baseUrl,
            trackId = trackId,
            title = title,
            artist = artist,
            tuningParams = tuningParams
        )
    }

    private fun sendCastCommand(command: String): Boolean {
        if (!state.value.castEnabled) {
            notifyCastUnavailable()
            return false
        }
        return castController.sendCommand(CAST_COMMAND_NAMESPACE, command)
    }

    private fun sendCastTuningParams(tuningParams: String?) {
        if (!state.value.castEnabled) {
            notifyCastUnavailable()
            return
        }
        val sent = castController.sendTuningParams(CAST_COMMAND_NAMESPACE, tuningParams)
        if (!sent) {
            notifyCastUnavailable()
        }
    }

    private fun notifyCastUnavailable() {
        viewModelScope.launch {
            showToast("Casting is not available for this API base URL.")
        }
    }

    fun retryFailedLoad() {
        val baseUrl = state.value.baseUrl.trim()
        if (baseUrl.isBlank()) {
            viewModelScope.launch { showToast("Set a base URL first.") }
            return
        }
        val youtubeId = state.value.playback.lastYouTubeId
        if (youtubeId.isNullOrBlank()) {
            viewModelScope.launch { showToast("Nothing to retry.") }
            return
        }
        val title = state.value.playback.trackTitle
        val artist = state.value.playback.trackArtist
        playbackCoordinator.resetForNewTrack()
        loadTrackByYoutubeId(youtubeId, title, artist)
    }

    suspend fun deleteCurrentJob(): Boolean {
        val jobId = playbackCoordinator.getLastJobId() ?: return false
        val baseUrl = state.value.baseUrl
        val youtubeId = state.value.playback.lastYouTubeId
        if (baseUrl.isBlank()) return false
        return try {
            api.deleteJob(baseUrl, jobId)
            if (youtubeId != null) {
                playbackCoordinator.clearCachedTrack(youtubeId)
                favoritesController.updateFavorites(
                    state.value.favorites.filterNot { it.uniqueSongId == youtubeId }
                )
            }
            playbackCoordinator.resetForNewTrack()
            _state.update { it.copy(activeTab = TabId.Top, topSongsTab = TopSongsTab.TopSongs) }
            tabHistory.removeLastOrNull()?.let { last ->
                if (last != TabId.Play) {
                    tabHistory.addLast(last)
                }
            }
            true
        } catch (_: Exception) {
            playbackCoordinator.markDeleteEligibilityFailed(jobId)
            false
        }
    }

    fun deleteSelectedEdge() = Unit

    fun prepareForExit() {
        playbackCoordinator.resetForNewTrack()
        engine.clearAnalysis()
        controller.player.clear()
        controller.setTrackMeta(null, null)
        _state.update { it.copy(activeTab = TabId.Top, topSongsTab = TopSongsTab.TopSongs) }
    }

    fun selectBeat(index: Int) {
        val data = state.value.playback.vizData ?: return
        if (index < 0 || index >= data.beats.size) return
        val beat = data.beats[index]
        controller.player.seek(beat.start)
        _state.update { it.copy(playback = it.playback.copy(currentBeatIndex = index)) }
    }

    fun setActiveVisualization(index: Int) {
        _state.update { it.copy(playback = it.playback.copy(activeVizIndex = index)) }
        viewModelScope.launch {
            preferences.setActiveVizIndex(index)
        }
    }

    fun applyTuning(
        threshold: Int,
        minProb: Double,
        maxProb: Double,
        ramp: Double,
        addLastEdge: Boolean,
        justBackwards: Boolean,
        justLongBranches: Boolean,
        removeSequentialBranches: Boolean
    ) {
        viewModelScope.launch {
            val vizData = withContext(Dispatchers.Default) {
                val current = engine.getConfig()
                val nextConfig = current.copy(
                    currentThreshold = threshold,
                    minRandomBranchChance = minProb,
                    maxRandomBranchChance = maxProb,
                    randomBranchChanceDelta = ramp,
                    addLastEdge = addLastEdge,
                    justBackwards = justBackwards,
                    justLongBranches = justLongBranches,
                    removeSequentialBranches = removeSequentialBranches
                )
                engine.updateConfig(nextConfig)
                engine.rebuildGraph()
                engine.getVisualizationData()
            }
            _state.update { it.copy(playback = it.playback.copy(vizData = vizData)) }
            playbackCoordinator.syncTuningState()
            if (state.value.playback.isCasting) {
                sendCastTuningParams(playbackCoordinator.buildTuningParamsString())
            }
        }
    }

    fun resetTuningDefaults() {
        viewModelScope.launch {
            val vizData = withContext(Dispatchers.Default) {
                engine.clearDeletedEdges()
                engine.updateConfig(defaultConfig)
                engine.rebuildGraph()
                engine.getVisualizationData()
            }
            _state.update { it.copy(playback = it.playback.copy(vizData = vizData)) }
            playbackCoordinator.syncTuningState()
            if (state.value.playback.isCasting) {
                sendCastTuningParams(null)
            }
        }
    }

    fun handleDeepLink(uri: Uri?) {
        if (uri == null) return
        val base = state.value.baseUrl.trim().trimEnd('/')
        if (base.isBlank()) return
        val baseUri = runCatching { Uri.parse(base) }.getOrNull() ?: return
        if (uri.scheme != baseUri.scheme || uri.host != baseUri.host) return
        if (baseUri.port != -1 && uri.port != baseUri.port) return
        val segments = uri.pathSegments
        if (segments.size >= 2 && segments.firstOrNull() == "listen") {
            val id = segments[1]
            loadTrackByYoutubeId(id)
        }
    }

    fun refreshCacheSize() {
        playbackCoordinator.refreshCacheSize()
    }

    fun clearCache() {
        playbackCoordinator.clearCache()
    }

    fun openListenTab() {
        applyActiveTab(TabId.Play, recordHistory = true)
    }

    private suspend fun showToast(message: String) {
        withContext(Dispatchers.Main) {
            android.widget.Toast.makeText(getApplication(), message, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    companion object {
        private const val MAX_FAVORITES = 100
        private const val CAST_COMMAND_NAMESPACE = "urn:x-cast:com.foreverjukebox.app"
    }
}

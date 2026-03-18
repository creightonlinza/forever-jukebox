package com.foreverjukebox.app.ui

import android.app.Application
import android.net.Uri
import android.os.SystemClock
import com.foreverjukebox.app.data.ApiClient
import com.foreverjukebox.app.data.AnalysisResponse
import com.foreverjukebox.app.engine.JukeboxConfig
import com.foreverjukebox.app.engine.JukeboxEngine
import com.foreverjukebox.app.engine.VisualizationData
import com.foreverjukebox.app.playback.ForegroundPlaybackService
import com.foreverjukebox.app.playback.PlaybackController
import java.io.File
import java.io.IOException
import java.time.Duration
import java.time.OffsetDateTime
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

class PlaybackCoordinator(
    private val application: Application,
    private val scope: CoroutineScope,
    private val api: ApiClient,
    private val controller: PlaybackController,
    private val engine: JukeboxEngine,
    private val json: Json,
    private val defaultConfig: JukeboxConfig,
    private val getState: () -> UiState,
    private val updateState: ((UiState) -> UiState) -> Unit,
    private val updatePlaybackState: ((PlaybackState) -> PlaybackState) -> Unit,
    private val applyActiveTab: (TabId, Boolean) -> Unit
) {
    private var listenTimerJob: Job? = null
    private var pollJob: Job? = null
    private var audioLoadInFlight = false
    private var lastJobId: String? = null
    private var lastPlayCountedJobId: String? = null
    private var deleteEligibilityJobId: String? = null
    private var pendingTuningParams: String? = null
    private var lastNotificationUpdateMs = 0L

    fun onCleared() {
        listenTimerJob?.cancel()
        pollJob?.cancel()
    }

    fun getLastJobId(): String? = lastJobId

    fun setLastJobId(jobId: String?) {
        lastJobId = jobId
        updatePlaybackState { it.copy(lastJobId = jobId) }
    }

    fun setPendingTuningParams(raw: String?) {
        pendingTuningParams = if (shouldApplyTuningParams() && !raw.isNullOrBlank()) {
            raw
        } else {
            null
        }
    }

    fun buildTuningParamsString(): String? {
        if (!shouldApplyTuningParams()) return null
        val config = engine.getConfig()
        val uiTuning = getState().tuning
        val params = mutableListOf<String>()
        if (config.justBackwards) {
            params.add("jb=1")
        }
        if (config.justLongBranches) {
            params.add("lg=1")
        }
        if (config.removeSequentialBranches) {
            params.add("sq=0")
        }
        if (config.currentThreshold != 0) {
            params.add("thresh=${config.currentThreshold}")
        }
        val minChanged = config.minRandomBranchChance != defaultConfig.minRandomBranchChance
        val maxChanged = config.maxRandomBranchChance != defaultConfig.maxRandomBranchChance
        val deltaChanged = config.randomBranchChanceDelta != defaultConfig.randomBranchChanceDelta
        if (minChanged || maxChanged || deltaChanged) {
            val minPct = mapValueToPercent(config.minRandomBranchChance, 0.0, 1.0)
            val maxPct = mapValueToPercent(config.maxRandomBranchChance, 0.0, 1.0)
            val deltaPct = mapValueToPercent(
                config.randomBranchChanceDelta,
                0.0,
                MAX_RANDOM_BRANCH_DELTA
            )
            params.add("bp=$minPct,$maxPct,$deltaPct")
        }
        val deletedIds = getDeletedEdgeIds()
        if (deletedIds.isNotEmpty()) {
            params.add("d=${deletedIds.joinToString(",")}")
        }
        if (uiTuning.highlightAnchorBranch) {
            params.add("ah=1")
        }
        return if (params.isEmpty()) null else params.joinToString("&")
    }

    fun setAnalysisQueued(progress: Int?, message: String? = null) {
        applyLoadingEvent(LoadingEvent.AnalysisQueued(progress, message))
    }

    fun setAnalysisProgress(progress: Int?, message: String? = null) {
        val normalized = if (progress == 0 && message != "Loading audio") null else progress
        applyLoadingEvent(LoadingEvent.AnalysisProgress(normalized, message))
    }

    fun setDecodeProgress(percent: Int) {
        val current = getState().playback
        if (
            current.analysisInFlight &&
            !current.analysisMessage.isNullOrBlank() &&
            current.analysisMessage != "Loading audio"
        ) {
            return
        }
        setAnalysisProgress(percent, "Loading audio")
    }

    fun setAnalysisCalculating() {
        applyLoadingEvent(LoadingEvent.AnalysisCalculating)
    }

    fun setAnalysisError(message: String) {
        applyLoadingEvent(LoadingEvent.AnalysisError(message))
    }

    fun setAudioLoading(loading: Boolean) {
        applyLoadingEvent(LoadingEvent.AudioLoading(loading))
    }

    fun startListenTimer() {
        if (listenTimerJob?.isActive == true) return
        listenTimerJob = scope.launch {
            while (coroutineContext.isActive) {
                updateListenTimeDisplay()
                delay(200)
            }
        }
    }

    fun stopListenTimer() {
        listenTimerJob?.cancel()
        listenTimerJob = null
    }

    fun startPoll(jobId: String) {
        pollJob?.cancel()
        pollJob = scope.launch {
            try {
                pollAnalysis(jobId)
            } catch (_: Exception) {
                setAnalysisError("Loading failed.")
            }
        }
    }

    suspend fun tryLoadCachedTrack(youtubeId: String): Boolean {
        val cached = withContext(Dispatchers.IO) {
            val analysisPath = analysisFile(youtubeId)
            val audioPath = audioFile(youtubeId)
            if (!analysisPath.exists() || !audioPath.exists()) {
                return@withContext null
            }
            val analysisText = analysisPath.readText()
            val response = json.decodeFromString<AnalysisResponse>(analysisText)
            response to audioPath
        }
        if (cached == null) {
            return false
        }
        val (response, audioPath) = cached
        setAnalysisProgress(0, "Loading audio")
        try {
            withContext(Dispatchers.Default) {
                controller.player.loadFile(audioPath) { percent ->
                    scope.launch(Dispatchers.Main) {
                        setAnalysisProgress(percent, "Loading audio")
                    }
                }
            }
        } catch (err: OutOfMemoryError) {
            withContext(Dispatchers.IO) {
                audioFile(youtubeId).delete()
            }
            return false
        }
        audioLoadInFlight = false
        controller.syncAutocanonizerAudio()
        updatePlaybackState {
            it.copy(
                audioLoaded = true,
                audioLoading = false,
                analysisProgress = null,
                analysisMessage = null,
                analysisInFlight = false,
                analysisCalculating = false
            )
        }
        setLastJobId(response.id)
        applyAnalysisResult(response)
        return true
    }

    suspend fun clearCachedTrack(youtubeId: String) {
        withContext(Dispatchers.IO) {
            ignoreFailures { analysisFile(youtubeId).delete() }
            ignoreFailures { audioFile(youtubeId).delete() }
        }
    }

    fun updateDeleteEligibility(response: AnalysisResponse) {
        val jobId = response.id ?: lastJobId ?: return
        if (deleteEligibilityJobId == jobId) {
            return
        }
        val createdAt = response.createdAt
        if (createdAt.isNullOrBlank()) {
            updatePlaybackState { it.copy(deleteEligible = false) }
            deleteEligibilityJobId = null
            return
        }
        deleteEligibilityJobId = jobId
        val parsed = runCatching { OffsetDateTime.parse(createdAt).toInstant() }.getOrNull()
        val eligible = if (parsed == null) {
            false
        } else {
            Duration.between(parsed, OffsetDateTime.now().toInstant()).seconds <= 1800
        }
        updatePlaybackState { it.copy(deleteEligible = eligible) }
    }

    fun markDeleteEligibilityFailed(jobId: String) {
        updatePlaybackState { it.copy(deleteEligible = false) }
        deleteEligibilityJobId = jobId
    }

    suspend fun loadAudioFromJob(jobId: String): Boolean {
        val baseUrl = getState().baseUrl
        setAudioLoading(true)
        setAnalysisProgress(0, "Loading audio")
        try {
            val youtubeId = getState().playback.lastYouTubeId
            val target = audioFile(youtubeId ?: jobId)
            api.fetchAudioToFile(baseUrl, jobId, target)
            withContext(Dispatchers.Default) {
                controller.player.loadFile(target) { percent ->
                    scope.launch(Dispatchers.Main) {
                        setDecodeProgress(percent)
                    }
                }
            }
            audioLoadInFlight = false
            controller.syncAutocanonizerAudio()
            updatePlaybackState { it.copy(audioLoaded = true, audioLoading = false) }
            return true
        } catch (err: IOException) {
            audioLoadInFlight = false
            updatePlaybackState { it.copy(audioLoading = false) }
            if (err.message?.contains("HTTP 404") == true) {
                try {
                    api.repairJob(baseUrl, jobId)
                } catch (_: Exception) {
                    // Ignore repair failures; poll loop will surface errors.
                }
                return false
            }
            throw err
        }
    }

    suspend fun applyAnalysisResult(response: AnalysisResponse): Boolean {
        val result = response.result ?: return false
        updateDeleteEligibility(response)
        setAnalysisCalculating()
        val rootObj = result.jsonObject
        val trackElement = rootObj["track"] ?: rootObj["analysis"]?.jsonObject?.get("track")
        val trackMeta = trackElement?.let { json.decodeFromJsonElement(TrackMetaJson.serializer(), it) }
        val title = trackMeta?.title
        val artist = trackMeta?.artist
        val durationSeconds = trackMeta?.duration
        val (vizData, autocanonizerData) = withContext(Dispatchers.Default) {
            engine.loadAnalysis(result)
            applyPendingTuningParams()
            val viz = engine.getVisualizationData()
            val canonizer = controller.autocanonizer.setAnalysis(result, durationSeconds)
            viz to canonizer
        }
        syncTuningState()
        val playTitle = buildPlayTitle(title, artist, getState().playback.playMode)
        controller.setTrackMeta(title, artist)
        updateState {
            it.copy(
                playback = it.playback.copy(
                    analysisLoaded = true,
                    vizData = vizData,
                    autocanonizerData = autocanonizerData,
                    playTitle = playTitle,
                    trackDurationSeconds = durationSeconds,
                    castTotalBeats = null,
                    castTotalBranches = null,
                    trackTitle = title,
                    trackArtist = artist,
                    canonizerOtherIndex = null,
                    canonizerTileColorOverrides = controller.autocanonizer.getTileColorOverrides(),
                    analysisProgress = null,
                    analysisMessage = null,
                    analysisErrorMessage = null,
                    analysisInFlight = false,
                    analysisCalculating = false,
                    audioLoading = false,
                    isPaused = false
                )
            )
        }
        applyActiveTab(TabId.Play, true)
        val jobId = response.id ?: lastJobId
        if (jobId != null) {
            recordPlay(jobId)
        }
        val youtubeId = getState().playback.lastYouTubeId
        if (youtubeId != null) {
            cacheAnalysis(youtubeId, response)
        }
        ForegroundPlaybackService.update(application)
        return true
    }

    fun maybeUpdateNotification() {
        if (!controller.isPlaying()) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastNotificationUpdateMs < 500L) return
        lastNotificationUpdateMs = now
        ForegroundPlaybackService.update(application)
    }

    fun resetForNewTrack() {
        engine.clearDeletedEdges()
        pendingTuningParams = null
        audioLoadInFlight = false
        controller.autocanonizer.reset()
        controller.stopExternalPlayback()
        engine.updateConfig(defaultConfig)
        controller.stopPlayback()
        controller.resetTimers()
        controller.setTrackMeta(null, null)
        ForegroundPlaybackService.stop(application)
        stopListenTimer()
        updateState {
            it.copy(
                playback = it.playback.copy(
                    playMode = it.playback.playMode,
                    canonizerFinishOutSong = it.playback.canonizerFinishOutSong,
                    audioLoaded = false,
                    analysisLoaded = false,
                    beatsPlayed = 0,
                    listenTime = "00:00:00",
                    trackDurationSeconds = null,
                    castTotalBeats = null,
                    castTotalBranches = null,
                    trackTitle = null,
                    trackArtist = null,
                    isRunning = false,
                    isPaused = false,
                    vizData = null,
                    autocanonizerData = null,
                    currentBeatIndex = -1,
                    canonizerOtherIndex = null,
                    canonizerTileColorOverrides = emptyMap(),
                    jumpLine = null,
                    playTitle = "",
                    lastYouTubeId = null,
                    lastJobId = null,
                    isCastLoading = false,
                    deleteEligible = false,
                    analysisProgress = null,
                    analysisMessage = null,
                    analysisErrorMessage = null,
                    analysisInFlight = false,
                    analysisCalculating = false,
                    audioLoading = false,
                    isCasting = it.playback.isCasting,
                    castDeviceName = it.playback.castDeviceName
                ),
                search = it.search.copy(
                    pendingTrackName = null,
                    pendingTrackArtist = null,
                    spotifyLoading = false,
                    youtubeLoading = false
                )
            )
        }
        engine.stopJukebox()
        val emptyViz = VisualizationData(beats = emptyList(), edges = mutableListOf())
        updateState { it.copy(playback = it.playback.copy(vizData = emptyViz)) }
        setLastJobId(null)
        lastPlayCountedJobId = null
        deleteEligibilityJobId = null
        pollJob?.cancel()
        pollJob = null
        syncTuningState()
    }

    fun refreshCacheSize() {
        scope.launch(Dispatchers.IO) {
            val sizeBytes = cacheDir().walkTopDown()
                .filter { it.isFile }
                .sumOf { it.length() }
            updateState { it.copy(cacheSizeBytes = sizeBytes) }
        }
    }

    fun clearCache() {
        scope.launch(Dispatchers.IO) {
            val dir = cacheDir()
            dir.listFiles()?.forEach { it.deleteRecursively() }
            val sizeBytes = cacheDir().walkTopDown()
                .filter { it.isFile }
                .sumOf { it.length() }
            updateState { it.copy(cacheSizeBytes = sizeBytes) }
        }
    }

    fun updateListenTimeDisplay() {
        val durationSeconds = controller.player.getDurationSeconds()
        val playbackMode = getState().playback.playMode
        if (
            playbackMode == PlaybackMode.Jukebox &&
            durationSeconds != null &&
            controller.player.getCurrentTime() >= durationSeconds - END_EPSILON_SECONDS
        ) {
            controller.stopPlayback()
            stopListenTimer()
            updatePlaybackState { it.copy(isRunning = false, isPaused = false) }
            return
        }
        val totalSeconds = controller.getListenTimeSeconds()
        updatePlaybackState {
            it.copy(
                listenTime = formatDuration(totalSeconds),
                isRunning = controller.isPlaying(),
                isPaused = controller.isPaused()
            )
        }
    }

    fun restorePlaybackState() {
        val vizData = engine.getVisualizationData()
        val autocanonizerData = controller.autocanonizer.getData()
        val audioDuration = controller.player.getDurationSeconds()
        val hasAnalysis = vizData != null
        val hasAudio = controller.player.hasAudio() && audioDuration != null
        if (!hasAnalysis && !hasAudio) return
        val title = controller.getTrackTitle()
        val artist = controller.getTrackArtist()
        val playTitle = buildPlayTitle(title, artist, getState().playback.playMode)
        val currentTime = controller.player.getCurrentTime()
        val beatIndex = if (hasAnalysis) engine.getBeatAtTime(currentTime)?.which ?: -1 else -1
        updateState {
            it.copy(
                playback = it.playback.copy(
                    audioLoaded = hasAudio,
                    analysisLoaded = hasAnalysis,
                    vizData = vizData,
                    autocanonizerData = autocanonizerData,
                    playTitle = playTitle,
                    trackDurationSeconds = audioDuration,
                    castTotalBeats = null,
                    castTotalBranches = null,
                    trackTitle = title,
                    trackArtist = artist,
                    currentBeatIndex = beatIndex,
                    canonizerOtherIndex = controller.autocanonizer.getForcedOtherIndex(),
                    canonizerTileColorOverrides = controller.autocanonizer.getTileColorOverrides(),
                    isRunning = controller.isPlaying(),
                    isPaused = controller.isPaused()
                ),
                activeTab = if (hasAnalysis) TabId.Play else it.activeTab
            )
        }
        if (controller.isPlaying()) {
            startListenTimer()
        }
    }

    suspend fun ensureAudioReady(): Boolean {
        if (controller.player.hasAudio()) {
            return true
        }
        val playback = getState().playback
        val cachedId = playback.lastYouTubeId ?: lastJobId
        if (cachedId.isNullOrBlank()) {
            return false
        }
        val cachedAudio = audioFile(cachedId)
        if (cachedAudio.exists()) {
            setAudioLoading(true)
            setAnalysisProgress(0, "Loading audio")
            try {
                withContext(Dispatchers.Default) {
                    controller.player.loadFile(cachedAudio) { percent ->
                        scope.launch(Dispatchers.Main) {
                            setDecodeProgress(percent)
                        }
                    }
                }
                controller.syncAutocanonizerAudio()
                updatePlaybackState { it.copy(audioLoaded = true, audioLoading = false) }
                return true
            } catch (_: OutOfMemoryError) {
                withContext(Dispatchers.IO) {
                    cachedAudio.delete()
                }
                updatePlaybackState { it.copy(audioLoading = false, audioLoaded = false) }
                return false
            } catch (_: Exception) {
                updatePlaybackState { it.copy(audioLoading = false, audioLoaded = false) }
                return false
            }
        }
        val jobId = playback.lastJobId ?: return false
        return loadAudioFromJob(jobId)
    }

    fun syncTuningState() {
        val config = engine.getConfig()
        val graph = engine.getGraphState()
        updateState { state ->
            val thresholdValue = when {
                config.currentThreshold != 0 -> config.currentThreshold
                graph != null -> graph.currentThreshold
                else -> state.tuning.threshold
            }
            state.copy(
                tuning = state.tuning.copy(
                    threshold = thresholdValue,
                    minProb = (config.minRandomBranchChance * 100).toInt(),
                    maxProb = (config.maxRandomBranchChance * 100).toInt(),
                    ramp = (config.randomBranchChanceDelta * RANDOM_BRANCH_DELTA_PERCENT_SCALE).toInt(),
                    justBackwards = config.justBackwards,
                    justLong = config.justLongBranches,
                    removeSequential = config.removeSequentialBranches
                )
            )
        }
    }

    fun applyPlaybackMode(mode: PlaybackMode) {
        updatePlaybackState {
            it.copy(
                playMode = mode,
                playTitle = buildPlayTitle(it.trackTitle, it.trackArtist, mode)
            )
        }
    }

    private sealed class LoadingEvent {
        data class AnalysisQueued(val progress: Int?, val message: String?) : LoadingEvent()
        data class AnalysisProgress(val progress: Int?, val message: String?) : LoadingEvent()
        data object AnalysisCalculating : LoadingEvent()
        data class AnalysisError(val message: String) : LoadingEvent()
        data class AudioLoading(val loading: Boolean) : LoadingEvent()
    }

    private fun applyLoadingEvent(event: LoadingEvent) {
        updateState { current ->
            val playback = current.playback
            current.copy(
                playback = when (event) {
                    is LoadingEvent.AnalysisQueued -> playback.copy(
                        analysisProgress = event.progress,
                        analysisMessage = event.message,
                        analysisErrorMessage = null,
                        analysisInFlight = true,
                        analysisCalculating = false
                    )
                    is LoadingEvent.AnalysisProgress -> playback.copy(
                        analysisProgress = event.progress,
                        analysisMessage = event.message,
                        analysisErrorMessage = null,
                        analysisInFlight = true,
                        analysisCalculating = false
                    )
                    LoadingEvent.AnalysisCalculating -> playback.copy(
                        analysisProgress = null,
                        analysisMessage = null,
                        analysisErrorMessage = null,
                        analysisInFlight = false,
                        analysisCalculating = true
                    )
                    is LoadingEvent.AnalysisError -> playback.copy(
                        analysisProgress = null,
                        analysisMessage = null,
                        analysisErrorMessage = event.message,
                        analysisInFlight = false,
                        analysisCalculating = false,
                        audioLoading = false
                    )
                    is LoadingEvent.AudioLoading -> playback.copy(audioLoading = event.loading)
                }
            )
        }
    }

    private inline fun ignoreFailures(block: () -> Unit) {
        try {
            block()
        } catch (_: Exception) {
            // Ignore cache failures.
        }
    }

    private suspend fun pollAnalysis(jobId: String) {
        val baseUrl = getState().baseUrl
        val intervalMs = 3000L
        while (currentCoroutineContext().isActive) {
            val response = api.getAnalysis(baseUrl, jobId)
            updateDeleteEligibility(response)
            when (response.status) {
                "failed" -> {
                    if (response.errorCode == "analysis_missing" && response.id != null) {
                        try {
                            api.repairJob(baseUrl, response.id)
                            delay(intervalMs)
                            continue
                        } catch (_: Exception) {
                            // Fall through to error handling.
                        }
                    }
                    setAnalysisError(response.error ?: "Loading failed.")
                    return
                }
                "downloading", "queued", "processing" -> {
                    val progress = response.progress?.roundToInt()
                    setAnalysisProgress(progress, response.message)
                    if (response.status != "downloading" &&
                        !getState().playback.audioLoaded &&
                        !audioLoadInFlight
                    ) {
                        audioLoadInFlight = true
                        scope.launch {
                            try {
                                loadAudioFromJob(jobId)
                            } catch (_: Exception) {
                                audioLoadInFlight = false
                            }
                        }
                    }
                }
                "complete" -> {
                    if (!getState().playback.audioLoaded) {
                        val loaded = loadAudioFromJob(jobId)
                        if (!loaded) {
                            delay(intervalMs)
                            continue
                        }
                    }
                    if (applyAnalysisResult(response)) {
                        return
                    }
                }
            }
            delay(intervalMs)
        }
    }

    private fun cacheDir(): File {
        val dir = File(application.cacheDir, "jukebox-cache")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    private fun analysisFile(youtubeId: String): File =
        File(cacheDir(), "$youtubeId.analysis.json")

    private fun audioFile(youtubeId: String): File = File(cacheDir(), "$youtubeId.audio")

    private fun cacheAnalysis(
        youtubeId: String,
        response: AnalysisResponse
    ) {
        scope.launch(Dispatchers.IO) {
            ignoreFailures {
                val payload = json.encodeToString(response)
                analysisFile(youtubeId).writeText(payload)
            }
        }
    }

    private fun recordPlay(jobId: String) {
        if (lastPlayCountedJobId == jobId) return
        lastPlayCountedJobId = jobId
        scope.launch {
            try {
                api.postPlay(getState().baseUrl, jobId)
            } catch (_: Exception) {
                lastPlayCountedJobId = null
            }
        }
    }

    private data class ResolvedTuningParams(
        val config: JukeboxConfig,
        val deletedEdgeIds: List<Int>
    )

    private fun parseTuningParams(raw: String?): ResolvedTuningParams? {
        val parsed = TuningParamsCodec.parse(raw, minThreshold = 0) ?: return null
        var config = defaultConfig
        parsed.justBackwards?.let { value ->
            config = config.copy(justBackwards = value)
        }
        parsed.justLongBranches?.let { value ->
            config = config.copy(justLongBranches = value)
        }
        parsed.removeSequentialBranches?.let { value ->
            config = config.copy(removeSequentialBranches = value)
        }
        parsed.threshold?.let { value ->
            config = config.copy(currentThreshold = value)
        }
        parsed.minProbPercent?.let { value ->
            config = config.copy(
                minRandomBranchChance = mapPercentToRange(value, 0.0, 1.0)
            )
        }
        parsed.maxProbPercent?.let { value ->
            config = config.copy(
                maxRandomBranchChance = mapPercentToRange(value, 0.0, 1.0)
            )
        }
        parsed.rampPercent?.let { value ->
            config = config.copy(
                randomBranchChanceDelta = mapPercentToRange(value, 0.0, MAX_RANDOM_BRANCH_DELTA)
            )
        }
        return ResolvedTuningParams(config, parsed.deletedEdgeIds)
    }

    private fun mapPercentToRange(percent: Int, min: Double, max: Double): Double {
        val safe = percent.coerceIn(0, 100)
        return ((max - min) * safe) / 100.0 + min
    }

    private fun mapValueToPercent(value: Double, min: Double, max: Double): Int {
        val safeValue = value.coerceIn(min, max)
        return ((100.0 * (safeValue - min)) / (max - min)).roundToInt()
    }

    private fun getDeletedEdgeIds(): List<Int> {
        val graph = engine.getGraphState() ?: return emptyList()
        return graph.allEdges.filter { it.deleted }.map { it.id }
    }

    private fun applyPendingTuningParams() {
        if (!shouldApplyTuningParams()) {
            pendingTuningParams = null
            return
        }
        val raw = pendingTuningParams
        pendingTuningParams = null
        val parsed = parseTuningParams(raw) ?: return
        val graph = engine.getGraphState()
        if (graph != null && parsed.deletedEdgeIds.isNotEmpty()) {
            val edgeById = graph.allEdges.associateBy { it.id }
            for (id in parsed.deletedEdgeIds) {
                val edge = edgeById[id] ?: continue
                engine.deleteEdge(edge)
            }
        }
        val configChanged = parsed.config != defaultConfig
        val shouldRebuild = configChanged || parsed.deletedEdgeIds.isNotEmpty()
        if (configChanged) {
            engine.updateConfig(parsed.config)
        }
        if (shouldRebuild) {
            engine.rebuildGraph()
        }
    }

    private fun buildPlayTitle(
        title: String?,
        artist: String?,
        mode: PlaybackMode
    ): String {
        if (title.isNullOrBlank()) {
            return ""
        }
        val resolvedTitle = if (mode == PlaybackMode.Autocanonizer) {
            "$title (autocanonized)"
        } else {
            title
        }
        return if (!artist.isNullOrBlank()) {
            "$resolvedTitle — $artist"
        } else {
            resolvedTitle
        }
    }

    private fun shouldApplyTuningParams(): Boolean = true
}

private const val END_EPSILON_SECONDS = 0.02
private const val MAX_RANDOM_BRANCH_DELTA = 0.2
private const val RANDOM_BRANCH_DELTA_PERCENT_SCALE = 100.0 / MAX_RANDOM_BRANCH_DELTA

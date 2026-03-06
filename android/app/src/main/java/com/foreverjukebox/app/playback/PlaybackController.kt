package com.foreverjukebox.app.playback

import android.content.Context
import android.os.SystemClock
import com.foreverjukebox.app.audio.BufferedAudioPlayer
import com.foreverjukebox.app.autocanonizer.AutocanonizerController
import com.foreverjukebox.app.autocanonizer.BufferedAutocanonizerPlayer
import com.foreverjukebox.app.engine.JukeboxEngine
import com.foreverjukebox.app.engine.JukeboxEngineOptions
import com.foreverjukebox.app.engine.RandomMode
import com.foreverjukebox.app.engine.VisualizationData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

class PlaybackController {
    val player = BufferedAudioPlayer()
    val engine = JukeboxEngine(player, JukeboxEngineOptions(randomMode = RandomMode.Random))
    private val autocanonizerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val autocanonizerPlayer = BufferedAutocanonizerPlayer(player)
    val autocanonizer = AutocanonizerController(autocanonizerPlayer, autocanonizerScope)

    private var playTimerMs = 0L
    private var lastPlayStamp: Long? = null
    private var transportState = TransportState.Stopped
    private var trackTitle: String? = null
    private var trackArtist: String? = null

    private enum class TransportState {
        Playing,
        Paused,
        Stopped
    }

    fun setTrackMeta(title: String?, artist: String?) {
        trackTitle = title
        trackArtist = artist
    }

    fun getTrackTitle(): String? = trackTitle

    fun getTrackArtist(): String? = trackArtist

    private fun beginPlayback(resetFromStart: Boolean): Boolean {
        if (!player.hasAudio()) {
            transportState = TransportState.Stopped
            return false
        }
        // Guard against any leftover gain shaping from autocanonizer paths.
        player.setGain(1.0)
        if (resetFromStart) {
            engine.stopJukebox()
            engine.resetStats()
            playTimerMs = 0L
            lastPlayStamp = null
        }
        val started = runCatching {
            engine.startJukebox(resetState = resetFromStart)
            engine.play()
            player.isPlaying()
        }.getOrElse {
            false
        }
        if (started) {
            lastPlayStamp = SystemClock.elapsedRealtime()
            transportState = TransportState.Playing
            return true
        }
        runCatching { engine.stopJukebox() }
        transportState = TransportState.Stopped
        return false
    }

    fun playOrResumePlayback(): Boolean {
        return when (transportState) {
            TransportState.Playing -> true
            TransportState.Paused -> beginPlayback(resetFromStart = false)
            TransportState.Stopped -> beginPlayback(resetFromStart = true)
        }
    }

    fun pausePlayback() {
        if (transportState != TransportState.Playing) {
            return
        }
        engine.pauseJukebox()
        if (lastPlayStamp != null) {
            playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
            lastPlayStamp = null
        }
        transportState = TransportState.Paused
    }

    fun togglePlayback(): Boolean {
        return when (transportState) {
            TransportState.Playing -> {
                pausePlayback()
                false
            }
            TransportState.Paused,
            TransportState.Stopped -> playOrResumePlayback()
        }
    }

    fun stopPlayback() {
        if (transportState == TransportState.Stopped) {
            return
        }
        engine.stopJukebox()
        if (lastPlayStamp != null) {
            playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
            lastPlayStamp = null
        }
        transportState = TransportState.Stopped
    }

    fun resetTimers() {
        playTimerMs = 0L
        lastPlayStamp = null
    }

    fun startExternalPlayback(resetTimers: Boolean = true) {
        if (resetTimers) {
            playTimerMs = 0L
        }
        lastPlayStamp = SystemClock.elapsedRealtime()
        transportState = TransportState.Playing
    }

    fun stopExternalPlayback() {
        if (lastPlayStamp != null) {
            playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
            lastPlayStamp = null
        }
        transportState = TransportState.Stopped
    }

    fun pauseExternalPlayback() {
        if (lastPlayStamp != null) {
            playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
            lastPlayStamp = null
        }
        transportState = TransportState.Paused
    }

    fun isPlaying(): Boolean = transportState == TransportState.Playing

    fun isPaused(): Boolean = transportState == TransportState.Paused

    fun getListenTimeSeconds(): Double {
        val now = SystemClock.elapsedRealtime()
        val totalMs = playTimerMs + (lastPlayStamp?.let { now - it } ?: 0L)
        return totalMs / 1000.0
    }

    fun getPlaybackPositionMs(): Long {
        return (player.getCurrentTime() * 1000.0).toLong()
    }

    fun getTrackDurationMs(): Long? {
        return player.getDurationSeconds()?.let { (it * 1000.0).toLong() }
    }

    fun seekToBeat(index: Int, data: VisualizationData? = engine.getVisualizationData()): Boolean {
        val beats = data?.beats ?: return false
        if (index !in beats.indices) return false
        val beat = beats[index]
        player.seek(beat.start)
        engine.seekToBeat(index)
        return true
    }

    fun syncAutocanonizerAudio(): Boolean {
        return autocanonizer.syncAudioFromMain()
    }

    fun release() {
        autocanonizer.release()
        player.release()
        autocanonizerScope.cancel()
    }
}

object PlaybackControllerHolder {
    @Volatile
    private var controller: PlaybackController? = null

    @Suppress("UNUSED_PARAMETER")
    fun get(context: Context): PlaybackController {
        return controller ?: synchronized(this) {
            controller ?: PlaybackController().also { controller = it }
        }
    }
}

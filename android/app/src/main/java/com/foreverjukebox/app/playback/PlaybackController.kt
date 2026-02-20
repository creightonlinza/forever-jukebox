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
    private var isRunning = false
    private var trackTitle: String? = null
    private var trackArtist: String? = null

    fun setTrackMeta(title: String?, artist: String?) {
        trackTitle = title
        trackArtist = artist
    }

    fun getTrackTitle(): String? = trackTitle

    fun getTrackArtist(): String? = trackArtist

    fun togglePlayback(): Boolean {
        if (!isRunning) {
            if (!player.hasAudio()) {
                return false
            }
            engine.stopJukebox()
            engine.resetStats()
            playTimerMs = 0L
            lastPlayStamp = null
            engine.startJukebox()
            engine.play()
            if (player.isPlaying()) {
                lastPlayStamp = SystemClock.elapsedRealtime()
                isRunning = true
            } else {
                engine.stopJukebox()
                isRunning = false
            }
        } else {
            engine.stopJukebox()
            if (lastPlayStamp != null) {
                playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
                lastPlayStamp = null
            }
            isRunning = false
        }
        return isRunning
    }

    fun stopPlayback() {
        if (isRunning) {
            engine.stopJukebox()
            if (lastPlayStamp != null) {
                playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
                lastPlayStamp = null
            }
            isRunning = false
        }
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
        isRunning = true
    }

    fun stopExternalPlayback() {
        if (lastPlayStamp != null) {
            playTimerMs += SystemClock.elapsedRealtime() - lastPlayStamp!!
            lastPlayStamp = null
        }
        isRunning = false
    }

    fun isPlaying(): Boolean = isRunning

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

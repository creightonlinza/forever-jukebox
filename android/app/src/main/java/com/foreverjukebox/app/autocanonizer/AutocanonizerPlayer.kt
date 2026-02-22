package com.foreverjukebox.app.autocanonizer

import com.foreverjukebox.app.audio.BufferedAudioPlayer
import kotlin.math.abs

interface AutocanonizerPlayer {
    fun isReady(): Boolean
    fun syncAudioFromMain(): Boolean
    fun setVolume(volume: Double)
    fun reset()
    fun stop()
    fun stopMain()
    fun playBeat(beat: AutocanonizerBeat, beats: List<AutocanonizerBeat>): Double
    fun playOtherOnly(beat: AutocanonizerBeat, beats: List<AutocanonizerBeat>): Double
    fun release()
}

class BufferedAutocanonizerPlayer(
    private val mainPlayer: BufferedAudioPlayer,
    private val secondaryPlayer: BufferedAudioPlayer = BufferedAudioPlayer(),
    private val masterBlend: Double = 0.55
) : AutocanonizerPlayer {
    private var baseVolume = 1.0
    private var currentBeatIndex: Int? = null
    private var skewDelta = 0.0
    private val maxSkewDelta = 0.05
    private var carrySecondaryOnNextSecondaryTick = false

    override fun isReady(): Boolean {
        return mainPlayer.hasAudio() && secondaryPlayer.hasAudio()
    }

    override fun syncAudioFromMain(): Boolean {
        return secondaryPlayer.cloneAudioFrom(mainPlayer)
    }

    override fun setVolume(volume: Double) {
        baseVolume = volume.coerceIn(0.0, 1.0)
        applyGains()
    }

    override fun reset() {
        stop()
        currentBeatIndex = null
        skewDelta = 0.0
        carrySecondaryOnNextSecondaryTick = false
    }

    override fun stop() {
        mainPlayer.stop()
        secondaryPlayer.stop()
        // Ensure shared main player returns to full gain for regular Jukebox playback.
        mainPlayer.setGain(1.0)
        secondaryPlayer.setGain(1.0)
        carrySecondaryOnNextSecondaryTick = false
    }

    override fun stopMain() {
        mainPlayer.stop()
        // Preserve the currently running secondary layer across the handoff to secondary-only mode.
        carrySecondaryOnNextSecondaryTick = true
    }

    override fun playBeat(beat: AutocanonizerBeat, beats: List<AutocanonizerBeat>): Double {
        if (!isReady()) {
            return 0.0
        }

        val currentIndex = currentBeatIndex
        val currentBeat = currentIndex?.let { beats.getOrNull(it) }
        var restartedMain = false
        if (currentBeat == null || currentBeat.nextIndex != beat.index) {
            mainPlayer.seek(beat.start)
            mainPlayer.play()
            restartedMain = true
        }

        val delta = if (restartedMain) 0.0 else mainPlayer.getCurrentTime() - beat.start
        applyGains(beat.otherGain)

        val otherBeat = beats.getOrNull(beat.otherIndex) ?: beat
        val currentOther = currentBeat?.let { beats.getOrNull(it.otherIndex) }
        val isTerminalBeat = beat.nextIndex == null
        val shouldResyncSecondary = currentBeat == null ||
            !secondaryPlayer.isPlaying() ||
            (!isTerminalBeat && (
                currentOther?.nextIndex != beat.otherIndex ||
                    abs(skewDelta) > maxSkewDelta
                ))
        if (shouldResyncSecondary) {
            skewDelta = 0.0
            secondaryPlayer.seek(otherBeat.start)
            secondaryPlayer.play()
        }
        skewDelta += beat.duration - otherBeat.duration
        currentBeatIndex = beat.index
        return beat.duration - delta
    }

    override fun playOtherOnly(beat: AutocanonizerBeat, beats: List<AutocanonizerBeat>): Double {
        if (!isReady()) {
            return 0.0
        }

        applyGains(beat.otherGain)
        val currentBeat = currentBeatIndex?.let { beats.getOrNull(it) }
        val canCarrySecondary = carrySecondaryOnNextSecondaryTick &&
            currentBeat != null &&
            currentBeat.otherIndex == beat.index &&
            secondaryPlayer.isPlaying()
        var restartedSecondary = false
        if (!canCarrySecondary &&
            (currentBeat == null || currentBeat.nextIndex != beat.index || !secondaryPlayer.isPlaying())
        ) {
            secondaryPlayer.seek(beat.start)
            secondaryPlayer.play()
            restartedSecondary = true
        }
        carrySecondaryOnNextSecondaryTick = false

        val delta = if (restartedSecondary) 0.0 else secondaryPlayer.getCurrentTime() - beat.start
        currentBeatIndex = beat.index
        return beat.duration - delta
    }

    override fun release() {
        mainPlayer.setGain(1.0)
        secondaryPlayer.release()
    }

    private fun applyGains(otherGain: Double = 1.0) {
        val clampedOtherGain = otherGain.coerceIn(0.0, 1.0)
        mainPlayer.setGain(baseVolume * masterBlend)
        secondaryPlayer.setGain(baseVolume * (1.0 - masterBlend) * clampedOtherGain)
    }
}

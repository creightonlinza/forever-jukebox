package com.foreverjukebox.app.autocanonizer

import com.foreverjukebox.app.engine.normalizeAnalysis
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

class AutocanonizerController(
    private val player: AutocanonizerPlayer,
    private val scope: CoroutineScope
) {
    companion object {
        const val PRIMARY_TILE_COLOR_HEX = "#4F8FFF"
        const val OTHER_TILE_COLOR_HEX = "#10DF00"
    }

    private var data: AutocanonizerData? = null
    private var running = false
    private var tickJob: Job? = null
    private var secondaryOnly = false
    private var secondaryIndex = 0
    private var finishOutSong = false
    private var currentIndex = -1
    private var forcedOtherIndex: Int? = null
    private var beatsPlayed = 0
    private val tileColorOverrides = linkedMapOf<Int, String>()

    private var onBeat: ((index: Int, beat: AutocanonizerBeat, forcedOtherIndex: Int?) -> Unit)? = null
    private var onEnded: (() -> Unit)? = null

    fun setOnBeat(handler: ((index: Int, beat: AutocanonizerBeat, forcedOtherIndex: Int?) -> Unit)?) {
        onBeat = handler
    }

    fun setOnEnded(handler: (() -> Unit)?) {
        onEnded = handler
    }

    fun setFinishOutSong(enabled: Boolean) {
        finishOutSong = enabled
    }

    fun setVolume(volume: Double) {
        player.setVolume(volume)
    }

    fun setAnalysis(raw: JsonElement, durationOverride: Double? = null): AutocanonizerData? {
        val analysis = normalizeAnalysis(raw)
        val canonizerData = buildAutocanonizerData(analysis, durationOverride)
        data = canonizerData
        resetVisualization()
        return canonizerData
    }

    fun setData(value: AutocanonizerData?) {
        data = value
        resetVisualization()
    }

    fun syncAudioFromMain(): Boolean {
        return player.syncAudioFromMain()
    }

    fun isReady(): Boolean {
        val beats = data?.beats
        return !beats.isNullOrEmpty() && player.isReady()
    }

    fun getData(): AutocanonizerData? = data

    fun getCurrentIndex(): Int = currentIndex

    fun getForcedOtherIndex(): Int? = forcedOtherIndex

    fun getBeatsPlayed(): Int = beatsPlayed

    fun getTileColorOverrides(): Map<Int, String> = tileColorOverrides.toMap()

    fun isRunning(): Boolean = running

    fun reset() {
        stop()
        data = null
        resetVisualization()
    }

    fun resetVisualization() {
        currentIndex = -1
        forcedOtherIndex = null
        beatsPlayed = 0
        tileColorOverrides.clear()
    }

    fun start(): Boolean {
        return startAtIndex(0)
    }

    fun startAtIndex(index: Int): Boolean {
        val beats = data?.beats ?: return false
        if (beats.isEmpty() || !player.isReady()) {
            return false
        }
        stop()
        running = true
        secondaryOnly = false
        secondaryIndex = 0
        forcedOtherIndex = null
        beatsPlayed = 0
        currentIndex = index.coerceIn(0, beats.lastIndex)
        player.reset()
        tickJob = scope.launch {
            runMainLoop()
        }
        return true
    }

    fun stop() {
        tickJob?.cancel()
        tickJob = null
        running = false
        secondaryOnly = false
        forcedOtherIndex = null
        player.stop()
    }

    fun release() {
        stop()
        player.release()
    }

    private suspend fun runMainLoop() {
        val beats = data?.beats
        if (beats.isNullOrEmpty()) {
            completeNaturally()
            return
        }

        while (running && !secondaryOnly) {
            if (currentIndex !in beats.indices) {
                completeNaturally()
                return
            }
            val beat = beats[currentIndex]
            val isFinal = currentIndex == beats.lastIndex
            val delaySeconds = player.playBeat(beat, beats)
            forcedOtherIndex = null
            beatsPlayed += 1
            applyTileOverride(currentIndex, PRIMARY_TILE_COLOR_HEX)
            applyTileOverride(beat.otherIndex, OTHER_TILE_COLOR_HEX)
            onBeat?.invoke(currentIndex, beat, null)

            if (isFinal && finishOutSong) {
                secondaryOnly = true
                secondaryIndex = beat.otherIndex
                player.stopMain()
                runSecondaryLoop()
                return
            }

            currentIndex += 1
            delay(delaySeconds.toDelayMillis())
        }
    }

    private suspend fun runSecondaryLoop() {
        val beats = data?.beats
        if (beats.isNullOrEmpty()) {
            completeNaturally()
            return
        }

        while (running && secondaryOnly) {
            if (secondaryIndex !in beats.indices) {
                completeNaturally()
                return
            }
            val beat = beats[secondaryIndex]
            val delaySeconds = player.playOtherOnly(beat, beats)
            currentIndex = secondaryIndex
            forcedOtherIndex = secondaryIndex
            beatsPlayed += 1
            applyTileOverride(secondaryIndex, OTHER_TILE_COLOR_HEX)
            onBeat?.invoke(secondaryIndex, beat, secondaryIndex)
            secondaryIndex += 1
            delay(delaySeconds.toDelayMillis())
        }
    }

    private fun completeNaturally() {
        running = false
        secondaryOnly = false
        forcedOtherIndex = null
        player.stop()
        onEnded?.invoke()
    }

    private fun applyTileOverride(index: Int, colorHex: String) {
        val beats = data?.beats ?: return
        if (index !in beats.indices) {
            return
        }
        if (tileColorOverrides[index] == colorHex) {
            return
        }
        tileColorOverrides[index] = colorHex
    }
}

private fun Double.toDelayMillis(): Long {
    return (this * 1000.0).coerceAtLeast(0.0).toLong()
}

package com.foreverjukebox.app.ui

import com.foreverjukebox.app.engine.VisualizationData
import com.foreverjukebox.app.playback.PlaybackController

internal interface TransportStopControls {
    fun stopJukeboxPlayback()
    fun stopAutocanonizerPlayback()
    fun stopExternalPlayback()
}

private class PlaybackControllerStopControls(
    private val controller: PlaybackController
) : TransportStopControls {
    override fun stopJukeboxPlayback() {
        controller.stopPlayback()
    }

    override fun stopAutocanonizerPlayback() {
        controller.autocanonizer.stop()
    }

    override fun stopExternalPlayback() {
        controller.stopExternalPlayback()
    }
}

internal interface AutocanonizerTransportControls {
    fun resetVisualization()
    fun startAtIndex(index: Int): Boolean
    fun startExternalPlayback(resetTimers: Boolean)
}

private class PlaybackControllerAutocanonizerControls(
    private val controller: PlaybackController
) : AutocanonizerTransportControls {
    override fun resetVisualization() {
        controller.autocanonizer.resetVisualization()
    }

    override fun startAtIndex(index: Int): Boolean {
        return controller.autocanonizer.startAtIndex(index)
    }

    override fun startExternalPlayback(resetTimers: Boolean) {
        controller.startExternalPlayback(resetTimers = resetTimers)
    }
}

internal interface JukeboxBeatSelectControls {
    fun seekToBeat(index: Int, data: VisualizationData?): Boolean
    fun isPlaying(): Boolean
    fun togglePlayback(): Boolean
}

private class PlaybackControllerJukeboxBeatSelectControls(
    private val controller: PlaybackController
) : JukeboxBeatSelectControls {
    override fun seekToBeat(index: Int, data: VisualizationData?): Boolean {
        return controller.seekToBeat(index, data)
    }

    override fun isPlaying(): Boolean = controller.isPlaying()

    override fun togglePlayback(): Boolean = controller.togglePlayback()
}

internal data class JukeboxBeatSelectResult(
    val success: Boolean,
    val startedPlayback: Boolean
)

internal fun stopAllPlaybackTransports(controls: TransportStopControls) {
    controls.stopJukeboxPlayback()
    controls.stopAutocanonizerPlayback()
    controls.stopExternalPlayback()
}

internal fun stopAllPlaybackTransports(controller: PlaybackController) {
    stopAllPlaybackTransports(PlaybackControllerStopControls(controller))
}

internal fun startAutocanonizerTransport(
    controls: AutocanonizerTransportControls,
    index: Int,
    resetTimers: Boolean
): Boolean {
    controls.resetVisualization()
    val started = controls.startAtIndex(index)
    if (!started) {
        return false
    }
    controls.startExternalPlayback(resetTimers = resetTimers)
    return true
}

internal fun startAutocanonizerTransport(
    controller: PlaybackController,
    index: Int,
    resetTimers: Boolean
): Boolean {
    return startAutocanonizerTransport(
        controls = PlaybackControllerAutocanonizerControls(controller),
        index = index,
        resetTimers = resetTimers
    )
}

internal fun seekOrStartJukeboxAtBeat(
    controls: JukeboxBeatSelectControls,
    index: Int,
    data: VisualizationData?
): JukeboxBeatSelectResult {
    if (!controls.seekToBeat(index, data)) {
        return JukeboxBeatSelectResult(success = false, startedPlayback = false)
    }
    if (controls.isPlaying()) {
        return JukeboxBeatSelectResult(success = true, startedPlayback = false)
    }
    val started = controls.togglePlayback()
    if (!started) {
        return JukeboxBeatSelectResult(success = false, startedPlayback = false)
    }
    val reseeked = controls.seekToBeat(index, data)
    return JukeboxBeatSelectResult(success = reseeked, startedPlayback = reseeked)
}

internal fun seekOrStartJukeboxAtBeat(
    controller: PlaybackController,
    index: Int,
    data: VisualizationData?
): JukeboxBeatSelectResult {
    return seekOrStartJukeboxAtBeat(
        controls = PlaybackControllerJukeboxBeatSelectControls(controller),
        index = index,
        data = data
    )
}

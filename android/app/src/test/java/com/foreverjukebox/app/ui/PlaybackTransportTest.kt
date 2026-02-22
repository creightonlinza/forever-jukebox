package com.foreverjukebox.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackTransportTest {

    @Test
    fun stopAllPlaybackTransportsInvokesAllStops() {
        val controls = FakeStopControls()

        stopAllPlaybackTransports(controls)

        assertEquals(1, controls.stopJukeboxCalls)
        assertEquals(1, controls.stopAutocanonizerCalls)
        assertEquals(1, controls.stopExternalCalls)
    }

    @Test
    fun startAutocanonizerTransportStartsExternalOnSuccess() {
        val controls = FakeAutocanonizerControls(startResult = true)

        val started = startAutocanonizerTransport(
            controls = controls,
            index = 12,
            resetTimers = true
        )

        assertTrue(started)
        assertEquals(1, controls.resetCalls)
        assertEquals(1, controls.startCalls)
        assertEquals(12, controls.lastStartIndex)
        assertEquals(1, controls.startExternalCalls)
        assertEquals(true, controls.lastResetTimers)
    }

    @Test
    fun startAutocanonizerTransportSkipsExternalOnFailure() {
        val controls = FakeAutocanonizerControls(startResult = false)

        val started = startAutocanonizerTransport(
            controls = controls,
            index = 7,
            resetTimers = false
        )

        assertFalse(started)
        assertEquals(1, controls.resetCalls)
        assertEquals(1, controls.startCalls)
        assertEquals(7, controls.lastStartIndex)
        assertEquals(0, controls.startExternalCalls)
    }

    @Test
    fun seekOrStartJukeboxAtBeatSeeksOnlyWhenAlreadyRunning() {
        val controls = FakeJukeboxBeatControls(
            isPlayingInitially = true,
            seekResults = mutableListOf(true)
        )

        val result = seekOrStartJukeboxAtBeat(
            controls = controls,
            index = 5,
            data = null
        )

        assertTrue(result.success)
        assertFalse(result.startedPlayback)
        assertEquals(1, controls.seekCalls)
        assertEquals(0, controls.toggleCalls)
        assertEquals(5, controls.lastSeekIndex)
    }

    @Test
    fun seekOrStartJukeboxAtBeatStartsWhenStopped() {
        val controls = FakeJukeboxBeatControls(
            isPlayingInitially = false,
            seekResults = mutableListOf(true, true),
            toggleResult = true
        )

        val result = seekOrStartJukeboxAtBeat(
            controls = controls,
            index = 9,
            data = null
        )

        assertTrue(result.success)
        assertTrue(result.startedPlayback)
        assertEquals(2, controls.seekCalls)
        assertEquals(1, controls.toggleCalls)
        assertEquals(9, controls.lastSeekIndex)
    }

    @Test
    fun seekOrStartJukeboxAtBeatFailsWhenInitialSeekFails() {
        val controls = FakeJukeboxBeatControls(
            isPlayingInitially = false,
            seekResults = mutableListOf(false),
            toggleResult = true
        )

        val result = seekOrStartJukeboxAtBeat(
            controls = controls,
            index = 2,
            data = null
        )

        assertFalse(result.success)
        assertFalse(result.startedPlayback)
        assertEquals(1, controls.seekCalls)
        assertEquals(0, controls.toggleCalls)
    }

    @Test
    fun seekOrStartJukeboxAtBeatFailsWhenToggleFails() {
        val controls = FakeJukeboxBeatControls(
            isPlayingInitially = false,
            seekResults = mutableListOf(true),
            toggleResult = false
        )

        val result = seekOrStartJukeboxAtBeat(
            controls = controls,
            index = 4,
            data = null
        )

        assertFalse(result.success)
        assertFalse(result.startedPlayback)
        assertEquals(1, controls.seekCalls)
        assertEquals(1, controls.toggleCalls)
    }
}

private class FakeStopControls : TransportStopControls {
    var stopJukeboxCalls = 0
    var stopAutocanonizerCalls = 0
    var stopExternalCalls = 0

    override fun stopJukeboxPlayback() {
        stopJukeboxCalls += 1
    }

    override fun stopAutocanonizerPlayback() {
        stopAutocanonizerCalls += 1
    }

    override fun stopExternalPlayback() {
        stopExternalCalls += 1
    }
}

private class FakeAutocanonizerControls(
    private val startResult: Boolean
) : AutocanonizerTransportControls {
    var resetCalls = 0
    var startCalls = 0
    var startExternalCalls = 0
    var lastStartIndex: Int? = null
    var lastResetTimers: Boolean? = null

    override fun resetVisualization() {
        resetCalls += 1
    }

    override fun startAtIndex(index: Int): Boolean {
        startCalls += 1
        lastStartIndex = index
        return startResult
    }

    override fun startExternalPlayback(resetTimers: Boolean) {
        startExternalCalls += 1
        lastResetTimers = resetTimers
    }
}

private class FakeJukeboxBeatControls(
    isPlayingInitially: Boolean,
    private val seekResults: MutableList<Boolean>,
    private val toggleResult: Boolean = true
) : JukeboxBeatSelectControls {
    private var playing = isPlayingInitially
    var seekCalls = 0
    var toggleCalls = 0
    var lastSeekIndex: Int? = null

    override fun seekToBeat(index: Int, data: com.foreverjukebox.app.engine.VisualizationData?): Boolean {
        seekCalls += 1
        lastSeekIndex = index
        return seekResults.removeFirstOrNull() ?: true
    }

    override fun isPlaying(): Boolean = playing

    override fun togglePlayback(): Boolean {
        toggleCalls += 1
        if (toggleResult) {
            playing = true
        }
        return toggleResult
    }
}

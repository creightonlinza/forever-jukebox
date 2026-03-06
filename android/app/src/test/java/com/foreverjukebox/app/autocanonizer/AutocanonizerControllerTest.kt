package com.foreverjukebox.app.autocanonizer

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AutocanonizerControllerTest {
    @Test
    fun startFailsWhenPlayerIsNotReady() = runTest {
        val player = FakeAutocanonizerPlayer(ready = false)
        val controller = AutocanonizerController(player, this)
        controller.setData(sampleData())

        val started = controller.startAtIndex(0)

        assertFalse(started)
        assertFalse(controller.isRunning())
    }

    @Test
    fun finishOutSongContinuesSecondarySequence() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = TestScope(dispatcher)
        val player = FakeAutocanonizerPlayer(ready = true)
        val controller = AutocanonizerController(player, scope)
        controller.setData(sampleData())
        controller.setFinishOutSong(true)

        val beats = mutableListOf<Int>()
        var ended = 0
        controller.setOnBeat { index, _, _ ->
            beats.add(index)
        }
        controller.setOnEnded {
            ended += 1
        }

        val started = controller.startAtIndex(3)
        scope.advanceUntilIdle()

        assertTrue(started)
        assertEquals(listOf(3, 1, 2, 3), beats)
        assertEquals(1, ended)
    }

    @Test
    fun tracksTileColorOverridesForVisualization() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = TestScope(dispatcher)
        val player = FakeAutocanonizerPlayer(ready = true)
        val controller = AutocanonizerController(player, scope)
        controller.setData(sampleData())

        val started = controller.startAtIndex(0)
        scope.advanceUntilIdle()

        assertTrue(started)
        val overrides = controller.getTileColorOverrides()
        assertTrue(overrides.isNotEmpty())
        assertEquals(AutocanonizerController.OTHER_TILE_COLOR_HEX, overrides[0])
        assertNotNull(overrides[3])
    }

    @Test
    fun pauseAndResumeTogglesControllerState() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = TestScope(dispatcher)
        val player = FakeAutocanonizerPlayer(ready = true)
        val controller = AutocanonizerController(player, scope)
        controller.setData(sampleData())

        val started = controller.startAtIndex(0)
        assertTrue(started)
        assertTrue(controller.isRunning())
        assertFalse(controller.isPaused())

        controller.pause()

        assertFalse(controller.isRunning())
        assertTrue(controller.isPaused())
        assertEquals(1, player.pauseCalls)

        val resumed = controller.resume()
        assertTrue(resumed)
        assertTrue(controller.isRunning())
        assertFalse(controller.isPaused())
        assertEquals(1, player.resumeCalls)
    }

    private fun sampleData(): AutocanonizerData {
        val beats = listOf(
            AutocanonizerBeat(index = 0, start = 0.0, duration = 1.0, nextIndex = 1, section = 0, indexInParent = 0, overlappingSegments = emptyList(), otherIndex = 0),
            AutocanonizerBeat(index = 1, start = 1.0, duration = 1.0, nextIndex = 2, section = 0, indexInParent = 1, overlappingSegments = emptyList(), otherIndex = 1),
            AutocanonizerBeat(index = 2, start = 2.0, duration = 1.0, nextIndex = 3, section = 0, indexInParent = 2, overlappingSegments = emptyList(), otherIndex = 2),
            AutocanonizerBeat(index = 3, start = 3.0, duration = 1.0, nextIndex = null, section = 0, indexInParent = 3, overlappingSegments = emptyList(), otherIndex = 1)
        )
        return AutocanonizerData(
            beats = beats,
            trackDuration = 4.0,
            sections = listOf(AutocanonizerSection(0.0, 4.0))
        )
    }
}

private class FakeAutocanonizerPlayer(
    private val ready: Boolean
) : AutocanonizerPlayer {
    var pauseCalls = 0
    var resumeCalls = 0

    override fun isReady(): Boolean = ready

    override fun syncAudioFromMain(): Boolean = ready

    override fun setVolume(volume: Double) = Unit

    override fun reset() = Unit

    override fun pause() {
        pauseCalls += 1
    }

    override fun resume() {
        resumeCalls += 1
    }

    override fun stop() = Unit

    override fun stopMain() = Unit

    override fun playBeat(beat: AutocanonizerBeat, beats: List<AutocanonizerBeat>): Double = 0.001

    override fun playOtherOnly(beat: AutocanonizerBeat, beats: List<AutocanonizerBeat>): Double = 0.001

    override fun release() = Unit
}

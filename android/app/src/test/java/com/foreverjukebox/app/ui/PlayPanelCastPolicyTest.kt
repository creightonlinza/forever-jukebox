package com.foreverjukebox.app.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayPanelCastPolicyTest {

    @Test
    fun hasCastTrackWhenEitherTrackIdIsAvailable() {
        val withYoutube = PlaybackState(lastYouTubeId = "abc123def45")
        val withJob = PlaybackState(lastJobId = "job_1")
        val empty = PlaybackState()

        assertTrue(withYoutube.hasCastTrack())
        assertTrue(withJob.hasCastTrack())
        assertFalse(empty.hasCastTrack())
    }

    @Test
    fun castControlsReadyRequiresCastingTrackAndNoLoadOrError() {
        val ready = PlaybackState(
            isCasting = true,
            lastYouTubeId = "abc123def45",
            analysisInFlight = false,
            analysisErrorMessage = null
        )
        val loading = ready.copy(analysisInFlight = true)
        val pending = ready.copy(isCastLoading = true)
        val errored = ready.copy(analysisErrorMessage = "load failed")
        val noTrack = ready.copy(lastYouTubeId = null)
        val notCasting = ready.copy(isCasting = false)

        assertTrue(ready.castControlsReady())
        assertFalse(loading.castControlsReady())
        assertFalse(pending.castControlsReady())
        assertFalse(errored.castControlsReady())
        assertFalse(noTrack.castControlsReady())
        assertFalse(notCasting.castControlsReady())
    }

    @Test
    fun shouldShowPlaybackTransportInLocalAndReadyCastStates() {
        val local = PlaybackState(isCasting = false)
        val castingLoading = PlaybackState(
            isCasting = true,
            lastYouTubeId = "abc123def45",
            analysisInFlight = true
        )
        val castingReady = PlaybackState(
            isCasting = true,
            lastYouTubeId = "abc123def45",
            analysisInFlight = false,
            analysisErrorMessage = null
        )

        assertTrue(shouldShowPlaybackTransport(local))
        assertFalse(shouldShowPlaybackTransport(castingLoading))
        assertTrue(shouldShowPlaybackTransport(castingReady))
    }

    @Test
    fun resolvePlaybackHeaderTitleShowsCastLoadingLabel() {
        val castingLoading = PlaybackState(
            isCasting = true,
            isCastLoading = true,
            playTitle = "Old Title — Old Artist"
        )
        val normal = PlaybackState(
            isCasting = false,
            analysisInFlight = false,
            playTitle = "Real Title — Artist"
        )

        assertTrue(resolvePlaybackHeaderTitle(castingLoading)?.contains("Loading track on cast device") == true)
        assertTrue(resolvePlaybackHeaderTitle(normal)?.contains("Real Title") == true)
    }

    @Test
    fun resolveListenContentModeSelectsCastBeforeAnythingElse() {
        val playback = PlaybackState(
            isCasting = true,
            audioLoaded = true,
            analysisLoaded = true
        )

        assertEquals(ListenContentMode.Cast, resolveListenContentMode(playback))
    }

    @Test
    fun resolveListenContentModeSelectsLocalWhenAudioAndAnalysisReady() {
        val playback = PlaybackState(
            isCasting = false,
            audioLoaded = true,
            analysisLoaded = true
        )

        assertEquals(ListenContentMode.LocalReady, resolveListenContentMode(playback))
    }

    @Test
    fun resolveListenContentModeSelectsEmptyWhenIdleWithNoTrack() {
        val playback = PlaybackState(
            isCasting = false,
            audioLoaded = false,
            analysisLoaded = false,
            analysisInFlight = false,
            analysisCalculating = false,
            audioLoading = false,
            analysisErrorMessage = null
        )

        assertEquals(ListenContentMode.Empty, resolveListenContentMode(playback))
    }

    @Test
    fun resolveListenContentModeReturnsNoneDuringLoadingOrError() {
        val loading = PlaybackState(
            isCasting = false,
            analysisInFlight = true
        )
        val errored = PlaybackState(
            isCasting = false,
            analysisErrorMessage = "boom"
        )

        assertEquals(ListenContentMode.None, resolveListenContentMode(loading))
        assertEquals(ListenContentMode.None, resolveListenContentMode(errored))
    }
}

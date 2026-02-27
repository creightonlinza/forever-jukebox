package com.foreverjukebox.app.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
        val errored = ready.copy(analysisErrorMessage = "load failed")
        val noTrack = ready.copy(lastYouTubeId = null)
        val notCasting = ready.copy(isCasting = false)

        assertTrue(ready.castControlsReady())
        assertFalse(loading.castControlsReady())
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
    fun expectedCastTrackIdsIncludesBothIdTypes() {
        val playback = PlaybackState(
            lastYouTubeId = "abc123def45",
            lastJobId = "job_42"
        )
        assertTrue("abc123def45" in playback.expectedCastTrackIds())
        assertTrue("job_42" in playback.expectedCastTrackIds())
    }

    @Test
    fun resolvePlaybackHeaderTitleShowsCastLoadingLabel() {
        val castingLoading = PlaybackState(
            isCasting = true,
            analysisInFlight = true,
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
}

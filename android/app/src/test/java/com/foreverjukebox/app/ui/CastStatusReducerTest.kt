package com.foreverjukebox.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CastStatusReducerTest {

    @Test
    fun parseCastStatusMessageRejectsInvalidPayloads() {
        assertNull(parseCastStatusMessage("not-json"))
        assertNull(parseCastStatusMessage("""{"type":"ping"}"""))
    }

    @Test
    fun parseCastStatusMessageParsesKnownFields() {
        val parsed = parseCastStatusMessage(
            """
            {
              "type":"status",
              "songId":"abc123def45",
              "title":"Track",
              "artist":"Artist",
              "trackDurationSeconds":212.4,
              "totalBeats":512,
              "totalBranches":73,
              "isPlaying":true,
              "isLoading":false,
              "playbackState":"playing",
              "error":"",
              "errorCode":"cast_track_too_long",
              "activeVizIndex":4,
              "resolvedThreshold":"28"
            }
            """.trimIndent()
        )
        assertNotNull(parsed)
        assertEquals("abc123def45", parsed?.songId)
        assertEquals("Track", parsed?.title)
        assertEquals("Artist", parsed?.artist)
        assertEquals(212.4, parsed?.trackDurationSeconds ?: 0.0, 0.0001)
        assertEquals(512, parsed?.totalBeats)
        assertEquals(73, parsed?.totalBranches)
        assertTrue(parsed?.isPlaying == true)
        assertFalse(parsed?.isLoading == true)
        assertEquals("playing", parsed?.playbackState)
        assertEquals("", parsed?.error)
        assertEquals("cast_track_too_long", parsed?.errorCode)
        assertEquals(4, parsed?.activeVizIndex)
        assertEquals(28, parsed?.resolvedThreshold)
    }

    @Test
    fun parseCastStatusMessageIgnoresInvalidThreshold() {
        val parsed = parseCastStatusMessage(
            """
            {
              "type":"status",
              "resolvedThreshold":"1"
            }
            """.trimIndent()
        )
        assertNotNull(parsed)
        assertNull(parsed?.resolvedThreshold)
    }

    @Test
    fun parseCastStatusMessageParsesSnakeCaseErrorCode() {
        val parsed = parseCastStatusMessage(
            """
            {
              "type":"status",
              "error_code":"cast_track_too_long"
            }
            """.trimIndent()
        )
        assertNotNull(parsed)
        assertEquals("cast_track_too_long", parsed?.errorCode)
    }

    @Test
    fun reduceCastStatusKeepsRunningDuringLoadingState() {
        val current = UiState(
            playback = PlaybackState(
                isRunning = true,
                playTitle = "Existing",
                trackTitle = "Old Track",
                trackArtist = "Old Artist",
                lastYouTubeId = "old_song",
                activeVizIndex = 2,
                analysisErrorMessage = "Previous error"
            ),
            tuning = TuningState(threshold = 22)
        )
        val status = CastStatusMessage(
            songId = "new_song",
            title = "",
            artist = "",
            trackDurationSeconds = null,
            totalBeats = null,
            totalBranches = null,
            isPlaying = false,
            isLoading = false,
            playbackState = "loading",
            error = "",
            activeVizIndex = 4,
            resolvedThreshold = null
        )

        val next = reduceCastStatus(current, status)

        assertTrue(next.playback.isRunning)
        assertTrue(next.playback.analysisInFlight)
        assertEquals("new_song", next.playback.lastYouTubeId)
        assertEquals(4, next.playback.activeVizIndex)
        assertEquals("Existing", next.playback.playTitle)
        assertEquals("Old Track", next.playback.trackTitle)
        assertEquals("Old Artist", next.playback.trackArtist)
        assertEquals("Previous error", next.playback.analysisErrorMessage)
        assertEquals(22, next.tuning.threshold)
    }

    @Test
    fun reduceCastStatusAppliesPlayingStateMetadataAndThreshold() {
        val current = UiState(
            playback = PlaybackState(
                isRunning = false,
                playTitle = "",
                activeVizIndex = 1
            ),
            tuning = TuningState(threshold = 8)
        )
        val status = CastStatusMessage(
            songId = "song_2",
            title = "New Song",
            artist = "New Artist",
            trackDurationSeconds = 189.5,
            totalBeats = 640,
            totalBranches = 82,
            isPlaying = true,
            isLoading = false,
            playbackState = "playing",
            error = "",
            activeVizIndex = 3,
            resolvedThreshold = 31
        )

        val next = reduceCastStatus(current, status)

        assertTrue(next.playback.isRunning)
        assertFalse(next.playback.analysisInFlight)
        assertEquals("New Song — New Artist", next.playback.playTitle)
        assertEquals("New Song", next.playback.trackTitle)
        assertEquals("New Artist", next.playback.trackArtist)
        assertFalse(next.playback.isPaused)
        assertEquals(189.5, next.playback.trackDurationSeconds ?: 0.0, 0.0001)
        assertEquals(640, next.playback.castTotalBeats)
        assertEquals(82, next.playback.castTotalBranches)
        assertEquals("song_2", next.playback.lastYouTubeId)
        assertEquals(3, next.playback.activeVizIndex)
        assertEquals(31, next.tuning.threshold)
    }

    @Test
    fun reduceCastStatusAppliesErrorAndRejectsInvalidVizIndex() {
        val current = UiState(
            playback = PlaybackState(
                isRunning = true,
                activeVizIndex = 5
            ),
            tuning = TuningState(threshold = 19)
        )
        val status = CastStatusMessage(
            songId = "",
            title = "",
            artist = "",
            trackDurationSeconds = null,
            totalBeats = null,
            totalBranches = null,
            isPlaying = true,
            isLoading = false,
            playbackState = "error",
            error = "Receiver error",
            activeVizIndex = 99,
            resolvedThreshold = null
        )

        val next = reduceCastStatus(current, status)

        assertFalse(next.playback.isRunning)
        assertFalse(next.playback.isPaused)
        assertFalse(next.playback.analysisInFlight)
        assertEquals("Receiver error", next.playback.analysisErrorMessage)
        assertEquals(5, next.playback.activeVizIndex)
        assertEquals(19, next.tuning.threshold)
    }

    @Test
    fun reduceCastStatusFallsBackToRawFlagsForUnknownPlaybackState() {
        val current = UiState(
            playback = PlaybackState(isRunning = true)
        )
        val loadingStatus = CastStatusMessage(
            songId = "",
            title = "",
            artist = "",
            trackDurationSeconds = null,
            totalBeats = null,
            totalBranches = null,
            isPlaying = false,
            isLoading = true,
            playbackState = "mystery",
            error = "",
            activeVizIndex = null,
            resolvedThreshold = null
        )
        val loadedPausedStatus = loadingStatus.copy(
            isLoading = false,
            isPlaying = false
        )

        val loading = reduceCastStatus(current, loadingStatus)
        val loadedPaused = reduceCastStatus(current, loadedPausedStatus)

        assertTrue(loading.playback.analysisInFlight)
        assertTrue(loading.playback.isRunning)
        assertFalse(loadedPaused.playback.analysisInFlight)
        assertFalse(loadedPaused.playback.isRunning)
    }

    @Test
    fun reduceCastStatusTracksCastLoadingFromReceiverState() {
        val current = UiState(
            playback = PlaybackState(
                isCasting = true,
                analysisInFlight = true,
                isRunning = true,
                playTitle = "Loading track on cast device...",
                lastYouTubeId = "new_song",
                activeVizIndex = 2
            ),
            tuning = TuningState(threshold = 24)
        )
        val loading = CastStatusMessage(
            songId = "new_song",
            title = "",
            artist = "",
            trackDurationSeconds = null,
            totalBeats = null,
            totalBranches = null,
            isPlaying = false,
            isLoading = true,
            playbackState = "loading",
            error = "",
            activeVizIndex = 4,
            resolvedThreshold = 31
        )

        val next = reduceCastStatus(current, loading)

        assertTrue(next.playback.isCastLoading)
        assertTrue(next.playback.analysisInFlight)
    }

    @Test
    fun reduceCastStatusClearsCastLoadingWhenReceiverIsReady() {
        val current = UiState(
            playback = PlaybackState(
                isCasting = true,
                analysisInFlight = true,
                isRunning = true,
                lastYouTubeId = "new_song",
                isCastLoading = true,
                playTitle = "Loading track on cast device..."
            )
        )
        val ready = CastStatusMessage(
            songId = "new_song",
            title = "Loaded Song",
            artist = "Artist",
            trackDurationSeconds = 201.0,
            totalBeats = 480,
            totalBranches = 56,
            isPlaying = true,
            isLoading = false,
            playbackState = "playing",
            error = "",
            activeVizIndex = 1,
            resolvedThreshold = 20
        )

        val next = reduceCastStatus(current, ready)

        assertFalse(next.playback.isCastLoading)
        assertFalse(next.playback.analysisInFlight)
        assertTrue(next.playback.isRunning)
        assertFalse(next.playback.isPaused)
        assertEquals(201.0, next.playback.trackDurationSeconds ?: 0.0, 0.0001)
        assertEquals(480, next.playback.castTotalBeats)
        assertEquals(56, next.playback.castTotalBranches)
    }

    @Test
    fun reduceCastStatusMarksPausedWhenReceiverReportsPausedState() {
        val current = UiState(
            playback = PlaybackState(
                isCasting = true,
                isRunning = true,
                isPaused = false,
                lastYouTubeId = "new_song"
            )
        )
        val paused = CastStatusMessage(
            songId = "new_song",
            title = "Loaded Song",
            artist = "Artist",
            trackDurationSeconds = 201.0,
            totalBeats = 480,
            totalBranches = 56,
            isPlaying = false,
            isLoading = false,
            playbackState = "paused",
            error = "",
            activeVizIndex = 1,
            resolvedThreshold = 20
        )

        val next = reduceCastStatus(current, paused)

        assertFalse(next.playback.isRunning)
        assertTrue(next.playback.isPaused)
        assertFalse(next.playback.analysisInFlight)
    }
}

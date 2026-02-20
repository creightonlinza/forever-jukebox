package com.foreverjukebox.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CastNotificationPolicyTest {

    @Test
    fun castNotificationHiddenWhenNotCasting() {
        val playback = PlaybackState(isRunning = true, trackTitle = "Song")
        assertFalse(playback.shouldShowCastNotification())
    }

    @Test
    fun castNotificationShownWhenCastingAndRunning() {
        val playback = PlaybackState(isCasting = true, isRunning = true)
        assertTrue(playback.shouldShowCastNotification())
    }

    @Test
    fun castNotificationShownForPausedTrack() {
        val playback = PlaybackState(
            isCasting = true,
            isRunning = false,
            lastYouTubeId = "abc123"
        )
        assertTrue(playback.shouldShowCastNotification())
    }

    @Test
    fun castNotificationHiddenWhenCastingWithoutTrack() {
        val playback = PlaybackState(isCasting = true, isRunning = false)
        assertFalse(playback.shouldShowCastNotification())
    }

    @Test
    fun castNotificationTitleUsesTrackTitleFirst() {
        val playback = PlaybackState(
            isCasting = true,
            trackTitle = "Golden Song",
            playTitle = "Golden Song — Artist"
        )
        assertEquals("Golden Song", playback.castNotificationTitle())
    }

    @Test
    fun castNotificationTitleFallsBackToPlayTitlePrefix() {
        val playback = PlaybackState(
            isCasting = true,
            playTitle = "Golden Song — Artist"
        )
        assertEquals("Golden Song", playback.castNotificationTitle())
    }
}

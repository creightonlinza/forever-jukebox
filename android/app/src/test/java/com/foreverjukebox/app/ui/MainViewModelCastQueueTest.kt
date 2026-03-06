package com.foreverjukebox.app.ui

import com.foreverjukebox.app.data.SpotifySearchItem
import com.foreverjukebox.app.data.TopSongItem
import com.foreverjukebox.app.data.YoutubeSearchItem
import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MainViewModelCastQueueTest {

    @Test
    fun tryQueueYoutubeAnalysisForCastSkipsBlankBaseUrl() = runTest {
        var called = false

        val queued = tryQueueYoutubeAnalysisForCast(
            baseUrl = "   ",
            youtubeId = "dQw4w9WgXcQ",
            title = "Track",
            artist = "Artist"
        ) { _, _, _, _ ->
            called = true
        }

        assertFalse(queued)
        assertFalse(called)
    }

    @Test
    fun tryQueueYoutubeAnalysisForCastInvokesStartWithNormalizedValues() = runTest {
        var resolvedBaseUrl: String? = null
        var resolvedYoutubeId: String? = null
        var resolvedTitle: String? = null
        var resolvedArtist: String? = null

        val queued = tryQueueYoutubeAnalysisForCast(
            baseUrl = " https://api.example.com ",
            youtubeId = "dQw4w9WgXcQ",
            title = "Track",
            artist = "Artist"
        ) { baseUrl, youtubeId, title, artist ->
            resolvedBaseUrl = baseUrl
            resolvedYoutubeId = youtubeId
            resolvedTitle = title
            resolvedArtist = artist
        }

        assertTrue(queued)
        assertEquals("https://api.example.com", resolvedBaseUrl)
        assertEquals("dQw4w9WgXcQ", resolvedYoutubeId)
        assertEquals("Track", resolvedTitle)
        assertEquals("Artist", resolvedArtist)
    }

    @Test
    fun tryQueueYoutubeAnalysisForCastReturnsFalseWhenStartFails() = runTest {
        val queued = tryQueueYoutubeAnalysisForCast(
            baseUrl = "https://api.example.com",
            youtubeId = "dQw4w9WgXcQ",
            title = null,
            artist = null
        ) { _, _, _, _ ->
            throw IOException("boom")
        }

        assertFalse(queued)
    }

    @Test
    fun tryQueueYoutubeAnalysisForCastSupportsNullMetadata() = runTest {
        var resolvedTitle: String? = "unexpected"
        var resolvedArtist: String? = "unexpected"

        val queued = tryQueueYoutubeAnalysisForCast(
            baseUrl = "https://api.example.com",
            youtubeId = "dQw4w9WgXcQ",
            title = null,
            artist = null
        ) { _, _, title, artist ->
            resolvedTitle = title
            resolvedArtist = artist
        }

        assertTrue(queued)
        assertNull(resolvedTitle)
        assertNull(resolvedArtist)
    }

    @Test
    fun resetSearchStateAfterTrackSelectionClearsTransientSelectionFields() {
        val original = SearchState(
            query = "daft punk",
            spotifyResults = listOf(SpotifySearchItem(id = "sp1", name = "Track")),
            youtubeMatches = listOf(YoutubeSearchItem(id = "yt1", title = "Track")),
            youtubeLoading = true,
            pendingTrackName = "Track",
            pendingTrackArtist = "Artist"
        )

        val reset = resetSearchStateAfterTrackSelection(original)

        assertEquals("", reset.query)
        assertTrue(reset.spotifyResults.isEmpty())
        assertTrue(reset.youtubeMatches.isEmpty())
        assertFalse(reset.youtubeLoading)
        assertNull(reset.pendingTrackName)
        assertNull(reset.pendingTrackArtist)
    }

    @Test
    fun resetSearchStateAfterTrackSelectionPreservesLibraryAndLoadingState() {
        val topSong = TopSongItem(youtubeId = "yt_top", title = "Top")
        val risingSong = TopSongItem(youtubeId = "yt_rising", title = "Rising")
        val recentSong = TopSongItem(youtubeId = "yt_recent", title = "Recent")
        val original = SearchState(
            topSongs = listOf(topSong),
            topSongsLoading = true,
            risingSongs = listOf(risingSong),
            risingSongsLoading = true,
            recentSongs = listOf(recentSong),
            recentSongsLoading = true,
            spotifyLoading = true
        )

        val reset = resetSearchStateAfterTrackSelection(original)

        assertEquals(listOf(topSong), reset.topSongs)
        assertTrue(reset.topSongsLoading)
        assertEquals(listOf(risingSong), reset.risingSongs)
        assertTrue(reset.risingSongsLoading)
        assertEquals(listOf(recentSong), reset.recentSongs)
        assertTrue(reset.recentSongsLoading)
        assertTrue(reset.spotifyLoading)
    }
}

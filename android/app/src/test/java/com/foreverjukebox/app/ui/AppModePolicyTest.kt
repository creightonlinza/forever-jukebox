package com.foreverjukebox.app.ui

import com.foreverjukebox.app.data.AppMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppModePolicyTest {

    @Test
    fun serverModeKeepsLegacyNavigation() {
        assertEquals(listOf(TabId.Top, TabId.Search, TabId.Play, TabId.Faq), tabsForMode(AppMode.Server))
        assertEquals(TabId.Top, defaultTabForMode(AppMode.Server))
        assertFalse(shouldShowAppModeGate(AppMode.Server))
        assertFalse(shouldShowBaseUrlPrompt(AppMode.Server, "https://api.foreverjukebox.com"))
    }

    @Test
    fun firstLaunchShowsGateAndLocalIsDefault() {
        assertTrue(shouldShowAppModeGate(null))
        assertEquals(AppMode.Local, defaultOnboardingMode)

        assertFalse(shouldShowAppModeGate(AppMode.Local))
        assertFalse(shouldShowBaseUrlPrompt(AppMode.Local, ""))
        assertEquals(TabId.Input, defaultTabForMode(AppMode.Local))
    }

    @Test
    fun firstLaunchServerSelectionRequiresBaseUrl() {
        assertFalse(shouldShowAppModeGate(AppMode.Server))
        assertTrue(shouldShowBaseUrlPrompt(AppMode.Server, ""))
        assertTrue(shouldShowBaseUrlPrompt(AppMode.Server, "not-a-url"))
        assertFalse(shouldShowBaseUrlPrompt(AppMode.Server, "https://example.com"))
    }

    @Test
    fun switchingModesUpdatesAvailableScreens() {
        assertEquals(listOf(TabId.Top, TabId.Search, TabId.Play, TabId.Faq), tabsForMode(AppMode.Server))
        assertEquals(TabId.Input, coerceTabForMode(AppMode.Local, TabId.Search))
        assertEquals(listOf(TabId.Input, TabId.Play, TabId.Faq), tabsForMode(AppMode.Local))
        assertEquals(TabId.Top, coerceTabForMode(AppMode.Server, TabId.Input))
    }

    @Test
    fun localModeOnlyShowsInputListenFaq() {
        val localTabs = tabsForMode(AppMode.Local)
        assertEquals(listOf(TabId.Input, TabId.Play, TabId.Faq), localTabs)
        assertFalse(localTabs.contains(TabId.Top))
        assertFalse(localTabs.contains(TabId.Search))
    }

    @Test
    fun localAnalysisCancellationPolicyOnlyCancelsOnInputChange() {
        assertFalse(
            shouldCancelLocalAnalysisOnTabChange(
                mode = AppMode.Local,
                isLocalAnalysisRunning = true,
                targetTab = TabId.Faq
            )
        )
        assertFalse(
            shouldCancelLocalAnalysisOnTabChange(
                mode = AppMode.Local,
                isLocalAnalysisRunning = true,
                targetTab = TabId.Input
            )
        )
        assertTrue(
            shouldCancelLocalAnalysisOnInputChange(
                mode = AppMode.Local,
                isLocalAnalysisRunning = true
            )
        )
        assertFalse(
            shouldCancelLocalAnalysisOnInputChange(
                mode = AppMode.Local,
                isLocalAnalysisRunning = false
            )
        )
    }

    @Test
    fun listenActionsAreServerOnly() {
        assertTrue(shouldShowServerListenActions(AppMode.Server))
        assertFalse(shouldShowServerListenActions(AppMode.Local))
        assertFalse(shouldShowServerListenActions(null))
    }

    @Test
    fun cancelButtonOnlyShowsOnLocalLoadingScreen() {
        val loadingPlayback = PlaybackState(analysisInFlight = true)
        val idlePlayback = PlaybackState()

        assertTrue(shouldShowLocalLoadingCancel(AppMode.Local, loadingPlayback))
        assertFalse(shouldShowLocalLoadingCancel(AppMode.Server, loadingPlayback))
        assertFalse(shouldShowLocalLoadingCancel(AppMode.Local, idlePlayback))
        assertFalse(
            shouldShowLocalLoadingCancel(
                AppMode.Local,
                loadingPlayback.copy(isCasting = true)
            )
        )
    }

    @Test
    fun modeSwitchResetClearsRuntimeState() {
        val current = UiState(
            appMode = AppMode.Local,
            baseUrl = "https://example.com",
            castEnabled = true,
            showAppModeGate = true,
            showBaseUrlPrompt = true,
            localSelectedFileName = "track.mp3",
            localAnalysisJsonPath = "/tmp/analysis.json",
            activeTab = TabId.Play,
            topSongsTab = TopSongsTab.Recent,
            search = SearchState(query = "abc", topSongsLoading = true),
            playback = PlaybackState(
                analysisInFlight = true,
                analysisMessage = "Processing audio",
                audioLoading = true,
                audioLoaded = true,
                analysisLoaded = true,
                playTitle = "Song"
            ),
            tuning = TuningState(threshold = 80, justBackwards = true)
        )

        val reset = stateAfterModeChangeReset(
            current = current,
            targetMode = AppMode.Server,
            castEnabled = true
        )

        assertEquals(AppMode.Server, reset.appMode)
        assertFalse(reset.showAppModeGate)
        assertFalse(reset.showBaseUrlPrompt)
        assertEquals(TabId.Top, reset.activeTab)
        assertEquals(TopSongsTab.TopSongs, reset.topSongsTab)
        assertEquals("", reset.search.query)
        assertFalse(reset.playback.analysisInFlight)
        assertFalse(reset.playback.audioLoading)
        assertFalse(reset.playback.audioLoaded)
        assertNull(reset.localSelectedFileName)
        assertNull(reset.localAnalysisJsonPath)
        assertEquals(TuningState(), reset.tuning)
    }

    @Test
    fun localAnalysisCancelResetsSelectionAndReturnsToInputTab() {
        val current = UiState(
            appMode = AppMode.Local,
            activeTab = TabId.Play,
            localSelectedFileName = "track.mp3",
            localAnalysisJsonPath = "/tmp/local.analysis.json"
        )

        val reset = stateAfterLocalAnalysisCancel(current)

        assertEquals(TabId.Input, reset.activeTab)
        assertNull(reset.localSelectedFileName)
        assertNull(reset.localAnalysisJsonPath)
    }
}

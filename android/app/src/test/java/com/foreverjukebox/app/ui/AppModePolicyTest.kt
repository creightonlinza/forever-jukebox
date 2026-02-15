package com.foreverjukebox.app.ui

import com.foreverjukebox.app.data.AppMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
}

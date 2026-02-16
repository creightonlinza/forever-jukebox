package com.foreverjukebox.app.ui

import com.foreverjukebox.app.data.AppMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerModeRegressionTest {
    @Test
    fun serverModeNavigationRemainsLegacy() {
        assertEquals(listOf(TabId.Top, TabId.Search, TabId.Play, TabId.Faq), tabsForMode(AppMode.Server))
        assertEquals(TabId.Top, defaultTabForMode(AppMode.Server))
        assertEquals(TabId.Top, coerceTabForMode(AppMode.Server, TabId.Input))
    }

    @Test
    fun serverModeStillRequiresValidBaseUrl() {
        assertTrue(shouldShowBaseUrlPrompt(AppMode.Server, ""))
        assertTrue(shouldShowBaseUrlPrompt(AppMode.Server, "not-a-url"))
        assertFalse(shouldShowBaseUrlPrompt(AppMode.Server, "https://example.com"))
    }

    @Test
    fun localModeCannotChangeServerPolicy() {
        assertFalse(tabsForMode(AppMode.Local).contains(TabId.Search))
        assertFalse(tabsForMode(AppMode.Local).contains(TabId.Top))
        assertEquals(TabId.Top, defaultTabForMode(AppMode.Server))
    }
}

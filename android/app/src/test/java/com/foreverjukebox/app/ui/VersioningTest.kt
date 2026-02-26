package com.foreverjukebox.app.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersioningTest {

    @Test
    fun detectsNewerDateVersionWithVPrefix() {
        assertTrue(isLatestVersionNewer("v2026.02.05", "v2026.03.01"))
    }

    @Test
    fun ignoresEquivalentVersionWithDifferentFormatting() {
        assertFalse(isLatestVersionNewer("2026.2.5", "v2026.02.05"))
    }

    @Test
    fun rejectsOlderLatestTag() {
        assertFalse(isLatestVersionNewer("v2026.04.10", "v2026.03.01"))
    }

    @Test
    fun handlesSemverStyleTags() {
        assertTrue(isLatestVersionNewer("1.9.4", "v1.10.0"))
    }

    @Test
    fun failsClosedWhenVersionsContainNoNumbers() {
        assertFalse(isLatestVersionNewer("dev", "latest"))
    }
}

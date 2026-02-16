package com.foreverjukebox.app.local

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAnalysisBridgeTest {
    @Test
    fun reportsNativeLoadFailureInJvmUnitTests() {
        val error = NativeAnalysisBridge.madmomBeatsPortLastErrorMessage()
        assertNotNull(error)
        assertTrue(error!!.isNotBlank())
    }

    @Test(expected = NativeLocalAnalysisNotReadyException::class)
    fun nativeCallsFailFastWhenLibraryIsUnavailable() {
        NativeAnalysisBridge.madmomBeatsPortAnalyzeJson(
            samples = floatArrayOf(0f),
            sampleRate = 44_100,
            configJson = null
        )
    }
}

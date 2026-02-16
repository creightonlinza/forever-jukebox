package com.foreverjukebox.app.local

object NativeAnalysisBridge {
    private val nativeLoadError: String? by lazy {
        try {
            System.loadLibrary("local_analysis_jni")
            null
        } catch (error: UnsatisfiedLinkError) {
            error.message ?: "Failed to load local_analysis_jni"
        }
    }

    private fun ensureLoaded() {
        val loadError = nativeLoadError ?: return
        throw NativeLocalAnalysisNotReadyException(
            "Native local analysis library failed to load: $loadError"
        )
    }

    fun resample(samples: FloatArray, fromRate: Int, toRate: Int): FloatArray {
        ensureLoaded()
        return nativeResample(samples, fromRate, toRate)
    }

    fun cancel() {
        if (nativeLoadError == null) {
            nativeCancel()
        }
    }

    fun resetCancellationState() {
        if (nativeLoadError == null) {
            nativeResetCancel()
        }
    }

    fun madmomBeatsPortAnalyzeJson(
        samples: FloatArray,
        sampleRate: Int,
        configJson: String?
    ): String? {
        ensureLoaded()
        return nativeMadmomBeatsPortAnalyzeJson(samples, sampleRate, configJson)
    }

    fun madmomBeatsPortDefaultConfigJson(): String? {
        ensureLoaded()
        return nativeMadmomBeatsPortDefaultConfigJson()
    }

    fun madmomBeatsPortLastErrorMessage(): String? {
        if (nativeLoadError != null) {
            return nativeLoadError
        }
        return nativeMadmomBeatsPortLastErrorMessage()
    }

    fun essentiaExtractFeaturesJson(
        samples: FloatArray,
        sampleRate: Int,
        frameSize: Int,
        hopSize: Int
    ): String? {
        ensureLoaded()
        return nativeEssentiaExtractFeaturesJson(samples, sampleRate, frameSize, hopSize)
    }

    fun essentiaLastErrorMessage(): String? {
        if (nativeLoadError != null) {
            return nativeLoadError
        }
        return nativeEssentiaLastErrorMessage()
    }

    private external fun nativeResample(
        samples: FloatArray,
        fromRate: Int,
        toRate: Int
    ): FloatArray

    private external fun nativeCancel()
    private external fun nativeResetCancel()

    private external fun nativeMadmomBeatsPortAnalyzeJson(
        samples: FloatArray,
        sampleRate: Int,
        configJson: String?
    ): String?

    private external fun nativeMadmomBeatsPortDefaultConfigJson(): String?

    private external fun nativeMadmomBeatsPortLastErrorMessage(): String?

    private external fun nativeEssentiaExtractFeaturesJson(
        samples: FloatArray,
        sampleRate: Int,
        frameSize: Int,
        hopSize: Int
    ): String?

    private external fun nativeEssentiaLastErrorMessage(): String?
}

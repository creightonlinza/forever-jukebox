package com.foreverjukebox.app.local

interface AudioResampler {
    fun resample(samples: FloatArray, fromRate: Int, toRate: Int): FloatArray
}

class NativeSpeexAudioResampler : AudioResampler {
    override fun resample(samples: FloatArray, fromRate: Int, toRate: Int): FloatArray {
        val output = NativeAnalysisBridge.resample(samples, fromRate, toRate)
        if (samples.isNotEmpty() && output.isEmpty()) {
            throw IllegalStateException(
                "Native resampler returned empty output for non-empty input (fromRate=$fromRate,toRate=$toRate,input=${samples.size})"
            )
        }
        return output
    }
}

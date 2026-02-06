package com.foreverjukebox.app.audio

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.foreverjukebox.app.engine.JukeboxPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer

class BufferedAudioPlayer : JukeboxPlayer {
    private var sampleRate = 44100
    private var channelCount = 2
    private var nativeHandle: Long = 0
    private var durationSeconds: Double? = null

    suspend fun loadFile(
        file: File,
        onProgress: ((Int) -> Unit)? = null
    ) {
        durationSeconds = null
        releaseNativePlayer()
        val decoded = withContext(Dispatchers.IO) {
            decodeToPcm(file, onProgress)
        }
        sampleRate = decoded.sampleRate
        channelCount = decoded.channelCount
        durationSeconds = decoded.durationSeconds
        ensureNativePlayer()
        nativeLoadPcm(nativeHandle, decoded.data)
    }

    fun release() {
        releaseNativePlayer()
    }

    fun clear() {
        releaseNativePlayer()
        durationSeconds = null
    }

    override fun play() {
        if (nativeHandle != 0L) {
            nativePlay(nativeHandle)
        }
    }

    override fun pause() {
        if (nativeHandle != 0L) {
            nativePause(nativeHandle)
        }
    }

    override fun stop() {
        if (nativeHandle != 0L) {
            nativeStop(nativeHandle)
        }
    }

    override fun seek(time: Double) {
        if (nativeHandle != 0L) {
            nativeSeek(nativeHandle, time)
        }
    }

    override fun scheduleJump(targetTime: Double, audioStart: Double) {
        if (nativeHandle != 0L) {
            nativeScheduleJump(nativeHandle, targetTime, audioStart)
        }
    }

    override fun getCurrentTime(): Double {
        if (nativeHandle == 0L) return 0.0
        return nativeGetCurrentTime(nativeHandle)
    }

    override fun getAudioTime(): Double {
        if (nativeHandle == 0L) return 0.0
        return nativeGetAudioTime(nativeHandle)
    }

    override fun isPlaying(): Boolean {
        return nativeHandle != 0L && nativeIsPlaying(nativeHandle)
    }

    fun getDurationSeconds(): Double? {
        return durationSeconds
    }

    private fun ensureNativePlayer() {
        if (nativeHandle != 0L) return
        nativeHandle = nativeCreatePlayer(sampleRate, channelCount)
    }

    private fun releaseNativePlayer() {
        if (nativeHandle == 0L) return
        nativeRelease(nativeHandle)
        nativeHandle = 0L
    }

    private fun decodeToPcm(
        file: File,
        onProgress: ((Int) -> Unit)?
    ): DecodedAudio {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        var audioTrackIndex = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val trackFormat = extractor.getTrackFormat(i)
            val mime = trackFormat.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                audioTrackIndex = i
                format = trackFormat
                break
            }
        }
        if (audioTrackIndex < 0 || format == null) {
            extractor.release()
            throw IllegalStateException("No audio track found")
        }
        extractor.selectTrack(audioTrackIndex)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: throw IllegalStateException("Missing MIME")
        val decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(format, null, null, 0)
        decoder.start()

        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
            format.getLong(MediaFormat.KEY_DURATION)
        } else {
            -1L
        }
        val output = if (durationUs > 0) {
            val expectedBytes = (durationUs * sampleRate.toLong() * channels.toLong() * 2L) / 1_000_000L
            ByteArrayOutputStream(expectedBytes.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        } else {
            ByteArrayOutputStream()
        }
        var expectedPcmBytes = if (durationUs > 0) {
            (durationUs * sampleRate.toLong() * channels.toLong() * 2L) / 1_000_000L
        } else {
            -1L
        }
        var outputBytesWritten = 0L
        var lastProgress = -1
        var chunkBuffer = ByteArray(8192)

        fun reportProgress(sampleTimeUs: Long) {
            val ratio = if (expectedPcmBytes > 0) {
                outputBytesWritten.toDouble() / expectedPcmBytes.toDouble()
            } else if (durationUs > 0) {
                sampleTimeUs.toDouble() / durationUs.toDouble()
            } else {
                return
            }
            val percent = (ratio * 100.0).toInt().coerceIn(0, 99)
            if (percent > lastProgress) {
                lastProgress = percent
                onProgress?.invoke(percent)
            }
        }

        onProgress?.invoke(0)
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inputIndex = decoder.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val inputBuffer = decoder.getInputBuffer(inputIndex) ?: ByteBuffer.allocate(0)
                        val sampleSize = extractor.readSampleData(inputBuffer, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(
                                inputIndex,
                                0,
                                0,
                                0L,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM
                            )
                            inputDone = true
                        } else {
                            val presentationTimeUs = extractor.sampleTime
                            decoder.queueInputBuffer(inputIndex, 0, sampleSize, presentationTimeUs, 0)
                            reportProgress(presentationTimeUs)
                            extractor.advance()
                        }
                    }
                }

                val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)
                when {
                    outputIndex >= 0 -> {
                        val outBuffer = decoder.getOutputBuffer(outputIndex)
                        if (outBuffer != null && info.size > 0) {
                            if (info.size > chunkBuffer.size) {
                                var nextSize = chunkBuffer.size
                                while (nextSize < info.size) {
                                    nextSize *= 2
                                }
                                chunkBuffer = ByteArray(nextSize)
                            }
                            outBuffer.get(chunkBuffer, 0, info.size)
                            outBuffer.clear()
                            output.write(chunkBuffer, 0, info.size)
                            outputBytesWritten += info.size.toLong().coerceAtLeast(0L)
                            reportProgress(info.presentationTimeUs)
                        }
                        decoder.releaseOutputBuffer(outputIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            outputDone = true
                        }
                    }
                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val newFormat = decoder.outputFormat
                        sampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (durationUs > 0) {
                            expectedPcmBytes = (durationUs * sampleRate.toLong() * channels.toLong() * 2L) / 1_000_000L
                        }
                    }
                }
            }
        } finally {
            decoder.stop()
            decoder.release()
            extractor.release()
            output.flush()
            output.close()
        }
        onProgress?.invoke(100)
        val data = output.toByteArray()
        val bytesPerFrame = channels * 2
        val totalFrames = if (bytesPerFrame > 0) data.size / bytesPerFrame else 0
        val durationSeconds = if (sampleRate > 0) {
            totalFrames.toDouble() / sampleRate.toDouble()
        } else {
            0.0
        }
        return DecodedAudio(data, sampleRate, channels, durationSeconds)
    }

    private data class DecodedAudio(
        val data: ByteArray,
        val sampleRate: Int,
        val channelCount: Int,
        val durationSeconds: Double
    )

    private external fun nativeCreatePlayer(sampleRate: Int, channelCount: Int): Long
    private external fun nativeLoadPcm(handle: Long, data: ByteArray)
    private external fun nativePlay(handle: Long)
    private external fun nativePause(handle: Long)
    private external fun nativeStop(handle: Long)
    private external fun nativeSeek(handle: Long, timeSeconds: Double)
    private external fun nativeScheduleJump(handle: Long, targetTime: Double, audioStart: Double)
    private external fun nativeGetCurrentTime(handle: Long): Double
    private external fun nativeGetAudioTime(handle: Long): Double
    private external fun nativeIsPlaying(handle: Long): Boolean
    private external fun nativeRelease(handle: Long)

    companion object {
        init {
            System.loadLibrary("fj_oboe")
        }
    }
}

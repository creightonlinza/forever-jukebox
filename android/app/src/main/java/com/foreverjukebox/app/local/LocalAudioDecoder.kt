package com.foreverjukebox.app.local

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

interface LocalAudioDecoderPort {
    suspend fun decodeToMono(
        uriString: String,
        onDecodeProgress: (Int) -> Unit
    ): DecodedLocalAudio
}

class LocalAudioDecoder(private val context: Context) : LocalAudioDecoderPort {

    override
    suspend fun decodeToMono(
        uriString: String,
        onDecodeProgress: (Int) -> Unit
    ): DecodedLocalAudio = withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriString)
        val displayName = queryDisplayName(uri)
        decodeUri(uri, displayName, onDecodeProgress)
    }

    private fun queryDisplayName(uri: Uri): String? {
        val projection = arrayOf(OpenableColumns.DISPLAY_NAME)
        return context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) {
                cursor.getString(index)
            } else {
                null
            }
        }
    }

    private suspend fun decodeUri(
        uri: Uri,
        displayName: String?,
        onDecodeProgress: (Int) -> Unit
    ): DecodedLocalAudio {
        val extractor = MediaExtractor()
        val dataSourceSet = runCatching {
            if (uri.scheme.equals("file", ignoreCase = true)) {
                val path = uri.path ?: throw UnsupportedAudioFormatException("Unsupported audio format")
                extractor.setDataSource(path)
            } else {
                extractor.setDataSource(context, uri, emptyMap())
            }
        }.isSuccess
        if (!dataSourceSet) {
            extractor.release()
            throw UnsupportedAudioFormatException("Unsupported audio format")
        }
        var audioTrackIndex = -1
        var inputFormat: MediaFormat? = null
        for (index in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(index)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                audioTrackIndex = index
                inputFormat = format
                break
            }
        }
        if (audioTrackIndex < 0 || inputFormat == null) {
            extractor.release()
            throw UnsupportedAudioFormatException("Unsupported audio format")
        }
        extractor.selectTrack(audioTrackIndex)
        val mime = inputFormat.getString(MediaFormat.KEY_MIME)
            ?: throw UnsupportedAudioFormatException("Unsupported audio format")
        val durationUs = if (inputFormat.containsKey(MediaFormat.KEY_DURATION)) {
            inputFormat.getLong(MediaFormat.KEY_DURATION)
        } else {
            -1L
        }
        Log.i(
            TAG,
            "Decode start uri=$uri, mime=$mime, durationUs=$durationUs, inputRate=${inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)}, channels=${inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)}"
        )

        val decoder = runCatching { MediaCodec.createDecoderByType(mime) }.getOrElse {
            extractor.release()
            throw UnsupportedAudioFormatException("Unsupported audio format")
        }
        decoder.configure(inputFormat, null, null, 0)
        decoder.start()

        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channelCount = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var channelMask = if (inputFormat.containsKey(MediaFormat.KEY_CHANNEL_MASK)) {
            inputFormat.getInteger(MediaFormat.KEY_CHANNEL_MASK)
        } else {
            0
        }
        var downmixWeights = ffmpegMonoDownmixWeights(channelCount, channelMask)
        Log.i(TAG, "Initial downmix config: channels=$channelCount, channelMask=$channelMask")
        var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
        var lastProgress = -1
        val monoSamples = FloatArrayAccumulator(estimateInitialSampleCapacity(durationUs, sampleRate))
        var queuedInputBuffers = 0
        var drainedOutputBuffers = 0
        var zeroSampleReads = 0
        var tryAgainLaterCount = 0
        var maxConsecutiveTryAgain = 0
        var consecutiveTryAgain = 0
        var lastOutputAtMs = SystemClock.elapsedRealtime()
        val decodeStartAtMs = lastOutputAtMs

        fun reportProgress(presentationTimeUs: Long) {
            if (durationUs <= 0L) return
            val ratio = presentationTimeUs.toDouble() / durationUs.toDouble()
            val percent = min(99, max(0, (ratio * 100.0).toInt()))
            if (percent > lastProgress) {
                lastProgress = percent
                onDecodeProgress(percent)
                if (percent % 10 == 0) {
                    Log.d(
                        TAG,
                        "Decode progress=${percent}%, monoSamples=${monoSamples.size()}, queued=$queuedInputBuffers, drained=$drainedOutputBuffers, heap=${heapSummary()}"
                    )
                }
            }
        }

        onDecodeProgress(0)
        try {
            while (!outputDone) {
                currentCoroutineContext().ensureActive()
                if (!inputDone) {
                    val inputIndex = decoder.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val inputBuffer = decoder.getInputBuffer(inputIndex) ?: continue
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
                            Log.d(TAG, "Queued decoder EOS input buffer")
                        } else if (sampleSize == 0) {
                            zeroSampleReads += 1
                            val advanced = extractor.advance()
                            if (!advanced) {
                                decoder.queueInputBuffer(
                                    inputIndex,
                                    0,
                                    0,
                                    0L,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                )
                                inputDone = true
                                Log.w(TAG, "Zero-byte sample at stream end; queued EOS")
                            } else if (zeroSampleReads % 200 == 0) {
                                Log.w(TAG, "Repeated zero-byte extractor samples count=$zeroSampleReads")
                            }
                        } else {
                            val presentationTimeUs = extractor.sampleTime
                            decoder.queueInputBuffer(inputIndex, 0, sampleSize, presentationTimeUs, 0)
                            queuedInputBuffers += 1
                            reportProgress(presentationTimeUs)
                            extractor.advance()
                        }
                    }
                }

                val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)
                when {
                    outputIndex >= 0 -> {
                        consecutiveTryAgain = 0
                        lastOutputAtMs = SystemClock.elapsedRealtime()
                        val outputBuffer = decoder.getOutputBuffer(outputIndex)
                        if (outputBuffer != null && info.size > 0) {
                            currentCoroutineContext().ensureActive()
                            outputBuffer.position(info.offset)
                            outputBuffer.limit(info.offset + info.size)
                            when (pcmEncoding) {
                                AudioFormat.ENCODING_PCM_16BIT -> appendPcm16ToMono(
                                    buffer = outputBuffer,
                                    downmixWeights = downmixWeights,
                                    sink = monoSamples
                                )
                                AudioFormat.ENCODING_PCM_FLOAT -> appendPcmFloatToMono(
                                    buffer = outputBuffer,
                                    downmixWeights = downmixWeights,
                                    sink = monoSamples
                                )
                                else -> throw UnsupportedAudioFormatException("Unsupported audio format")
                            }
                            reportProgress(info.presentationTimeUs)
                        }
                        drainedOutputBuffers += 1
                        decoder.releaseOutputBuffer(outputIndex, false)
                        if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            outputDone = true
                            Log.d(TAG, "Decoder output EOS reached")
                        }
                    }

                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val newFormat = decoder.outputFormat
                        sampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channelCount = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        channelMask = if (newFormat.containsKey(MediaFormat.KEY_CHANNEL_MASK)) {
                            newFormat.getInteger(MediaFormat.KEY_CHANNEL_MASK)
                        } else {
                            0
                        }
                        downmixWeights = ffmpegMonoDownmixWeights(channelCount, channelMask)
                        pcmEncoding = if (newFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                            newFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
                        } else {
                            AudioFormat.ENCODING_PCM_16BIT
                        }
                        Log.i(
                            TAG,
                            "Decoder output format changed: sampleRate=$sampleRate, channels=$channelCount, channelMask=$channelMask, pcmEncoding=$pcmEncoding"
                        )
                    }

                    outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        tryAgainLaterCount += 1
                        consecutiveTryAgain += 1
                        maxConsecutiveTryAgain = max(maxConsecutiveTryAgain, consecutiveTryAgain)
                        if (tryAgainLaterCount % 500 == 0) {
                            val stalledMs = SystemClock.elapsedRealtime() - lastOutputAtMs
                            Log.w(
                                TAG,
                                "Decoder waiting for output: tries=$tryAgainLaterCount, stalledMs=$stalledMs, inputDone=$inputDone, queued=$queuedInputBuffers, drained=$drainedOutputBuffers, heap=${heapSummary()}"
                            )
                        }
                        if (inputDone) {
                            val stalledMs = SystemClock.elapsedRealtime() - lastOutputAtMs
                            if (stalledMs > DECODE_STALL_AFTER_EOS_MS) {
                                throw IllegalStateException(
                                    "Decoder stalled after EOS: stalledMs=$stalledMs queued=$queuedInputBuffers drained=$drainedOutputBuffers tries=$tryAgainLaterCount"
                                )
                            }
                        }
                    }
                }
            }
        } finally {
            runCatching { decoder.stop() }
            decoder.release()
            extractor.release()
        }

        onDecodeProgress(100)
        val samples = monoSamples.finish()
        if (samples.isEmpty()) {
            throw UnsupportedAudioFormatException("Unsupported audio format")
        }
        val durationSeconds = if (sampleRate > 0) {
            samples.size.toDouble() / sampleRate.toDouble()
        } else {
            0.0
        }
        val elapsedMs = SystemClock.elapsedRealtime() - decodeStartAtMs
        Log.i(
            TAG,
            "Decode complete in ${elapsedMs}ms: samples=${samples.size}, sampleRate=$sampleRate, queued=$queuedInputBuffers, drained=$drainedOutputBuffers, tryAgain=$tryAgainLaterCount, maxConsecutiveTryAgain=$maxConsecutiveTryAgain, heap=${heapSummary()}"
        )
        return DecodedLocalAudio(
            monoSamples = samples,
            sampleRate = sampleRate,
            durationSeconds = durationSeconds,
            sourceUri = uri.toString(),
            displayName = displayName
        )
    }

    private fun appendPcm16ToMono(
        buffer: java.nio.ByteBuffer,
        downmixWeights: FloatArray,
        sink: FloatArrayAccumulator
    ) {
        val channels = downmixWeights.size
        if (channels <= 0) return
        val shortBuffer = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val sampleCount = shortBuffer.remaining()
        val frameCount = sampleCount / channels
        repeat(frameCount) {
            var mixed = 0f
            for (channel in 0 until channels) {
                mixed += (shortBuffer.get().toFloat() / 32768f) * downmixWeights[channel]
            }
            sink.add(mixed)
        }
    }

    private fun appendPcmFloatToMono(
        buffer: java.nio.ByteBuffer,
        downmixWeights: FloatArray,
        sink: FloatArrayAccumulator
    ) {
        val channels = downmixWeights.size
        if (channels <= 0) return
        val floatBuffer = buffer.order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        val sampleCount = floatBuffer.remaining()
        val frameCount = sampleCount / channels
        repeat(frameCount) {
            var mixed = 0f
            for (channel in 0 until channels) {
                mixed += floatBuffer.get() * downmixWeights[channel]
            }
            sink.add(mixed)
        }
    }

    // Approximate ffmpeg/swresample mono rematrix behavior: -3dB center/surround and no LFE.
    private fun ffmpegMonoDownmixWeights(channels: Int, channelMask: Int): FloatArray {
        if (channels <= 0) return FloatArray(0)
        if (channels == 1) return floatArrayOf(1f)

        val weights = FloatArray(channels)
        var assigned = 0
        if (channelMask != 0) {
            for (channelBit in CHANNEL_MASK_ORDER) {
                if (assigned >= channels) break
                if ((channelMask and channelBit) != 0) {
                    weights[assigned] = when (channelBit) {
                        AudioFormat.CHANNEL_OUT_LOW_FREQUENCY -> 0f
                        AudioFormat.CHANNEL_OUT_FRONT_CENTER,
                        AudioFormat.CHANNEL_OUT_BACK_CENTER,
                        AudioFormat.CHANNEL_OUT_BACK_LEFT,
                        AudioFormat.CHANNEL_OUT_BACK_RIGHT,
                        AudioFormat.CHANNEL_OUT_SIDE_LEFT,
                        AudioFormat.CHANNEL_OUT_SIDE_RIGHT -> MINUS_3DB
                        else -> 1f
                    }
                    assigned += 1
                }
            }
        }

        while (assigned < channels) {
            weights[assigned] = when {
                channels == 2 -> 1f
                assigned == 2 -> MINUS_3DB
                assigned == 3 && channels >= 4 -> 0f
                assigned >= 4 -> MINUS_3DB
                else -> 1f
            }
            assigned += 1
        }

        val total = weights.sum()
        if (total <= 1e-6f) {
            val equal = 1f / channels.toFloat()
            for (i in weights.indices) {
                weights[i] = equal
            }
            return weights
        }
        for (i in weights.indices) {
            weights[i] /= total
        }
        return weights
    }

    private fun estimateInitialSampleCapacity(durationUs: Long, sampleRate: Int): Int {
        if (durationUs <= 0L || sampleRate <= 0) return DEFAULT_INITIAL_CAPACITY
        val estimated = ((durationUs.toDouble() / 1_000_000.0) * sampleRate.toDouble()).toLong()
        return estimated.coerceIn(
            DEFAULT_INITIAL_CAPACITY.toLong(),
            MAX_INITIAL_CAPACITY.toLong()
        ).toInt()
    }

    private fun heapSummary(): String {
        val runtime = Runtime.getRuntime()
        val usedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
        val maxMb = runtime.maxMemory() / (1024 * 1024)
        return "${usedMb}MB/${maxMb}MB"
    }

    companion object {
        private const val TAG = "LocalAudioDecoder"
        private const val DEFAULT_INITIAL_CAPACITY = 4_096
        private const val MAX_INITIAL_CAPACITY = 6_000_000
        private const val DECODE_STALL_AFTER_EOS_MS = 15_000L
        private const val MINUS_3DB = 0.70710677f

        private val CHANNEL_MASK_ORDER = intArrayOf(
            AudioFormat.CHANNEL_OUT_FRONT_LEFT,
            AudioFormat.CHANNEL_OUT_FRONT_RIGHT,
            AudioFormat.CHANNEL_OUT_FRONT_CENTER,
            AudioFormat.CHANNEL_OUT_LOW_FREQUENCY,
            AudioFormat.CHANNEL_OUT_BACK_LEFT,
            AudioFormat.CHANNEL_OUT_BACK_RIGHT,
            AudioFormat.CHANNEL_OUT_FRONT_LEFT_OF_CENTER,
            AudioFormat.CHANNEL_OUT_FRONT_RIGHT_OF_CENTER,
            AudioFormat.CHANNEL_OUT_BACK_CENTER,
            AudioFormat.CHANNEL_OUT_SIDE_LEFT,
            AudioFormat.CHANNEL_OUT_SIDE_RIGHT
        )
    }
}

private class FloatArrayAccumulator(initialCapacity: Int = 4096) {
    private var buffer = FloatArray(max(initialCapacity, 1))
    private var size = 0

    fun add(value: Float) {
        if (size >= buffer.size) {
            val nextSize = if (buffer.size >= Int.MAX_VALUE / 2) Int.MAX_VALUE else buffer.size * 2
            if (nextSize <= buffer.size) {
                throw OutOfMemoryError("FloatArrayAccumulator overflow at size=$size")
            }
            buffer = buffer.copyOf(nextSize)
        }
        buffer[size] = value
        size += 1
    }

    fun size(): Int = size

    fun finish(): FloatArray {
        if (size == buffer.size) return buffer
        return buffer.copyOf(size)
    }
}

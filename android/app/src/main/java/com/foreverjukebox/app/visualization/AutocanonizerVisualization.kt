package com.foreverjukebox.app.visualization

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.core.graphics.toColorInt
import com.foreverjukebox.app.autocanonizer.AutocanonizerBeat
import com.foreverjukebox.app.autocanonizer.AutocanonizerController
import com.foreverjukebox.app.autocanonizer.AutocanonizerData
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

private const val PATH_SAMPLE_STEPS = 80
private const val CURVE_DEPTH_MULTIPLIER = 1.2f
private const val MIN_CURVE_TRIGGER = 20f
private const val MIN_CURVE_DEPTH = 30f
private const val OTHER_CURSOR_HOLD_MS = 120L
private const val OTHER_CURSOR_DURATION_FACTOR = 0.75

@Composable
fun AutocanonizerVisualization(
    data: AutocanonizerData?,
    currentIndex: Int,
    forcedOtherIndex: Int?,
    tileColorOverrides: Map<Int, String>,
    onSelectBeat: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val beats = data?.beats.orEmpty()
    val sections = data?.sections.orEmpty()
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    val layout = remember(data, canvasSize) {
        computeLayout(data, canvasSize.width.toFloat(), canvasSize.height.toFloat())
    }
    var otherAnim by remember(data) { mutableStateOf<OtherCursorAnimation?>(null) }
    var animatedOtherCursor by remember(data) { mutableStateOf<Offset?>(null) }
    var lastOtherCursor by remember(data) { mutableStateOf<Offset?>(null) }
    var otherAnimEndedAtNanos by remember(data) { mutableStateOf<Long?>(null) }
    var previousIndex by remember(data) { mutableIntStateOf(-1) }

    LaunchedEffect(layout, currentIndex, forcedOtherIndex, data) {
        val currentLayout = layout ?: run {
            otherAnim = null
            animatedOtherCursor = null
            previousIndex = -1
            return@LaunchedEffect
        }
        val sectionCursorY = currentLayout.topPad + currentLayout.tileHeight - 12f
        if (forcedOtherIndex != null) {
            otherAnim = null
            animatedOtherCursor = null
            otherAnimEndedAtNanos = null
            val forcedRect = currentLayout.beatLayouts.getOrNull(forcedOtherIndex)
            if (forcedRect != null) {
                lastOtherCursor = Offset(forcedRect.x, sectionCursorY)
            }
            previousIndex = currentIndex
            return@LaunchedEffect
        }
        if (currentIndex !in beats.indices) {
            otherAnim = null
            animatedOtherCursor = null
            previousIndex = currentIndex
            return@LaunchedEffect
        }

        val otherIndex = beats[currentIndex].otherIndex
        val otherRect = currentLayout.beatLayouts.getOrNull(otherIndex)
        if (previousIndex != currentIndex) {
            val path = currentLayout.connections.getOrNull(currentIndex)
            if (path != null) {
                val otherDuration = beats.getOrNull(otherIndex)?.duration ?: beats[currentIndex].duration
                val durationNanos = (otherDuration * OTHER_CURSOR_DURATION_FACTOR * 1_000_000_000.0)
                    .toLong()
                    .coerceAtLeast(1L)
                val startOverrideX = lastOtherCursor?.x
                otherAnim = OtherCursorAnimation(
                    path = path,
                    startNanos = System.nanoTime(),
                    durationNanos = durationNanos,
                    startOverrideX = startOverrideX
                )
                animatedOtherCursor = pointAtLength(path, 0f, startOverrideX)
                otherAnimEndedAtNanos = null
            } else {
                otherAnim = null
                animatedOtherCursor = null
                otherAnimEndedAtNanos = null
                if (otherRect != null) {
                    lastOtherCursor = Offset(otherRect.x, sectionCursorY)
                }
            }
        } else if (otherAnim == null && otherAnimEndedAtNanos == null && otherRect != null) {
            val staticCursor = Offset(otherRect.x, sectionCursorY)
            if (lastOtherCursor != staticCursor) {
                lastOtherCursor = staticCursor
            }
        }

        previousIndex = currentIndex
    }

    LaunchedEffect(otherAnim) {
        while (true) {
            val animation = otherAnim ?: return@LaunchedEffect
            val frameNanos = withFrameNanos { it }
            val elapsed = frameNanos - animation.startNanos
            if (elapsed >= animation.durationNanos) {
                val endCursor = Offset(animation.path.toX, animation.path.startY)
                animatedOtherCursor = null
                lastOtherCursor = endCursor
                otherAnim = null
                otherAnimEndedAtNanos = frameNanos
                delay(OTHER_CURSOR_HOLD_MS)
                if (otherAnim == null && otherAnimEndedAtNanos == frameNanos) {
                    otherAnimEndedAtNanos = null
                }
                return@LaunchedEffect
            }
            val distance = animation.path.totalLength * (elapsed.toFloat() / animation.durationNanos.toFloat())
            animatedOtherCursor = pointAtLength(animation.path, distance, animation.startOverrideX)
        }
    }

    Box(
        modifier = modifier
            .onSizeChanged { newSize -> canvasSize = newSize }
            .pointerInput(layout) {
                detectTapGestures { tap ->
                    val currentLayout = layout ?: return@detectTapGestures
                    val index = currentLayout.beatLayouts.indexOfFirst { rect ->
                        tap.x >= rect.x &&
                            tap.x <= rect.x + rect.width &&
                            tap.y >= rect.y &&
                            tap.y <= rect.y + rect.height
                    }
                    if (index >= 0) {
                        onSelectBeat(index)
                    }
                }
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val currentLayout = layout ?: return@Canvas
            if (beats.isEmpty()) return@Canvas

            val otherIndex = when {
                forcedOtherIndex != null -> forcedOtherIndex
                currentIndex in beats.indices -> beats[currentIndex].otherIndex
                else -> null
            }

            drawConnections(currentLayout, beats)
            drawBeatTiles(currentLayout, beats, tileColorOverrides)
            drawSections(currentLayout, sections)
            drawConnectionBaseline(currentLayout)
            drawOverlay(
                layout = currentLayout,
                beats = beats,
                currentIndex = currentIndex,
                otherIndex = otherIndex,
                secondaryOnly = forcedOtherIndex != null,
                animatedOtherCursor = if (forcedOtherIndex == null) animatedOtherCursor else null,
                lastOtherCursor = lastOtherCursor,
                holdOtherCursor = forcedOtherIndex == null && otherAnimEndedAtNanos != null
            )
        }
    }
}

private data class BeatRect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float
)

internal data class PathSample(
    val x: Float,
    val y: Float,
    val len: Float
)

internal data class ConnectionPath(
    val fromX: Float,
    val toX: Float,
    val cx: Float,
    val cy: Float,
    val startY: Float,
    val samples: List<PathSample>,
    val totalLength: Float
)

private data class OtherCursorAnimation(
    val path: ConnectionPath,
    val startNanos: Long,
    val durationNanos: Long,
    val startOverrideX: Float?
)

private data class VizLayout(
    val beatLayouts: List<BeatRect>,
    val connections: List<ConnectionPath?>,
    val width: Float,
    val fullHeight: Float,
    val tileHeight: Float,
    val connectionHeight: Float,
    val hPad: Float,
    val vPad: Float,
    val topPad: Float,
    val trackDuration: Double
)

private fun computeLayout(
    data: AutocanonizerData?,
    width: Float,
    height: Float
): VizLayout? {
    if (data == null || width <= 0f || height <= 0f || data.trackDuration <= 0.0 || data.beats.isEmpty()) {
        return null
    }

    val hPad = 20f
    val vPad = 20f
    val topPad = 0f
    val bottomPad = 64f
    val availableHeight = max(0f, height - bottomPad - topPad)
    val tileHeight = max(120f, availableHeight * 0.66f)
    val connectionHeight = max(80f, availableHeight - tileHeight - 10f)
    val spanWidth = max(1f, width - hPad * 2f)
    val baseY = topPad + tileHeight - vPad

    val layouts = data.beats.map { beat ->
        val beatWidth = (spanWidth * beat.duration / data.trackDuration).toFloat()
        val x = hPad + (spanWidth * beat.start / data.trackDuration).toFloat()
        val beatHeight = ((tileHeight - vPad) * beat.medianVolume.coerceAtLeast(0.0).pow(4.0) * 0.5).toFloat()
        val y = baseY - beatHeight
        BeatRect(
            x = x,
            y = y,
            width = max(1f, beatWidth),
            height = max(2f, beatHeight)
        )
    }

    val maxDelta = computeMaxDelta(data.beats)
    val startY = topPad + tileHeight - 10f
    val connections = data.beats.mapIndexed { index, beat ->
        val next = data.beats.getOrNull(index + 1) ?: return@mapIndexed null
        val delta = next.otherIndex - beat.otherIndex
        if (index == 0 || delta == 1) {
            return@mapIndexed null
        }
        val fromBeat = data.beats.getOrNull(beat.otherIndex) ?: return@mapIndexed null
        val toBeat = data.beats.getOrNull(next.otherIndex) ?: return@mapIndexed null
        val fromX = hPad + (spanWidth * fromBeat.start / data.trackDuration).toFloat()
        val toX = hPad + (spanWidth * toBeat.start / data.trackDuration).toFloat()
        val cx = (toX - fromX) / 2f + fromX
        val cy = computeConnectionCurveY(delta, maxDelta, connectionHeight, topPad, tileHeight)
        val samples = sampleQuadraticPath(
            x0 = fromX,
            y0 = startY,
            cx = cx,
            cy = cy,
            x1 = toX,
            y1 = startY,
            steps = PATH_SAMPLE_STEPS
        )
        ConnectionPath(
            fromX = fromX,
            toX = toX,
            cx = cx,
            cy = cy,
            startY = startY,
            samples = samples,
            totalLength = samples.lastOrNull()?.len ?: 0f
        )
    }

    return VizLayout(
        beatLayouts = layouts,
        connections = connections,
        width = width,
        fullHeight = height,
        tileHeight = tileHeight,
        connectionHeight = connectionHeight,
        hPad = hPad,
        vPad = vPad,
        topPad = topPad,
        trackDuration = data.trackDuration
    )
}

private fun computeMaxDelta(beats: List<AutocanonizerBeat>): Int {
    var maxDelta = 1
    for (i in 0 until beats.lastIndex) {
        val current = beats[i]
        val next = beats[i + 1]
        val delta = abs(next.otherIndex - current.otherIndex)
        if (delta > maxDelta) {
            maxDelta = delta
        }
    }
    return maxDelta
}

internal fun computeConnectionCurveY(
    delta: Int,
    maxDelta: Int,
    connectionHeight: Float,
    topPad: Float,
    tileHeight: Float
): Float {
    val safeMaxDelta = max(1, maxDelta)
    var depth = (abs(delta).toFloat() / safeMaxDelta.toFloat()) * connectionHeight * CURVE_DEPTH_MULTIPLIER
    if (depth < MIN_CURVE_TRIGGER) {
        depth = MIN_CURVE_DEPTH
    }
    return topPad + tileHeight + depth
}

internal fun sampleQuadraticPath(
    x0: Float,
    y0: Float,
    cx: Float,
    cy: Float,
    x1: Float,
    y1: Float,
    steps: Int
): List<PathSample> {
    val safeSteps = max(1, steps)
    val samples = ArrayList<PathSample>(safeSteps + 1)
    var prevX = x0
    var prevY = y0
    var total = 0f
    samples.add(PathSample(x0, y0, 0f))
    for (step in 1..safeSteps) {
        val t = step.toFloat() / safeSteps.toFloat()
        val x = quadraticPoint(x0, cx, x1, t)
        val y = quadraticPoint(y0, cy, y1, t)
        total += kotlin.math.hypot(x - prevX, y - prevY)
        samples.add(PathSample(x, y, total))
        prevX = x
        prevY = y
    }
    return samples
}

private fun quadraticPoint(p0: Float, p1: Float, p2: Float, t: Float): Float {
    val mt = 1f - t
    return mt * mt * p0 + 2f * mt * t * p1 + t * t * p2
}

internal fun pointAtLength(
    path: ConnectionPath,
    length: Float,
    fromXOverride: Float? = null
): Offset {
    if (path.samples.isEmpty()) {
        return Offset(fromXOverride ?: path.fromX, path.startY)
    }
    val clamped = min(max(0f, length), path.totalLength)
    var idx = 0
    while (idx < path.samples.size && path.samples[idx].len < clamped) {
        idx += 1
    }
    if (idx == 0) {
        val first = path.samples.first()
        return Offset(fromXOverride ?: first.x, first.y)
    }
    val prev = path.samples[idx - 1]
    val current = path.samples[min(idx, path.samples.lastIndex)]
    val span = current.len - prev.len
    val t = if (span == 0f) 0f else (clamped - prev.len) / span
    val x = prev.x + (current.x - prev.x) * t
    val y = prev.y + (current.y - prev.y) * t
    return if (fromXOverride != null && clamped == 0f) {
        Offset(fromXOverride, y)
    } else {
        Offset(x, y)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawConnections(
    layout: VizLayout,
    beats: List<AutocanonizerBeat>
) {
    val baseY = layout.topPad + layout.tileHeight - 4f
    for (i in 0 until beats.lastIndex) {
        val pathDef = layout.connections.getOrNull(i) ?: continue
        val beat = beats[i]
        val otherBeat = beats.getOrNull(beat.otherIndex) ?: continue
        val path = Path().apply {
            moveTo(pathDef.fromX, baseY)
            quadraticBezierTo(pathDef.cx, pathDef.cy, pathDef.toX, baseY)
        }
        drawPath(
            path = path,
            color = parseColor(otherBeat.colorHex).copy(alpha = 0.6f),
            style = Stroke(width = 3f)
        )
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawBeatTiles(
    layout: VizLayout,
    beats: List<AutocanonizerBeat>,
    tileColorOverrides: Map<Int, String>
) {
    for (i in beats.indices) {
        val rect = layout.beatLayouts.getOrNull(i) ?: continue
        val nextRect = layout.beatLayouts.getOrNull(i + 1)
        val topRightX = if (nextRect != null) max(nextRect.x, rect.x + rect.width) else rect.x + rect.width
        val nextTop = if (nextRect != null) minOf(nextRect.y, rect.y + rect.height) else rect.y

        val overrideColor = tileColorOverrides[i]
        val color = when (overrideColor) {
            AutocanonizerController.PRIMARY_TILE_COLOR_HEX -> Color(0xFF4F8FFF)
            AutocanonizerController.OTHER_TILE_COLOR_HEX -> Color(0xFF10DF00)
            null -> parseColor(beats[i].colorHex)
            else -> parseColor(overrideColor)
        }
        val path = Path().apply {
            moveTo(rect.x, rect.y)
            lineTo(topRightX, nextTop)
            lineTo(topRightX, rect.y + rect.height)
            lineTo(rect.x, rect.y + rect.height)
            close()
        }
        drawPath(path = path, color = color, style = Fill)
        drawPath(path = path, color = color, style = Stroke(width = 1f))
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSections(
    layout: VizLayout,
    sections: List<com.foreverjukebox.app.autocanonizer.AutocanonizerSection>
) {
    if (sections.isEmpty()) {
        return
    }
    val spanWidth = max(1f, layout.width - layout.hPad * 2f)
    val sectionY = layout.topPad + layout.tileHeight - 20f
    sections.forEachIndexed { index, section ->
        val sectionX = layout.hPad + (spanWidth * section.start / layout.trackDuration).toFloat()
        val sectionWidth = (spanWidth * section.duration / layout.trackDuration).toFloat()
        drawRect(
            color = sectionColor(index),
            topLeft = Offset(sectionX, sectionY),
            size = Size(sectionWidth, 16f)
        )
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawConnectionBaseline(layout: VizLayout) {
    if (layout.connectionHeight <= 0f) {
        return
    }
    drawLine(
        color = Color.White.copy(alpha = 0.08f),
        start = Offset(layout.hPad, layout.topPad + layout.tileHeight + 4f),
        end = Offset(layout.width - layout.hPad, layout.topPad + layout.tileHeight + 4f),
        strokeWidth = 1f
    )
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawOverlay(
    layout: VizLayout,
    beats: List<AutocanonizerBeat>,
    currentIndex: Int,
    otherIndex: Int?,
    secondaryOnly: Boolean,
    animatedOtherCursor: Offset?,
    lastOtherCursor: Offset?,
    holdOtherCursor: Boolean
) {
    if (currentIndex !in beats.indices) {
        return
    }

    val currentRect = layout.beatLayouts.getOrNull(currentIndex) ?: return
    val otherRect = otherIndex?.let { layout.beatLayouts.getOrNull(it) }
    val sectionY = layout.topPad + layout.tileHeight - 20f

    drawRect(
        color = Color(0xFF4F8FFF).copy(alpha = 0.65f),
        topLeft = Offset(currentRect.x, currentRect.y),
        size = Size(currentRect.width, currentRect.height)
    )
    if (otherRect != null) {
        drawRect(
            color = Color(0xFF10DF00).copy(alpha = 0.5f),
            topLeft = Offset(otherRect.x, otherRect.y),
            size = Size(otherRect.width, otherRect.height)
        )
    }

    drawRect(
        color = Color(0xFF4F8FFF),
        topLeft = Offset(currentRect.x - 4f, sectionY),
        size = Size(8f, 8f)
    )

    val fallbackOtherCursor = otherRect?.let { Offset(it.x, sectionY + 8f) }
    val otherCursor = when {
        secondaryOnly -> fallbackOtherCursor ?: lastOtherCursor
        animatedOtherCursor != null -> animatedOtherCursor
        holdOtherCursor && lastOtherCursor != null -> Offset(lastOtherCursor.x, lastOtherCursor.y - 2f)
        fallbackOtherCursor != null -> fallbackOtherCursor
        else -> lastOtherCursor
    }
    if (otherCursor != null) {
        drawRect(
            color = Color(0xFF10DF00),
            topLeft = Offset(otherCursor.x - 4f, otherCursor.y),
            size = Size(8f, 8f)
        )
    }
}

private fun sectionColor(index: Int): Color {
    val hue = (index * 47f) % 360f
    return Color.hsv(hue, 0.8f, 0.55f, alpha = 0.75f)
}

private fun parseColor(hex: String): Color {
    return runCatching {
        Color(hex.toColorInt())
    }.getOrElse {
        Color(0xFF333333)
    }
}

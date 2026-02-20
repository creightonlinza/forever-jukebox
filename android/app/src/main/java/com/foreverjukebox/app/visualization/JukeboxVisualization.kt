package com.foreverjukebox.app.visualization

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import com.foreverjukebox.app.engine.Edge
import com.foreverjukebox.app.engine.VisualizationData
import com.foreverjukebox.app.ui.LocalThemeTokens
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

private const val EDGE_SAMPLE_LIMIT = 300
private const val EDGE_AVOID_RADIUS = 6f
private const val BEAT_SELECT_THRESHOLD = 16f

class JumpLine(val from: Int, val to: Int, val startedAt: Long)

@Composable
fun JukeboxVisualization(
    data: VisualizationData?,
    currentIndex: Int,
    jumpLine: JumpLine?,
    positioner: Positioner,
    onSelectBeat: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var layoutSize by remember { mutableStateOf(IntSize.Zero) }
    var nowState by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }

    LaunchedEffect(jumpLine) {
        if (jumpLine == null) return@LaunchedEffect
        while (SystemClock.elapsedRealtime() - jumpLine.startedAt < 1100) {
            nowState = SystemClock.elapsedRealtime()
            kotlinx.coroutines.delay(16)
        }
    }

    val positions = remember(data?.beats?.size, layoutSize, positioner) {
        if (data == null || layoutSize.width == 0 || layoutSize.height == 0) {
            emptyList()
        } else {
            positioner(data, layoutSize.width.toFloat(), layoutSize.height.toFloat())
        }
    }

    val center = Offset(layoutSize.width / 2f, layoutSize.height / 2f)
    val themeTokens = LocalThemeTokens.current
    val beatFill = themeTokens.beatFill
    val beatHighlight = themeTokens.beatHighlight
    val edgeStroke = themeTokens.edgeStroke

    Box(
        modifier = modifier
            .fillMaxSize()
            .onSizeChanged { layoutSize = it }
            .pointerInput(data, positions) {
                detectTapGestures { tap ->
                    if (data == null || positions.isEmpty()) return@detectTapGestures
                    val beatIndex = findNearestBeat(tap, positions)
                    if (beatIndex != null) {
                        onSelectBeat(beatIndex)
                        return@detectTapGestures
                    }
                    // Branch selection disabled.
                }
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            if (data == null || positions.isEmpty()) return@Canvas

            val edges = data.edges
            val maxEdges = 2500
            val step = if (edges.size > maxEdges) {
                kotlin.math.ceil(edges.size / maxEdges.toDouble()).toInt()
            } else {
                1
            }

            for (i in edges.indices step step) {
                val edge = edges[i]
                if (edge.deleted) continue
                drawEdge(edge, positions, center, edgeStroke, 1.0f)
            }

            for (p in positions) {
                drawCircle(beatFill, radius = 2f, center = Offset(p.x, p.y))
            }

            if (currentIndex >= 0 && currentIndex < positions.size) {
                val p = positions[currentIndex]
                drawCircle(beatHighlight, radius = 10f, center = Offset(p.x, p.y))
            }

            if (jumpLine != null) {
                val age = (nowState - jumpLine.startedAt).coerceAtLeast(0L)
                if (age < 1000) {
                    val from = positions.getOrNull(jumpLine.from)
                    val to = positions.getOrNull(jumpLine.to)
                    if (from != null && to != null) {
                        val alpha = (1f - age / 1000f).coerceIn(0f, 1f)
                        val color = beatHighlight.copy(alpha = alpha)
                        drawJumpLine(from, to, positions, center, color)
                    }
                }
            }
        }
    }
}

private fun findNearestBeat(tap: Offset, positions: List<VizPoint>): Int? {
    var bestIndex = -1
    var bestDist = Float.MAX_VALUE
    for (i in positions.indices) {
        val p = positions[i]
        val dist = hypot(p.x - tap.x, p.y - tap.y)
        if (dist < bestDist) {
            bestDist = dist
            bestIndex = i
        }
    }
    return if (bestIndex >= 0 && bestDist <= BEAT_SELECT_THRESHOLD) bestIndex else null
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawEdge(
    edge: Edge,
    positions: List<VizPoint>,
    center: Offset,
    color: Color,
    strokeWidth: Float
) {
    val from = positions.getOrNull(edge.src.which) ?: return
    val to = positions.getOrNull(edge.dest.which) ?: return
    if (shouldBendEdge(from, to, positions)) {
        val (cx, cy) = bendControlPoint(from, to, center)
        val path = Path().apply {
            moveTo(from.x, from.y)
            quadraticBezierTo(cx, cy, to.x, to.y)
        }
        drawPath(path, color = color, style = Stroke(width = strokeWidth))
    } else {
        drawLine(color, Offset(from.x, from.y), Offset(to.x, to.y), strokeWidth = strokeWidth)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawJumpLine(
    from: VizPoint,
    to: VizPoint,
    positions: List<VizPoint>,
    center: Offset,
    color: Color
) {
    if (shouldBendEdge(from, to, positions)) {
        val (cx, cy) = bendControlPoint(from, to, center)
        val path = Path().apply {
            moveTo(from.x, from.y)
            quadraticBezierTo(cx, cy, to.x, to.y)
        }
        drawPath(path, color = color, style = Stroke(width = 2f))
    } else {
        drawLine(color, Offset(from.x, from.y), Offset(to.x, to.y), strokeWidth = 2f)
    }
}

private fun shouldBendEdge(
    from: VizPoint,
    to: VizPoint,
    positions: List<VizPoint>
): Boolean {
    if (positions.isEmpty()) return false
    val step = max(1, kotlin.math.ceil(positions.size / EDGE_SAMPLE_LIMIT.toDouble()).toInt())
    for (i in positions.indices step step) {
        val p = positions[i]
        if ((p.x == from.x && p.y == from.y) || (p.x == to.x && p.y == to.y)) {
            continue
        }
        val dist = distanceToSegment(p.x, p.y, from.x, from.y, to.x, to.y)
        if (dist <= EDGE_AVOID_RADIUS) return true
    }
    return false
}

private fun bendControlPoint(from: VizPoint, to: VizPoint, center: Offset): Pair<Float, Float> {
    val midX = (from.x + to.x) / 2f
    val midY = (from.y + to.y) / 2f
    val dirX = center.x - midX
    val dirY = center.y - midY
    val dirLen = hypot(dirX, dirY)
    if (dirLen == 0f) return midX to midY
    val normX = dirX / dirLen
    val normY = dirY / dirLen
    val centerDist = hypot(center.x - midX, center.y - midY)
    return (midX + normX * (centerDist * 0.5f)) to (midY + normY * (centerDist * 0.5f))
}

private fun distanceToSegment(px: Float, py: Float, x1: Float, y1: Float, x2: Float, y2: Float): Float {
    val dx = x2 - x1
    val dy = y2 - y1
    if (dx == 0f && dy == 0f) {
        return hypot(px - x1, py - y1)
    }
    val t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    val clamped = max(0f, min(1f, t))
    val cx = x1 + clamped * dx
    val cy = y1 + clamped * dy
    return hypot(px - cx, py - cy)
}

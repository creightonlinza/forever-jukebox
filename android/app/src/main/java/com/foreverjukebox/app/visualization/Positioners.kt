package com.foreverjukebox.app.visualization

import com.foreverjukebox.app.engine.QuantumBase
import com.foreverjukebox.app.engine.VisualizationData
import java.util.IdentityHashMap
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class VizPoint(val x: Float, val y: Float)

typealias Positioner = (data: VisualizationData, width: Float, height: Float) -> List<VizPoint>

enum class EdgeRouting {
    Auto,
    ArcDiagram
}

data class VisualizationLayout(
    val label: String,
    val positioner: Positioner,
    val edgeRouting: EdgeRouting = EdgeRouting.Auto,
    val preferWideAspect: Boolean = false
)

private fun createArcDiagramPositioner(): Positioner = { data, width, height ->
    val count = data.beats.size
    val paddingX = 36f
    val timelineY = height * 0.5f
    val span = maxOf(0f, width - paddingX * 2f)
    when {
        count <= 0 -> emptyList()
        count == 1 -> listOf(VizPoint(x = width / 2f, y = timelineY))
        else -> (0 until count).map { i ->
            val t = i.toFloat() / (count - 1).toFloat()
            VizPoint(
                x = paddingX + span * t,
                y = timelineY
            )
        }
    }
}

private fun createClassicPositioner(): Positioner = { data, width, height ->
    val count = data.beats.size
    val radius = min(width, height) * 0.4f
    val cx = width / 2f
    val cy = height / 2f
    (0 until count).map { i ->
        val angle = (i.toDouble() / count) * Math.PI * 2 - Math.PI / 2
        VizPoint(
            x = (cx + cos(angle) * radius).toFloat(),
            y = (cy + sin(angle) * radius).toFloat()
        )
    }
}

private fun createGridPositioner(): Positioner = { data, width, height ->
    val beats = data.beats
    val count = beats.size
    var beatsPerBar = 4
    if (count > 0) {
        val counts = mutableMapOf<Int, Int>()
        var totalParents = 0
        val seenParents = IdentityHashMap<QuantumBase, Boolean>()
        for (beat in beats) {
            val parent = beat.parent ?: continue
            if (seenParents.put(parent, true) != null) {
                continue
            }
            val length = maxOf(1, parent.children.size)
            counts[length] = (counts[length] ?: 0) + 1
            totalParents += 1
        }
        if (counts.isNotEmpty()) {
            var best = beatsPerBar
            var bestCount = -1
            for ((size, tally) in counts) {
                if (tally > bestCount) {
                    bestCount = tally
                    best = size
                }
            }
            beatsPerBar = best
        }
        if (totalParents == 0) {
            beatsPerBar = 4
        }
    }
    data class BarEntry(val bar: QuantumBase?, val section: QuantumBase?)
    val bars = mutableListOf<BarEntry>()
    val barIndex = IdentityHashMap<QuantumBase, Int>()
    for (beat in beats) {
        val parent = beat.parent ?: continue
        if (barIndex.containsKey(parent)) {
            continue
        }
        barIndex[parent] = bars.size
        bars.add(BarEntry(parent, parent.parent))
    }
    if (bars.isEmpty()) {
        val totalBars = maxOf(1, ceil(count.toDouble() / maxOf(1, beatsPerBar)).toInt())
        repeat(totalBars) {
            bars.add(BarEntry(null, null))
        }
    }
    val totalBars = maxOf(1, bars.size)
    val targetBarsPerRow = maxOf(1, ceil(sqrt(totalBars.toDouble())).toInt())
    val rowBars = mutableListOf<Int>()
    if (bars.any { it.section != null }) {
        var currentSection: QuantumBase? = bars.firstOrNull()?.section
        var sectionBars = 0
        fun pushSectionRows() {
            var remaining = sectionBars
            while (remaining > 0) {
                val chunk = min(remaining, targetBarsPerRow)
                rowBars.add(chunk)
                remaining -= chunk
            }
        }
        for (entry in bars) {
            if (entry.section !== currentSection) {
                pushSectionRows()
                currentSection = entry.section
                sectionBars = 0
            }
            sectionBars += 1
        }
        pushSectionRows()
    } else {
        var remaining = totalBars
        while (remaining > 0) {
            val chunk = min(remaining, targetBarsPerRow)
            rowBars.add(chunk)
            remaining -= chunk
        }
    }
    val rows = maxOf(1, rowBars.size)
    val paddingX = 40f
    val paddingTop = 64f
    val paddingBottom = 80f
    val gridW = width - paddingX * 2
    val gridH = height - paddingTop - paddingBottom
    fun safeRatio(index: Int, max: Int): Float {
        return if (max <= 1) 0.5f else index / (max - 1).toFloat()
    }
    val rowStartBar = mutableListOf<Int>()
    var running = 0
    for (barsInRow in rowBars) {
        rowStartBar.add(running)
        running += barsInRow
    }
    (0 until count).map { i ->
        val beat = beats[i]
        val bar = beat.parent
        val barIdx = if (bar != null) {
            barIndex[bar] ?: 0
        } else {
            i / maxOf(1, beatsPerBar)
        }
        var rowIndex = 0
        for (r in rowBars.indices) {
            val start = rowStartBar.getOrElse(r) { 0 }
            val end = start + rowBars[r]
            if (barIdx in start until end) {
                rowIndex = r
                break
            }
        }
        val barsInRow = rowBars.getOrElse(rowIndex) { 1 }
        val rowBarOffset = (barIdx - rowStartBar.getOrElse(rowIndex) { 0 }).coerceAtLeast(0)
        var beatInBar = beat.indexInParent ?: -1
        if (beatInBar < 0 && bar != null) {
            beatInBar = bar.children.indexOf(beat)
        }
        if (beatInBar < 0) {
            beatInBar = i % maxOf(1, beatsPerBar)
        }
        val cols = maxOf(1, beatsPerBar * barsInRow)
        val col = min(cols - 1, rowBarOffset * beatsPerBar + beatInBar)
        val x = paddingX + safeRatio(col, cols) * gridW
        val y = paddingTop + safeRatio(rowIndex, rows) * gridH
        VizPoint(x = x, y = y)
    }
}

private fun createWavePositioner(): Positioner = { data, width, height ->
    val count = data.beats.size
    val padding = 40f
    val amp = height * 0.25f
    val center = height / 2f
    val span = width - padding * 2
    val waveTurns = 3
    (0 until count).map { i ->
        val t = i.toFloat() / maxOf(1, count - 1)
        VizPoint(
            x = padding + span * t,
            y = center + (sin(t * Math.PI * 2 * waveTurns) * amp).toFloat()
        )
    }
}

private fun createInfinitePositioner(): Positioner = { data, width, height ->
    val count = data.beats.size
    val cx = width / 2f
    val cy = height / 2f
    val ampX = width * 0.35f
    val ampY = height * 0.25f
    (0 until count).map { i ->
        val t = (i.toDouble() / count) * Math.PI * 2
        VizPoint(
            x = (cx + sin(t) * ampX).toFloat(),
            y = (cy + sin(t * 2) * ampY).toFloat()
        )
    }
}

private fun createGalaxyPositioner(): Positioner = { data, width, height ->
    val count = data.beats.size
    val cx = width / 2f
    val cy = height / 2f
    val maxRadius = min(width, height) * 0.42f
    val minRadius = min(width, height) * 0.08f
    val goldenAngle = Math.PI * (3 - sqrt(5.0))
    (0 until count).map { i ->
        val t = i.toDouble() / maxOf(1, count - 1)
        val angle = i * goldenAngle
        val radius = minRadius + (maxRadius - minRadius) * sqrt(t).toFloat()
        val wobble = 0.06 * sin(i * 12.9898) + 0.04 * cos(i * 4.1414)
        val r = radius * (1 + wobble).toFloat()
        VizPoint(
            x = (cx + cos(angle) * r).toFloat(),
            y = (cy + sin(angle) * r).toFloat()
        )
    }
}

val visualizationLayouts: List<VisualizationLayout> = listOf(
    VisualizationLayout(
        label = "Arc",
        positioner = createArcDiagramPositioner(),
        edgeRouting = EdgeRouting.ArcDiagram,
        preferWideAspect = true
    ),
    VisualizationLayout(label = "Classic", positioner = createClassicPositioner()),
    VisualizationLayout(label = "Galaxy", positioner = createGalaxyPositioner()),
    VisualizationLayout(
        label = "Grid",
        positioner = createGridPositioner(),
        preferWideAspect = true
    ),
    VisualizationLayout(
        label = "Infinite",
        positioner = createInfinitePositioner(),
        preferWideAspect = true
    ),
    VisualizationLayout(
        label = "Wave",
        positioner = createWavePositioner(),
        preferWideAspect = true
    )
)

val positioners: List<Positioner> = visualizationLayouts.map { it.positioner }
val visualizationLabels: List<String> = visualizationLayouts.map { it.label }
val visualizationCount: Int = visualizationLayouts.size
val defaultVisualizationIndex: Int =
    visualizationLabels.indexOf("Classic").takeIf { it >= 0 } ?: 0

fun edgeRoutingForVisualization(index: Int): EdgeRouting {
    return visualizationLayouts.getOrNull(index)?.edgeRouting ?: EdgeRouting.Auto
}

fun prefersWideAspectForVisualization(index: Int): Boolean {
    return visualizationLayouts.getOrNull(index)?.preferWideAspect ?: false
}

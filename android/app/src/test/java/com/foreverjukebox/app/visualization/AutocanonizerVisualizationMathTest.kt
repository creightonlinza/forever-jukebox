package com.foreverjukebox.app.visualization

import org.junit.Assert.assertEquals
import org.junit.Test

class AutocanonizerVisualizationMathTest {
    @Test
    fun computeConnectionCurveYMatchesWebCurveDepth() {
        val y = computeConnectionCurveY(
            delta = 10,
            maxDelta = 10,
            connectionHeight = 100f,
            topPad = 0f,
            tileHeight = 200f
        )

        assertEquals(320f, y, 0.001f)
    }

    @Test
    fun computeConnectionCurveYAppliesMinimumDepth() {
        val y = computeConnectionCurveY(
            delta = 1,
            maxDelta = 10,
            connectionHeight = 100f,
            topPad = 0f,
            tileHeight = 200f
        )

        assertEquals(230f, y, 0.001f)
    }

    @Test
    fun pointAtLengthUsesOverrideAtStartAndClampsAtEnd() {
        val samples = sampleQuadraticPath(
            x0 = 0f,
            y0 = 40f,
            cx = 50f,
            cy = 120f,
            x1 = 100f,
            y1 = 40f,
            steps = 10
        )
        val path = ConnectionPath(
            fromX = 0f,
            toX = 100f,
            cx = 50f,
            cy = 120f,
            startY = 40f,
            samples = samples,
            totalLength = samples.last().len
        )

        val start = pointAtLength(path, 0f, fromXOverride = 25f)
        val end = pointAtLength(path, path.totalLength + 100f)

        assertEquals(25f, start.x, 0.001f)
        assertEquals(40f, start.y, 0.001f)
        assertEquals(100f, end.x, 0.001f)
        assertEquals(40f, end.y, 0.001f)
    }
}

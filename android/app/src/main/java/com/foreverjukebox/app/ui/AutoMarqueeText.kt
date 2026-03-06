package com.foreverjukebox.app.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import kotlinx.coroutines.delay

@Composable
fun AutoMarqueeText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    holdMillis: Int = 2000
) {
    val scrollState = rememberScrollState()
    val safeHoldMillis = holdMillis.coerceAtLeast(0).toLong()

    LaunchedEffect(text, safeHoldMillis) {
        scrollState.scrollTo(0)
        while (true) {
            val maxScroll = scrollState.maxValue
            if (maxScroll <= 0) {
                delay(600)
                continue
            }
            val durationMs = (maxScroll * 12).coerceIn(1200, 7000)
            delay(safeHoldMillis)
            scrollState.animateScrollTo(
                value = maxScroll,
                animationSpec = tween(durationMillis = durationMs, easing = LinearEasing)
            )
            delay(safeHoldMillis)
            scrollState.animateScrollTo(
                value = 0,
                animationSpec = tween(durationMillis = durationMs, easing = LinearEasing)
            )
        }
    }

    Text(
        text = text,
        style = style,
        color = color,
        maxLines = 1,
        softWrap = false,
        modifier = modifier.horizontalScroll(scrollState, enabled = false)
    )
}

package com.foreverjukebox.app.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp

@Composable
fun TabBar(state: UiState, onTabSelected: (TabId) -> Unit) {
    val shouldPulseListen = state.playback.isRunning && state.activeTab != TabId.Play
    val tabs = tabsForMode(state.appMode)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        tabs.forEach { tabId ->
            TabButton(
                text = tabLabel(tabId),
                active = state.activeTab == tabId,
                pulse = tabId == TabId.Play && shouldPulseListen,
                onClick = { onTabSelected(tabId) }
            )
        }
    }
}

private fun tabLabel(tabId: TabId): String {
    return when (tabId) {
        TabId.Input -> "Input"
        TabId.Top -> "Top Songs"
        TabId.Search -> "Search"
        TabId.Play -> "Listen"
        TabId.Faq -> "FAQ"
    }
}

@Composable
private fun TabButton(
    text: String,
    active: Boolean,
    enabled: Boolean = true,
    pulse: Boolean = false,
    onClick: () -> Unit
) {
    val tokens = LocalThemeTokens.current
    val pulseAmount = if (pulse) {
        val transition = rememberInfiniteTransition(label = "listenPulse")
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 2400),
                repeatMode = RepeatMode.Reverse
            ),
            label = "listenPulseAmount"
        ).value
    } else {
        0f
    }
    val baseColor = if (active) tokens.controlSurface else tokens.panelSurface
    val targetColor = tokens.onBackground.copy(alpha = 0.12f)
    val containerColor = if (pulse) lerp(baseColor, targetColor, pulseAmount) else baseColor
    val colors = if (pulse) {
        ButtonDefaults.outlinedButtonColors(
            containerColor = containerColor,
            contentColor = tokens.onBackground,
            disabledContainerColor = containerColor.copy(alpha = 0.4f),
            disabledContentColor = tokens.onBackground.copy(alpha = 0.4f)
        )
    } else {
        pillOutlinedButtonColors(active)
    }
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        colors = colors,
        border = pillButtonBorder(),
        contentPadding = SmallButtonPadding,
        shape = PillShape,
        modifier = Modifier.height(SmallButtonHeight)
    ) {
        Text(text)
        Spacer(modifier = Modifier.width(2.dp))
    }
}

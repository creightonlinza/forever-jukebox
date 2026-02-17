package com.foreverjukebox.app.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.foreverjukebox.app.data.AppMode

@Composable
fun AppModeSliderToggle(
    selectedMode: AppMode,
    onModeChange: (AppMode) -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalThemeTokens.current
    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .clip(PillShape)
            .background(tokens.panelSurface)
            .border(pillButtonBorder(), PillShape)
            .padding(2.dp)
    ) {
        val segmentWidth = maxWidth / 2
        val indicatorTarget = if (selectedMode == AppMode.Server) segmentWidth else 0.dp
        val indicatorOffset = animateDpAsState(targetValue = indicatorTarget, label = "appModeThumb")
        Box(
            modifier = Modifier
                .offset(x = indicatorOffset.value)
                .width(segmentWidth)
                .fillMaxHeight()
                .clip(PillShape)
                .background(tokens.controlSurface)
        )
        Row(
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            AppModeSegment(
                label = "Local",
                selected = selectedMode == AppMode.Local,
                onClick = { onModeChange(AppMode.Local) },
                modifier = Modifier.weight(1f)
            )
            AppModeSegment(
                label = "Server",
                selected = selectedMode == AppMode.Server,
                onClick = { onModeChange(AppMode.Server) },
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun AppModeSegment(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val selectedColor = LocalThemeTokens.current.onBackground
    val unselectedColor = selectedColor.copy(alpha = 0.75f)
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) selectedColor else unselectedColor
        )
    }
}

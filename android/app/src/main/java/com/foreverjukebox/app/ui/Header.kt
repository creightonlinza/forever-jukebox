package com.foreverjukebox.app.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.widget.Toast
import com.foreverjukebox.app.BuildConfig
import com.foreverjukebox.app.data.ThemeMode
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun HeaderBar(
    state: UiState,
    onEditBaseUrl: (String) -> Unit,
    onThemeChange: (ThemeMode) -> Unit,
    onRefreshCacheSize: () -> Unit,
    onClearCache: () -> Unit,
    onTabSelected: (TabId) -> Unit,
    onCastSessionStarted: () -> Unit
) {
    val context = LocalContext.current
    var showSettings by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(12.dp)
    ) {
        val transition = rememberInfiniteTransition(label = "neonFlicker")
        val flicker = transition.animateFloat(
            initialValue = 1f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = keyframes {
                    durationMillis = 6000
                    1f at 0
                    0.95f at 120
                    0.75f at 180
                    1f at 240
                    0.85f at 360
                    1f at 420
                    0.92f at 720
                    1f at 780
                    0.88f at 1680
                    1f at 1740
                    0.7f at 2640
                    1f at 2760
                    0.9f at 3480
                    1f at 3540
                    0.8f at 4560
                    1f at 4620
                    0.86f at 5340
                    1f at 5400
                    1f at 6000
                },
                repeatMode = RepeatMode.Restart
            ),
            label = "flicker"
        ).value
        val glow = 0.45f + (0.55f * flicker)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "THE FOREVER JUKEBOX",
                style = MaterialTheme.typography.titleLarge.copy(
                    fontFamily = neonFontFamily,
                    letterSpacing = 2.sp,
                    shadow = Shadow(
                        color = MaterialTheme.colorScheme.secondary.copy(alpha = glow),
                        offset = Offset(0f, 0f),
                        blurRadius = 18f * glow
                    )
                ),
                color = MaterialTheme.colorScheme.secondary.copy(alpha = 0.9f * flicker),
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.weight(1f))
            CastRouteButton(
                modifier = Modifier.size(SmallButtonHeight),
                enabled = state.castEnabled,
                onSessionStarted = onCastSessionStarted,
                onDisabledClick = {
                    Toast.makeText(
                        context,
                        "Casting is not available for this API base URL.",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            )
            Spacer(modifier = Modifier.width(6.dp))
            IconButton(
                onClick = {
                    onRefreshCacheSize()
                    showSettings = true
                },
                modifier = Modifier.size(SmallButtonHeight)
            ) {
                Icon(
                    Icons.Default.MoreVert,
                    contentDescription = "Settings",
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }
        }
        Spacer(modifier = Modifier.height(10.dp))
        TabBar(
            state = state,
            onTabSelected = onTabSelected
        )
    }

    if (showSettings) {
        SettingsDialog(
            state = state,
            onDismiss = { showSettings = false },
            onThemeChange = onThemeChange,
            onEditBaseUrl = onEditBaseUrl,
            onClearCache = onClearCache
        )
    }
}

@Composable
private fun SettingsDialog(
    state: UiState,
    onDismiss: () -> Unit,
    onThemeChange: (ThemeMode) -> Unit,
    onEditBaseUrl: (String) -> Unit,
    onClearCache: () -> Unit
) {
    var urlInput by remember(state.baseUrl) { mutableStateOf(state.baseUrl) }
    val cacheLabel = formatCacheSize(state.cacheSizeBytes)
    val cacheEnabled = state.cacheSizeBytes > 0
    val versionLabel = "v${BuildConfig.VERSION_NAME}"
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Row(
                modifier = Modifier,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = {
                        onEditBaseUrl(urlInput)
                        onDismiss()
                    },
                    colors = pillButtonColors(),
                    border = pillButtonBorder(),
                    shape = PillShape,
                    contentPadding = SmallButtonPadding,
                    modifier = Modifier.height(SmallButtonHeight)
                ) {
                    Text("Save", style = MaterialTheme.typography.labelSmall)
                }
            }
        },
        title = {
            Column(modifier = Modifier) {
                Text("Settings")
                Text(
                    versionLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    maxLines = 1
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("API Base URL")
                OutlinedTextField(
                    value = urlInput,
                    onValueChange = { urlInput = it },
                    label = { Text("Example: http://192.168.1.100") },
                    textStyle = MaterialTheme.typography.bodySmall,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Done
                    ),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.heightIn(min = SmallFieldMinHeight)
                )
                Text("Theme")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { onThemeChange(ThemeMode.System) },
                        colors = pillOutlinedButtonColors(),
                        border = pillButtonBorder(),
                        shape = PillShape,
                        contentPadding = SmallButtonPadding,
                        modifier = Modifier.height(SmallButtonHeight)
                    ) {
                        Text("System", style = MaterialTheme.typography.labelSmall)
                    }
                    OutlinedButton(
                        onClick = { onThemeChange(ThemeMode.Light) },
                        colors = pillOutlinedButtonColors(),
                        border = pillButtonBorder(),
                        shape = PillShape,
                        contentPadding = SmallButtonPadding,
                        modifier = Modifier.height(SmallButtonHeight)
                    ) {
                        Text("Light", style = MaterialTheme.typography.labelSmall)
                    }
                    OutlinedButton(
                        onClick = { onThemeChange(ThemeMode.Dark) },
                        colors = pillOutlinedButtonColors(),
                        border = pillButtonBorder(),
                        shape = PillShape,
                        contentPadding = SmallButtonPadding,
                        modifier = Modifier.height(SmallButtonHeight)
                    ) {
                        Text("Dark", style = MaterialTheme.typography.labelSmall)
                    }
                }
                Text("Cache")
                OutlinedButton(
                    onClick = onClearCache,
                    enabled = cacheEnabled,
                    colors = pillOutlinedButtonColors(),
                    border = pillButtonBorder(),
                    shape = PillShape,
                    contentPadding = SmallButtonPadding,
                    modifier = Modifier.height(SmallButtonHeight)
                ) {
                    Text("Clear $cacheLabel", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    )
}

private fun formatCacheSize(bytes: Long): String {
    if (bytes <= 0) {
        return "0MB"
    }
    val mb = bytes / (1024.0 * 1024.0)
    val rounded = (mb * 10).roundToInt() / 10.0
    return if (rounded % 1.0 == 0.0) {
        "${rounded.toInt()}MB"
    } else {
        String.format(Locale.US, "%.1fMB", rounded)
    }
}

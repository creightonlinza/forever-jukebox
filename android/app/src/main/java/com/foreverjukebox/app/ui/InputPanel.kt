package com.foreverjukebox.app.ui

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
fun InputPanel(
    state: UiState,
    onOpenFile: (Uri, String?) -> Unit
) {
    val context = LocalContext.current
    val totalRamBytes = remember(context) { resolveTotalRamBytes(context) }
    val showLowRamWarning = totalRamBytes != null && totalRamBytes < LOW_RAM_WARNING_THRESHOLD_BYTES
    val filePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        }
        val title = context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
        onOpenFile(uri, title)
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface
        )
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Input", style = MaterialTheme.typography.labelLarge)
            if (showLowRamWarning) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer
                    )
                ) {
                    Text(
                        text = "Warning: Local analysis may fail on long tracks; 8GB+ RAM is recommended.",
                        modifier = Modifier.padding(10.dp),
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            Text(
                "Local mode runs analysis fully on-device and caches the result for faster future playback."
            )
            Button(
                onClick = { filePicker.launch(arrayOf("audio/*")) },
                colors = pillButtonColors(),
                border = pillButtonBorder(),
                shape = PillShape,
                contentPadding = SmallButtonPadding
            ) {
                Text("Open File")
            }
            if (!state.localSelectedFileName.isNullOrBlank()) {
                Text(
                    text = "Selected: ${state.localSelectedFileName}",
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                Text(
                    text = "Choose an audio file to begin analysis.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

private const val LOW_RAM_WARNING_THRESHOLD_BYTES = 8L * 1024L * 1024L * 1024L

private fun resolveTotalRamBytes(context: Context): Long? {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        ?: return null
    val memoryInfo = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(memoryInfo)
    return memoryInfo.totalMem.takeIf { it > 0L }
}

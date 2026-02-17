package com.foreverjukebox.app.ui

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
fun InputPanel(
    state: UiState,
    onOpenFile: (Uri, String?) -> Unit
) {
    val context = LocalContext.current
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

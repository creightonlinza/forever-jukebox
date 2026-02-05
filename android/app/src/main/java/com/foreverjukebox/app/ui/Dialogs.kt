package com.foreverjukebox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.ui.unit.dp

@Composable
fun TuningDialog(
    initialThreshold: Int,
    initialMinProb: Int,
    initialMaxProb: Int,
    initialRamp: Int,
    initialAddLastEdge: Boolean,
    initialJustBackwards: Boolean,
    initialJustLong: Boolean,
    initialRemoveSequential: Boolean,
    onDismiss: () -> Unit,
    onReset: () -> Unit,
    onApply: (
        threshold: Int,
        minProb: Double,
        maxProb: Double,
        ramp: Double,
        addLastEdge: Boolean,
        justBackwards: Boolean,
        justLongBranches: Boolean,
        removeSequentialBranches: Boolean
    ) -> Unit
) {
    var threshold by remember(initialThreshold) { mutableStateOf(initialThreshold.toFloat()) }
    var minProb by remember(initialMinProb) { mutableStateOf(initialMinProb.toFloat()) }
    var maxProb by remember(initialMaxProb) { mutableStateOf(initialMaxProb.toFloat()) }
    var ramp by remember(initialRamp) { mutableStateOf(initialRamp.toFloat()) }
    var addLastEdge by remember(initialAddLastEdge) { mutableStateOf(initialAddLastEdge) }
    var justBackwards by remember(initialJustBackwards) { mutableStateOf(initialJustBackwards) }
    var justLong by remember(initialJustLong) { mutableStateOf(initialJustLong) }
    var removeSequential by remember(initialRemoveSequential) { mutableStateOf(initialRemoveSequential) }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(
                onClick = {
                    val minVal = minProb.coerceAtMost(maxProb) / 100.0
                    val maxVal = maxProb.coerceAtLeast(minProb) / 100.0
                    val rampVal = ramp / 100.0
                    onApply(
                        threshold.toInt(),
                        minVal,
                        maxVal,
                        rampVal,
                        addLastEdge,
                        justBackwards,
                        justLong,
                        removeSequential
                    )
                    onDismiss()
                },
                colors = pillButtonColors(),
                border = pillButtonBorder(),
                shape = PillShape,
                contentPadding = SmallButtonPadding,
                modifier = Modifier.height(SmallButtonHeight)
            ) {
                Text("Apply", style = MaterialTheme.typography.labelSmall)
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = {
                        onReset()
                        onDismiss()
                    },
                    colors = pillOutlinedButtonColors(),
                    border = pillButtonBorder(),
                    shape = PillShape,
                    contentPadding = SmallButtonPadding,
                    modifier = Modifier.height(SmallButtonHeight)
                ) {
                    Text("Reset", style = MaterialTheme.typography.labelSmall)
                }
                OutlinedButton(
                    onClick = onDismiss,
                    colors = pillOutlinedButtonColors(),
                    border = pillButtonBorder(),
                    shape = PillShape,
                    contentPadding = SmallButtonPadding,
                    modifier = Modifier.height(SmallButtonHeight)
                ) {
                    Text("Close", style = MaterialTheme.typography.labelSmall)
                }
            }
        },
        title = { Text("Tuning") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Branch Similarity Threshold: ${threshold.toInt()}")
                Slider(value = threshold, onValueChange = { threshold = it }, valueRange = 0f..80f, steps = 15)
                Text("Branch Probability Min: ${minProb.toInt()}%")
                Slider(value = minProb, onValueChange = { minProb = it }, valueRange = 0f..100f)
                Text("Branch Probability Max: ${maxProb.toInt()}%")
                Slider(value = maxProb, onValueChange = { maxProb = it }, valueRange = 0f..100f)
                Text("Branch Ramp Speed: ${ramp.toInt()}%")
                Slider(value = ramp, onValueChange = { ramp = it }, valueRange = 0f..100f, steps = 10)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = addLastEdge, onCheckedChange = { addLastEdge = it })
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Loop extension optimization")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = justBackwards, onCheckedChange = { justBackwards = it })
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Allow only reverse branches")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = justLong, onCheckedChange = { justLong = it })
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Allow only long branches")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = removeSequential, onCheckedChange = { removeSequential = it })
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Remove sequential branches")
                }
            }
        }
    )
}

@Composable
fun BaseUrlDialog(initialValue: String, onSave: (String) -> Unit) {
    var urlInput by remember { mutableStateOf(initialValue) }
    val trimmed = urlInput.trim()
    val isValidUrl = remember(trimmed) { isValidBaseUrl(trimmed) }
    AlertDialog(
        onDismissRequest = {},
        confirmButton = {
            Button(
                onClick = { onSave(trimmed) },
                enabled = isValidUrl,
                colors = pillButtonColors(),
                border = pillButtonBorder(),
                shape = PillShape,
                contentPadding = SmallButtonPadding,
                modifier = Modifier.height(SmallButtonHeight)
            ) {
                Text("Save", style = MaterialTheme.typography.labelSmall)
            }
        },
        title = { Text("API Base URL") },
        text = {
            OutlinedTextField(
                value = urlInput,
                onValueChange = { urlInput = it },
                label = { Text("Example: http://192.168.1.100") },
                textStyle = MaterialTheme.typography.bodySmall,
                singleLine = true,
                isError = trimmed.isNotEmpty() && !isValidUrl,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Done
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.heightIn(min = SmallFieldMinHeight)
            )
            if (trimmed.isNotEmpty() && !isValidUrl) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "Enter a valid http(s) URL.",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    )
}

private fun isValidBaseUrl(value: String): Boolean {
    val parsed = runCatching { android.net.Uri.parse(value) }.getOrNull() ?: return false
    val scheme = parsed.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return false
    return !parsed.host.isNullOrBlank()
}

@Composable
fun TrackInfoDialog(
    durationSeconds: Double?,
    totalBeats: Int,
    totalBranches: Int,
    onClose: () -> Unit
) {
    val durationText = durationSeconds?.let { formatDuration(it) } ?: "00:00:00"
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = {
            Button(
                onClick = onClose,
                colors = pillButtonColors(),
                border = pillButtonBorder(),
                shape = PillShape,
                contentPadding = SmallButtonPadding,
                modifier = Modifier.height(SmallButtonHeight)
            ) {
                Text("Close", style = MaterialTheme.typography.labelSmall)
            }
        },
        title = { Text("Track Info") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Song Length: $durationText")
                Text("Total Beats: $totalBeats")
                Text("Total Branches: $totalBranches")
            }
        }
    )
}

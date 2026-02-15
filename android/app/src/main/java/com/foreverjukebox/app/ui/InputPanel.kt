package com.foreverjukebox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun InputPanel() {
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
            Text("Input (Open File)", style = MaterialTheme.typography.labelLarge)
            Text(
                "Local mode is active. Use this screen to load a local audio file in a future update."
            )
            OutlinedButton(
                onClick = {},
                enabled = false,
                colors = pillOutlinedButtonColors(),
                border = pillButtonBorder(),
                shape = PillShape,
                contentPadding = SmallButtonPadding
            ) {
                Text("Open File (Coming Soon)")
            }
        }
    }
}

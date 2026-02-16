package com.foreverjukebox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

@Composable
fun FaqPanel() {
    val uriHandler = LocalUriHandler.current
    val linkStyle = SpanStyle(
        color = MaterialTheme.colorScheme.primary,
        textDecoration = TextDecoration.Underline
    )
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface
        )
    ) {
        Column(
            modifier = Modifier
                .padding(12.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("FAQ", style = MaterialTheme.typography.labelLarge)
            Text("What the what?", fontWeight = FontWeight.Bold)
            val whatText = buildAnnotatedString {
                append("The Forever Jukebox is an open-source modernization of Paul Lamere's ")
                pushStringAnnotation(
                    tag = "URL",
                    annotation = "https://musicmachinery.com/2012/11/12/the-infinite-jukebox/"
                )
                withStyle(linkStyle) { append("Infinite Jukebox") }
                pop()
                append(" — rebuilt from the ground up by ")
                pushStringAnnotation(tag = "URL", annotation = "https://creighton.dev/")
                withStyle(linkStyle) { append("Creighton") }
                pop()
                append(". It generates a forever-evolving version of any song.")
            }
            ClickableText(
                text = whatText,
                style = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface
                ),
                onClick = { offset ->
                    val annotation = whatText.getStringAnnotations("URL", offset, offset).firstOrNull()
                    annotation?.let { link -> uriHandler.openUri(link.item) }
                }
            )

            Text("How does it work?", fontWeight = FontWeight.Bold)
            Text(
                "Audio is processed by the Forever Jukebox Analysis Engine, which approximates Spotify’s legacy Echo Nest analysis (now deprecated) by extracting beats, segments, and related features. Those features drive beat-synchronous playback in the frontend. On each beat, the player may jump to a different, sonically similar point in the track based on timbre, loudness, segment duration, and beat position. The visualizations map these potential jump paths for every beat."
            )
            val sourceText = buildAnnotatedString {
                append("The full source code is available in the ")
                pushStringAnnotation(
                    tag = "URL",
                    annotation = "https://github.com/creightonlinza/forever-jukebox/"
                )
                withStyle(linkStyle) { append("forever-jukebox") }
                pop()
                append(" repository.")
            }
            ClickableText(
                text = sourceText,
                style = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface
                ),
                onClick = { offset ->
                    val annotation = sourceText.getStringAnnotations("URL", offset, offset).firstOrNull()
                    annotation?.let { link -> uriHandler.openUri(link.item) }
                }
            )

            Text("How can I tune the Jukebox?", fontWeight = FontWeight.Bold)
            BulletListItem("Click the Tune button to open the tuning panel.")
            BulletListItem("Lower the threshold for higher audio continuity; raise it for more branches.")
            BulletListItem("Adjust branch probability min/max and ramp speed to shape how often jumps happen.")
            BulletListItem("Use the checkboxes to allow or restrict certain branch types.")

            Text("How do Favorites work? (server mode only)", fontWeight = FontWeight.Bold)
            BulletListItem("Favorites are saved/unsaved by clicking the star icon on a song. They are stored locally in your browser and can optionally be synced across devices using a sync code obtained from the Favorites sync menu.")
            BulletListItem("When you favorite a song, its tuning is saved too, so future loads restore your chosen parameters.")
            BulletListItem("Use Reset in the Tune panel to restore default tuning (must be re-favorited to save changes).")
        }
    }
}

@Composable
private fun BulletListItem(text: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text("•")
        Text(
            text = text,
            modifier = Modifier
                .padding(start = 8.dp)
                .weight(1f)
        )
    }
}

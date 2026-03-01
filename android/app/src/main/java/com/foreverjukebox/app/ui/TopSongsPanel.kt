package com.foreverjukebox.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import android.widget.Toast
import kotlinx.coroutines.launch
import com.foreverjukebox.app.data.FavoriteTrack
import com.foreverjukebox.app.data.FavoriteSourceType
import com.foreverjukebox.app.data.TopSongItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopSongsPanel(
    items: List<TopSongItem>,
    risingItems: List<TopSongItem>,
    recentItems: List<TopSongItem>,
    favorites: List<FavoriteTrack>,
    loading: Boolean,
    risingLoading: Boolean,
    recentLoading: Boolean,
    favoritesLoading: Boolean,
    topSongsLimit: Int,
    activeTab: TopSongsTab,
    onTabSelected: (TopSongsTab) -> Unit,
    onRefreshTopSongs: () -> Unit,
    onRefreshRisingSongs: () -> Unit,
    onRefreshRecentSongs: () -> Unit,
    onRefreshFavorites: () -> Unit,
    onSelect: (String, String?, String?, String?, FavoriteSourceType) -> Unit,
    onRemoveFavorite: (String) -> Unit,
    favoritesSyncCode: String?,
    allowFavoritesSync: Boolean,
    onRefreshSync: () -> Unit,
    onCreateSync: () -> Unit,
    onFetchSync: suspend (String) -> List<FavoriteTrack>?,
    onApplySync: (String, List<FavoriteTrack>) -> Unit
) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val scope = rememberCoroutineScope()
    val hasSyncCode = allowFavoritesSync && !favoritesSyncCode.isNullOrBlank()
    var showSyncMenu by remember { mutableStateOf(false) }
    var showEnterDialog by remember { mutableStateOf(false) }
    var showCreateDialog by remember { mutableStateOf(false) }
    var showConfirmDialog by remember { mutableStateOf(false) }
    var syncInput by remember { mutableStateOf("") }
    var pendingFavorites by remember { mutableStateOf<List<FavoriteTrack>>(emptyList()) }
    var pendingCode by remember { mutableStateOf("") }
    var showCreateButton by remember { mutableStateOf(true) }
    var createHint by remember {
        mutableStateOf("Create a sync code to share your favorites between devices.")
    }

    LaunchedEffect(showCreateDialog) {
        if (showCreateDialog) {
            showCreateButton = true
            createHint = if (hasSyncCode) {
                "Enter this code on another device to sync."
            } else {
                "Create a sync code to share your favorites between devices."
            }
        }
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TopSongsTabs(activeTab = activeTab, onTabSelected = onTabSelected)
            if (activeTab == TopSongsTab.TopSongs) {
                Text("Top $topSongsLimit", style = MaterialTheme.typography.labelLarge)
                PullToRefreshBox(
                    isRefreshing = loading,
                    onRefresh = onRefreshTopSongs,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (loading) {
                        Text("Loading top songs…", style = MaterialTheme.typography.bodySmall)
                    } else if (items.isEmpty()) {
                        Text("No plays recorded yet.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(items) { index, item ->
                                val title = item.title
                                val artist = item.artist
                                val displayTitle = title ?: "Untitled"
                                val displayArtist = artist ?: ""
                                val youtubeId = item.youtubeId ?: return@itemsIndexed
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            onSelect(
                                                youtubeId,
                                                title,
                                                artist,
                                                null,
                                                FavoriteSourceType.Youtube
                                            )
                                        },
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${index + 1}.",
                                        modifier = Modifier.alignByBaseline(),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = if (displayArtist.isNotBlank()) {
                                            "$displayTitle — $displayArtist"
                                        } else {
                                            displayTitle
                                        },
                                        modifier = Modifier
                                            .weight(1f)
                                            .alignByBaseline(),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            } else if (activeTab == TopSongsTab.Rising) {
                Text("Rising", style = MaterialTheme.typography.labelLarge)
                PullToRefreshBox(
                    isRefreshing = risingLoading,
                    onRefresh = onRefreshRisingSongs,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (risingLoading) {
                        Text("Loading rising songs…", style = MaterialTheme.typography.bodySmall)
                    } else if (risingItems.isEmpty()) {
                        Text("No rising songs yet.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(risingItems) { index, item ->
                                val title = item.title
                                val artist = item.artist
                                val displayTitle = title ?: "Untitled"
                                val displayArtist = artist ?: ""
                                val youtubeId = item.youtubeId ?: return@itemsIndexed
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            onSelect(
                                                youtubeId,
                                                title,
                                                artist,
                                                null,
                                                FavoriteSourceType.Youtube
                                            )
                                        },
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${index + 1}.",
                                        modifier = Modifier.alignByBaseline(),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = if (displayArtist.isNotBlank()) {
                                            "$displayTitle — $displayArtist"
                                        } else {
                                            displayTitle
                                        },
                                        modifier = Modifier
                                            .weight(1f)
                                            .alignByBaseline(),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            } else if (activeTab == TopSongsTab.Recent) {
                Text("Last $topSongsLimit Played", style = MaterialTheme.typography.labelLarge)
                PullToRefreshBox(
                    isRefreshing = recentLoading,
                    onRefresh = onRefreshRecentSongs,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (recentLoading) {
                        Text("Loading recent plays…", style = MaterialTheme.typography.bodySmall)
                    } else if (recentItems.isEmpty()) {
                        Text("No recent plays yet.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(recentItems) { index, item ->
                                val title = item.title
                                val artist = item.artist
                                val displayTitle = title ?: "Untitled"
                                val displayArtist = artist ?: ""
                                val youtubeId = item.youtubeId ?: return@itemsIndexed
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            onSelect(
                                                youtubeId,
                                                title,
                                                artist,
                                                null,
                                                FavoriteSourceType.Youtube
                                            )
                                        },
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${index + 1}.",
                                        modifier = Modifier.alignByBaseline(),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = if (displayArtist.isNotBlank()) {
                                            "$displayTitle — $displayArtist"
                                        } else {
                                            displayTitle
                                        },
                                        modifier = Modifier
                                            .weight(1f)
                                            .alignByBaseline(),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text("Favorites", style = MaterialTheme.typography.labelLarge)
                    if (allowFavoritesSync) {
                        IconButton(onClick = { showSyncMenu = true }, modifier = Modifier.size(24.dp)) {
                            Icon(
                                imageVector = if (hasSyncCode) Icons.Outlined.Cloud else Icons.Outlined.CloudOff,
                                contentDescription = "Favorites sync",
                                tint = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        DropdownMenu(
                            expanded = showSyncMenu,
                            onDismissRequest = { showSyncMenu = false }
                        ) {
                            if (hasSyncCode) {
                                DropdownMenuItem(
                                    text = { Text("Refresh favorites") },
                                    onClick = {
                                        showSyncMenu = false
                                        onRefreshSync()
                                    }
                                )
                            }
                            DropdownMenuItem(
                                text = { Text(if (hasSyncCode) "View sync code" else "Create sync code") },
                                onClick = {
                                    showSyncMenu = false
                                    showCreateDialog = true
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Enter sync code") },
                                onClick = {
                                    showSyncMenu = false
                                    showEnterDialog = true
                                }
                            )
                        }
                    }
                }
                val favoritesPullRefreshEnabled = allowFavoritesSync && hasSyncCode
                if (favoritesPullRefreshEnabled) {
                    PullToRefreshBox(
                        isRefreshing = favoritesLoading,
                        onRefresh = onRefreshFavorites,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        FavoritesListContent(
                            favorites = favorites,
                            onSelect = onSelect,
                            onRemoveFavorite = onRemoveFavorite
                        )
                    }
                } else {
                    FavoritesListContent(
                        favorites = favorites,
                        onSelect = onSelect,
                        onRemoveFavorite = onRemoveFavorite
                    )
                }
            }
        }
    }

    if (showEnterDialog) {
        AlertDialog(
            onDismissRequest = {
                showEnterDialog = false
                syncInput = ""
            },
            title = { Text("Favorites Sync") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Enter the 3-word sync code to pull down your favorites.")
                    OutlinedTextField(
                        value = syncInput,
                        onValueChange = { syncInput = it },
                        placeholder = { Text("the-forever-jukebox") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Text,
                            imeAction = ImeAction.Done
                        )
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val code = syncInput.trim()
                        if (code.isBlank()) {
                            Toast.makeText(appContext, "Enter a sync code first.", Toast.LENGTH_SHORT).show()
                            return@Button
                        }
                        scope.launch {
                            val result = onFetchSync(code)
                            if (result == null) {
                                Toast.makeText(appContext, "Favorites sync failed.", Toast.LENGTH_SHORT).show()
                            } else {
                                pendingFavorites = result
                                pendingCode = code.lowercase()
                                showEnterDialog = false
                                syncInput = ""
                                showConfirmDialog = true
                            }
                        }
                    }
                ) {
                    Text("Sync favorites")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = {
                    showEnterDialog = false
                    syncInput = ""
                }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = {
                showCreateDialog = false
                syncInput = ""
            },
            title = { Text("Favorites Sync") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(createHint)
                    if (hasSyncCode) {
                        OutlinedTextField(
                            value = favoritesSyncCode ?: "",
                            onValueChange = {},
                            readOnly = true,
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Text,
                                imeAction = ImeAction.Done
                            )
                        )
                    }
                }
            },
            confirmButton = {
                if (showCreateButton) {
                    Button(
                        onClick = {
                            showCreateButton = false
                            createHint = "Enter this code on another device to sync."
                            onCreateSync()
                        }
                    ) {
                        Text(if (hasSyncCode) "Create new sync code" else "Create sync code")
                    }
                }
            },
            dismissButton = {
                OutlinedButton(onClick = {
                    showCreateDialog = false
                    syncInput = ""
                }) {
                    Text("Close")
                }
            }
        )
    }

    if (showConfirmDialog) {
        AlertDialog(
            onDismissRequest = {
                showConfirmDialog = false
                syncInput = ""
            },
            title = { Text("Replace favorites?") },
            text = { Text("Replace your local favorites with the synced list?") },
            confirmButton = {
                Button(
                    onClick = {
                        onApplySync(pendingCode, pendingFavorites)
                        showConfirmDialog = false
                        Toast.makeText(appContext, "Favorites updated.", Toast.LENGTH_SHORT).show()
                    }
                ) {
                    Text("Confirm")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = {
                    showConfirmDialog = false
                    syncInput = ""
                }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun FavoritesListContent(
    favorites: List<FavoriteTrack>,
    onSelect: (String, String?, String?, String?, FavoriteSourceType) -> Unit,
    onRemoveFavorite: (String) -> Unit
) {
    if (favorites.isEmpty()) {
        Text("No favorites yet.", style = MaterialTheme.typography.bodySmall)
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(favorites) { item ->
                val title = item.title
                val artist = item.artist
                val displayTitle = title.ifBlank { "Untitled" }
                val displayArtist = artist.ifBlank { "" }
                val display = if (displayArtist.isNotBlank() && displayArtist != "Unknown") {
                    "$displayTitle — $displayArtist"
                } else {
                    displayTitle
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            onSelect(
                                item.uniqueSongId,
                                title,
                                artist,
                                item.tuningParams,
                                item.sourceType
                            )
                        },
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .alignByBaseline(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = display,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (!item.tuningParams.isNullOrBlank()) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Icon(
                                Icons.Outlined.Tune,
                                contentDescription = "Custom tuning",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                    IconButton(
                        onClick = { onRemoveFavorite(item.uniqueSongId) },
                        modifier = Modifier.size(24.dp)
                    ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Remove favorite",
                                tint = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.size(12.dp)
                            )
                    }
                }
            }
        }
    }
}

@Composable
private fun TopSongsTabs(activeTab: TopSongsTab, onTabSelected: (TopSongsTab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 2.dp),
        horizontalArrangement = Arrangement.Start
    ) {
        SubTabButton(
            text = "All Time",
            active = activeTab == TopSongsTab.TopSongs,
            onClick = { onTabSelected(TopSongsTab.TopSongs) }
        )
        Spacer(modifier = Modifier.width(8.dp))
        SubTabButton(
            text = "Rising",
            active = activeTab == TopSongsTab.Rising,
            onClick = { onTabSelected(TopSongsTab.Rising) }
        )
        Spacer(modifier = Modifier.width(8.dp))
        SubTabButton(
            text = "Recents",
            active = activeTab == TopSongsTab.Recent,
            onClick = { onTabSelected(TopSongsTab.Recent) }
        )
        Spacer(modifier = Modifier.weight(1f))
        SubTabButton(
            text = "Favorites",
            active = activeTab == TopSongsTab.Favorites,
            onClick = { onTabSelected(TopSongsTab.Favorites) }
        )
    }
}

@Composable
private fun SubTabButton(text: String, active: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        colors = pillOutlinedButtonColors(active),
        border = pillButtonBorder(),
        contentPadding = SmallButtonPadding,
        shape = PillShape,
        modifier = Modifier.height(SmallButtonHeight)
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall)
        Spacer(modifier = Modifier.width(2.dp))
    }
}

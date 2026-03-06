package com.foreverjukebox.app.ui

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.foreverjukebox.app.data.AppMode
import com.foreverjukebox.app.visualization.AutocanonizerVisualization
import com.foreverjukebox.app.visualization.EdgeRouting
import com.foreverjukebox.app.visualization.JukeboxVisualization
import com.foreverjukebox.app.visualization.JumpLine
import com.foreverjukebox.app.visualization.edgeRoutingForVisualization
import com.foreverjukebox.app.visualization.positioners
import com.foreverjukebox.app.visualization.prefersWideAspectForVisualization
import com.foreverjukebox.app.visualization.visualizationLabels
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

@Composable
fun PlayPanel(state: UiState, viewModel: MainViewModel) {
    val context = LocalContext.current
    val playback = state.playback
    val tuning = state.tuning
    val headerTitle = resolvePlaybackHeaderTitle(playback)
    val isFavorite = playback.lastYouTubeId?.let { id ->
        state.favorites.any { it.uniqueSongId == id }
    } == true
    var showTuning by remember { mutableStateOf(false) }
    var showInfo by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()
    val vizLabels = visualizationLabels
    var jumpLine by remember { mutableStateOf(playback.jumpLine) }
    val fullscreenLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            return@rememberLauncherForActivityResult
        }
        val nextIndex = result.data?.getIntExtra(
            FullscreenActivity.EXTRA_RESULT_VIZ_INDEX,
            playback.activeVizIndex
        ) ?: return@rememberLauncherForActivityResult
        val nextModeRaw = result.data?.getStringExtra(FullscreenActivity.EXTRA_RESULT_MODE)
        val nextMode = nextModeRaw?.let { raw ->
            runCatching { PlaybackMode.valueOf(raw) }.getOrNull()
        }
        if (nextMode != null) {
            viewModel.setPlaybackMode(nextMode)
        }
        viewModel.setActiveVisualization(nextIndex)
        viewModel.refreshPlaybackFromController()
    }

    LaunchedEffect(playback.jumpLine) {
        if (playback.jumpLine != null) {
            jumpLine = playback.jumpLine
        }
    }

    LaunchedEffect(jumpLine) {
        val current = jumpLine ?: return@LaunchedEffect
        delay(1100)
        if (jumpLine?.startedAt == current.startedAt) {
            jumpLine = null
        }
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (!playback.isCasting && !playback.analysisErrorMessage.isNullOrBlank()) {
            ErrorStatus(
                message = playback.analysisErrorMessage,
                showRetry = state.appMode == AppMode.Server,
                onRetry = { viewModel.retryFailedLoad() }
            )
        } else if (!playback.isCasting && (playback.analysisInFlight || playback.analysisCalculating || playback.audioLoading)) {
            LoadingStatus(
                progress = playback.analysisProgress,
                label = when {
                    playback.analysisCalculating -> "Calculating pathways"
                    playback.analysisInFlight -> playback.analysisMessage ?: "Fetching audio"
                    playback.audioLoading -> "Fetching audio"
                    else -> null
                },
                showCancel = shouldShowLocalLoadingCancel(state.appMode, playback),
                onCancel = viewModel::cancelLocalAnalysis
            )
        }

        when (resolveListenContentMode(playback)) {
            ListenContentMode.Cast -> {
            CastListenScreen(
                playback = playback,
                appMode = state.appMode,
                headerTitle = headerTitle,
                vizLabels = vizLabels,
                isFavorite = isFavorite,
                onTogglePlayback = viewModel::togglePlayback,
                onOpenTuning = { showTuning = true },
                onOpenInfo = { showInfo = true },
                onDeleteCurrentTrack = {
                    coroutineScope.launch {
                        val deleted = viewModel.deleteCurrentJob()
                        val deletedText =
                            if (!deleted) "Song can no longer be deleted" else "Song deleted"
                        Toast.makeText(context, deletedText, Toast.LENGTH_SHORT).show()
                    }
                },
                onShare = {
                    val url = viewModel.buildShareUrl()
                    if (url != null) {
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                        }
                        context.startActivity(Intent.createChooser(shareIntent, "Share Forever Jukebox link"))
                    }
                },
                onToggleFavorite = {
                    if (playback.lastYouTubeId != null) {
                        val limitReached = viewModel.toggleFavoriteForCurrent()
                        val message = when {
                            limitReached -> "Maximum favorites reached (100)."
                            isFavorite -> "Removed from Favorites"
                            else -> "Added to Favorites"
                        }
                        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
                    }
                },
                onSelectVisualization = viewModel::setActiveVisualization
            )
            }
            ListenContentMode.LocalReady -> {
            LocalListenScreen(
                playback = playback,
                appMode = state.appMode,
                tuning = tuning,
                headerTitle = headerTitle,
                vizLabels = vizLabels,
                jumpLine = jumpLine,
                isFavorite = isFavorite,
                onTogglePlayback = viewModel::togglePlayback,
                onOpenTuning = { showTuning = true },
                onOpenInfo = { showInfo = true },
                onDeleteCurrentTrack = {
                    coroutineScope.launch {
                        val deleted = viewModel.deleteCurrentJob()
                        val deletedText =
                            if (!deleted) "Song can no longer be deleted" else "Song deleted"
                        Toast.makeText(context, deletedText, Toast.LENGTH_SHORT).show()
                    }
                },
                onShare = {
                    val url = viewModel.buildShareUrl()
                    if (url != null) {
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                        }
                        context.startActivity(Intent.createChooser(shareIntent, "Share Forever Jukebox link"))
                    }
                },
                onToggleFavorite = {
                    if (playback.lastYouTubeId != null) {
                        val limitReached = viewModel.toggleFavoriteForCurrent()
                        val message = when {
                            limitReached -> "Maximum favorites reached (100)."
                            isFavorite -> "Removed from Favorites"
                            else -> "Added to Favorites"
                        }
                        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
                    }
                },
                onSetPlaybackMode = viewModel::setPlaybackMode,
                onSetVisualization = viewModel::setActiveVisualization,
                onSetCanonizerFinishOutSong = viewModel::setCanonizerFinishOutSong,
                onSelectBeat = viewModel::selectBeat,
                onOpenFullscreen = {
                    val intent = Intent(context, FullscreenActivity::class.java)
                        .putExtra(FullscreenActivity.EXTRA_VIZ_INDEX, playback.activeVizIndex)
                        .putExtra(FullscreenActivity.EXTRA_MODE, playback.playMode.name)
                    fullscreenLauncher.launch(intent)
                }
            )
            }
            ListenContentMode.Empty -> {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        "No song selected.",
                        color = MaterialTheme.colorScheme.onBackground
                    )
                }
            }
            ListenContentMode.None -> Unit
        }
    }

    if (showInfo && playback.playMode != PlaybackMode.Autocanonizer) {
        val totalBeats = if (playback.isCasting) {
            playback.castTotalBeats ?: 0
        } else {
            playback.vizData?.beats?.size ?: playback.castTotalBeats ?: 0
        }
        val totalBranches = if (playback.isCasting) {
            playback.castTotalBranches ?: 0
        } else {
            playback.vizData?.edges?.size ?: playback.castTotalBranches ?: 0
        }
        TrackInfoDialog(
            durationSeconds = playback.trackDurationSeconds,
            totalBeats = totalBeats,
            totalBranches = totalBranches,
            onClose = { showInfo = false }
        )
    }

    if (showTuning && playback.playMode != PlaybackMode.Autocanonizer) {
        TuningDialog(
            initialThreshold = tuning.threshold,
            initialMinProb = tuning.minProb,
            initialMaxProb = tuning.maxProb,
            initialRamp = tuning.ramp,
            initialHighlightAnchorBranch = tuning.highlightAnchorBranch,
            initialJustBackwards = tuning.justBackwards,
            initialJustLong = tuning.justLong,
            initialRemoveSequential = tuning.removeSequential,
            onDismiss = { showTuning = false },
            onReset = viewModel::resetTuningDefaults,
            onApply = viewModel::applyTuning
        )
    }
}

@Composable
private fun ColumnScope.CastListenScreen(
    playback: PlaybackState,
    appMode: AppMode?,
    headerTitle: String?,
    vizLabels: List<String>,
    isFavorite: Boolean,
    onTogglePlayback: () -> Unit,
    onOpenTuning: () -> Unit,
    onOpenInfo: () -> Unit,
    onDeleteCurrentTrack: () -> Unit,
    onShare: () -> Unit,
    onToggleFavorite: () -> Unit,
    onSelectVisualization: (Int) -> Unit
) {
    val hasCastTrack = playback.hasCastTrack()
    val canShowTransport = shouldShowPlaybackTransport(playback)
    val canSelectVisualization = playback.castControlsReady()
    val inAutocanonizer = playback.playMode == PlaybackMode.Autocanonizer
    val playActionLabel = playActionLabelForState(playback)
    val showServerActions = shouldShowServerListenActions(appMode)
    val themeTokens = LocalThemeTokens.current
    var showVizMenu by remember(playback.activeVizIndex) { mutableStateOf(false) }
    val castLabel = playback.castDeviceName?.let { "Connected to $it" } ?: "Connected to cast device"

    Column(
        modifier = Modifier
            .weight(1f, fill = true)
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (hasCastTrack) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (!headerTitle.isNullOrBlank()) {
                    AutoMarqueeText(
                        text = headerTitle,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier
                            .weight(1f, fill = true)
                            .padding(end = 8.dp)
                    )
                } else {
                    Spacer(modifier = Modifier.weight(1f, fill = true))
                }
                if (canShowTransport) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (playback.deleteEligible) {
                            IconButton(
                                onClick = onDeleteCurrentTrack,
                                modifier = Modifier.size(SmallButtonHeight)
                            ) {
                                Icon(
                                    Icons.Outlined.Delete,
                                    contentDescription = "Delete within 30 minutes of creation",
                                    tint = Color(0xFFE35A5A),
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        if (!inAutocanonizer) {
                            IconButton(
                                onClick = onOpenTuning,
                                modifier = Modifier.size(SmallButtonHeight)
                            ) {
                                Icon(
                                    Icons.Outlined.Tune,
                                    contentDescription = "Tune",
                                    tint = MaterialTheme.colorScheme.onBackground,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            IconButton(
                                onClick = onOpenInfo,
                                modifier = Modifier.size(SmallButtonHeight)
                            ) {
                                Icon(
                                    Icons.Outlined.Info,
                                    contentDescription = "Info",
                                    tint = MaterialTheme.colorScheme.onBackground,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        if (showServerActions) {
                            IconButton(
                                onClick = onShare,
                                modifier = Modifier.size(SmallButtonHeight)
                            ) {
                                Icon(
                                    Icons.Outlined.Share,
                                    contentDescription = "Share",
                                    tint = MaterialTheme.colorScheme.onBackground,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            IconButton(
                                onClick = onToggleFavorite,
                                modifier = Modifier.size(SmallButtonHeight)
                            ) {
                                Icon(
                                    imageVector = if (isFavorite) Icons.Filled.Star else Icons.Outlined.StarBorder,
                                    contentDescription = if (isFavorite) "Remove favorite" else "Add favorite",
                                    tint = themeTokens.beatFill,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
        Box(
            modifier = Modifier
                .weight(1f, fill = true)
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(themeTokens.vizBackground),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Outlined.Cast,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.16f),
                modifier = Modifier.size(170.dp)
            )
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 12.dp)
            ) {
                Text(
                    text = castLabel,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onBackground
                )
                if (!hasCastTrack) {
                    Text(
                        text = "Choose a song to start casting.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f)
                    )
                } else {
                    if (canSelectVisualization) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = "Visualization:",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onBackground
                            )
                            Box {
                                OutlinedButton(
                                    onClick = { showVizMenu = true },
                                    colors = pillOutlinedButtonColors(),
                                    border = pillButtonBorder(),
                                    shape = PillShape,
                                    contentPadding = SmallButtonPadding,
                                    modifier = Modifier.height(SmallButtonHeight)
                                ) {
                                    Text(
                                        text = vizLabels.getOrNull(playback.activeVizIndex) ?: "Select",
                                        style = MaterialTheme.typography.labelSmall
                                    )
                                    Icon(
                                        imageVector = Icons.Filled.ArrowDropDown,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                                DropdownMenu(
                                    expanded = showVizMenu,
                                    onDismissRequest = { showVizMenu = false }
                                ) {
                                    vizLabels.forEachIndexed { index, label ->
                                        DropdownMenuItem(
                                            text = { Text(label) },
                                            onClick = {
                                                onSelectVisualization(index)
                                                showVizMenu = false
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }
                    if (canShowTransport) {
                        Button(
                            onClick = onTogglePlayback,
                            colors = pillButtonColors(),
                            border = pillButtonBorder(),
                            shape = RoundedCornerShape(12.dp),
                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                            modifier = Modifier.height(SmallButtonHeight)
                        ) {
                            Icon(
                                imageVector = if (playback.isRunning) {
                                    Icons.Filled.Pause
                                } else {
                                    Icons.Filled.PlayArrow
                                },
                                contentDescription = playActionLabel,
                                tint = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.size(30.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(playActionLabel)
                            Spacer(modifier = Modifier.width(8.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.LocalListenScreen(
    playback: PlaybackState,
    appMode: AppMode?,
    tuning: TuningState,
    headerTitle: String?,
    vizLabels: List<String>,
    jumpLine: JumpLine?,
    isFavorite: Boolean,
    onTogglePlayback: () -> Unit,
    onOpenTuning: () -> Unit,
    onOpenInfo: () -> Unit,
    onDeleteCurrentTrack: () -> Unit,
    onShare: () -> Unit,
    onToggleFavorite: () -> Unit,
    onSetPlaybackMode: (PlaybackMode) -> Unit,
    onSetVisualization: (Int) -> Unit,
    onSetCanonizerFinishOutSong: (Boolean) -> Unit,
    onSelectBeat: (Int) -> Unit,
    onOpenFullscreen: () -> Unit
) {
    val density = LocalDensity.current
    var vizContainerSize by remember { mutableStateOf(IntSize.Zero) }
    var showVizMenu by remember { mutableStateOf(false) }
    var showModeMenu by remember { mutableStateOf(false) }
    val showServerActions = shouldShowServerListenActions(appMode)
    val inAutocanonizer = playback.playMode == PlaybackMode.Autocanonizer
    val playActionLabel = playActionLabelForState(playback)
    val showInlineTitleWithControls = shouldShowPlaybackTransport(playback)
    val themeTokens = LocalThemeTokens.current

    Column(
        modifier = Modifier
            .weight(1f, fill = true)
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (showInlineTitleWithControls) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (!headerTitle.isNullOrBlank()) {
                    AutoMarqueeText(
                        text = headerTitle,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier
                            .weight(1f, fill = true)
                            .padding(end = 8.dp)
                    )
                } else {
                    Spacer(modifier = Modifier.weight(1f, fill = true))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (playback.deleteEligible) {
                        IconButton(
                            onClick = onDeleteCurrentTrack,
                            modifier = Modifier.size(SmallButtonHeight)
                        ) {
                            Icon(
                                Icons.Outlined.Delete,
                                contentDescription = "Delete within 30 minutes of creation",
                                tint = Color(0xFFE35A5A),
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                    if (!inAutocanonizer) {
                        IconButton(
                            onClick = onOpenTuning,
                            modifier = Modifier.size(SmallButtonHeight)
                        ) {
                            Icon(
                                Icons.Outlined.Tune,
                                contentDescription = "Tune",
                                tint = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                        IconButton(
                            onClick = onOpenInfo,
                            modifier = Modifier.size(SmallButtonHeight)
                        ) {
                            Icon(
                                Icons.Outlined.Info,
                                contentDescription = "Info",
                                tint = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                    if (showServerActions) {
                        IconButton(
                            onClick = onShare,
                            modifier = Modifier.size(SmallButtonHeight)
                        ) {
                            Icon(
                                Icons.Outlined.Share,
                                contentDescription = "Share",
                                tint = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                        IconButton(
                            onClick = onToggleFavorite,
                            modifier = Modifier.size(SmallButtonHeight)
                        ) {
                            Icon(
                                imageVector = if (isFavorite) Icons.Filled.Star else Icons.Outlined.StarBorder,
                                contentDescription = if (isFavorite) "Remove favorite" else "Add favorite",
                                tint = themeTokens.beatFill,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }
        Box(
            modifier = Modifier
                .weight(1f, fill = true)
                .fillMaxWidth()
                .onSizeChanged { vizContainerSize = it }
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                .background(themeTokens.vizBackground)
        ) {
            val vizSidePx = kotlin.math.min(vizContainerSize.width, vizContainerSize.height)
            val vizSide: Dp = with(density) { vizSidePx.toDp() }
            val edgeRouting = edgeRoutingForVisualization(playback.activeVizIndex)
            val isLandscapeVizContainer = vizContainerSize.width > vizContainerSize.height
            val useWideLayout =
                !inAutocanonizer &&
                    isLandscapeVizContainer &&
                    prefersWideAspectForVisualization(playback.activeVizIndex)
            val jukeboxModifier = if (useWideLayout) {
                if (edgeRouting == EdgeRouting.ArcDiagram) {
                    Modifier
                        .fillMaxSize()
                        .padding(vertical = 2.dp)
                } else {
                    Modifier.fillMaxSize()
                }
            } else {
                Modifier.size(vizSide)
            }
            if (inAutocanonizer) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    AutocanonizerVisualization(
                        data = playback.autocanonizerData,
                        currentIndex = playback.currentBeatIndex,
                        forcedOtherIndex = playback.canonizerOtherIndex,
                        tileColorOverrides = playback.canonizerTileColorOverrides,
                        onSelectBeat = onSelectBeat,
                        modifier = Modifier.size(vizSide)
                    )
                }
            } else {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    JukeboxVisualization(
                        data = playback.vizData,
                        currentIndex = playback.currentBeatIndex,
                        jumpLine = jumpLine,
                        positioner = positioners.getOrNull(playback.activeVizIndex) ?: positioners.first(),
                        edgeRouting = edgeRouting,
                        highlightAnchorBranch = tuning.highlightAnchorBranch,
                        onSelectBeat = onSelectBeat,
                        modifier = jukeboxModifier
                    )
                }
            }
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box {
                    OutlinedButton(
                        onClick = { showModeMenu = true },
                        colors = pillOutlinedButtonColors(),
                        border = pillButtonBorder(),
                        shape = PillShape,
                        contentPadding = SmallButtonPadding,
                        modifier = Modifier.height(SmallButtonHeight)
                    ) {
                        Text(
                            text = if (inAutocanonizer) "Autocanonizer" else "Jukebox",
                            style = MaterialTheme.typography.labelSmall
                        )
                        Icon(
                            imageVector = Icons.Filled.ArrowDropDown,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    DropdownMenu(
                        expanded = showModeMenu,
                        onDismissRequest = { showModeMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Autocanonizer") },
                            onClick = {
                                onSetPlaybackMode(PlaybackMode.Autocanonizer)
                                showModeMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Jukebox") },
                            onClick = {
                                onSetPlaybackMode(PlaybackMode.Jukebox)
                                showModeMenu = false
                            }
                        )
                    }
                }
            }
            if (inAutocanonizer) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = {
                            onSetCanonizerFinishOutSong(!playback.canonizerFinishOutSong)
                        },
                        modifier = Modifier.size(SmallButtonHeight)
                    ) {
                        Icon(
                            imageVector = if (playback.canonizerFinishOutSong) {
                                Icons.Filled.CheckBox
                            } else {
                                Icons.Outlined.CheckBoxOutlineBlank
                            },
                            contentDescription = if (playback.canonizerFinishOutSong) {
                                "Disable finish out the song"
                            } else {
                                "Enable finish out the song"
                            },
                            tint = themeTokens.accent,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    Text(
                        "Finish out the song",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                }
            } else {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                ) {
                    OutlinedButton(
                        onClick = { showVizMenu = true },
                        colors = pillOutlinedButtonColors(),
                        border = pillButtonBorder(),
                        shape = PillShape,
                        contentPadding = SmallButtonPadding,
                        modifier = Modifier.height(SmallButtonHeight)
                    ) {
                        Text(
                            vizLabels.getOrNull(playback.activeVizIndex) ?: "Select",
                            style = MaterialTheme.typography.labelSmall
                        )
                        Icon(
                            imageVector = Icons.Filled.ArrowDropDown,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    DropdownMenu(
                        expanded = showVizMenu,
                        onDismissRequest = { showVizMenu = false }
                    ) {
                        vizLabels.forEachIndexed { index, label ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    onSetVisualization(index)
                                    showVizMenu = false
                                }
                            )
                        }
                    }
                }
            }
            IconButton(
                onClick = onOpenFullscreen,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp)
                    .size(SmallButtonHeight)
            ) {
                Icon(
                    Icons.Default.Fullscreen,
                    contentDescription = "Fullscreen",
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }
            if (shouldShowPlaybackTransport(playback)) {
                Button(
                    onClick = onTogglePlayback,
                    colors = pillButtonColors(),
                    border = pillButtonBorder(),
                    shape = RoundedCornerShape(12.dp),
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(6.dp)
                        .height(SmallButtonHeight)
                ) {
                    Icon(
                        imageVector = if (playback.isRunning) {
                            Icons.Filled.Pause
                        } else {
                            Icons.Filled.PlayArrow
                        },
                        contentDescription = playActionLabel,
                        tint = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.size(30.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(playActionLabel)
                    Spacer(modifier = Modifier.width(8.dp))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text("Listen Time: ${playback.listenTime}", color = MaterialTheme.colorScheme.onBackground)
            if (!inAutocanonizer) {
                Text("Total Beats: ${playback.beatsPlayed}", color = MaterialTheme.colorScheme.onBackground)
            }
        }
    }
}

private fun playActionLabelForState(playback: PlaybackState): String {
    return when {
        playback.isRunning -> "Pause"
        playback.isPaused -> "Resume"
        else -> "Play"
    }
}

internal enum class ListenContentMode {
    Cast,
    LocalReady,
    Empty,
    None
}

internal fun resolveListenContentMode(playback: PlaybackState): ListenContentMode {
    return when {
        playback.isCasting -> ListenContentMode.Cast
        playback.audioLoaded && playback.analysisLoaded -> ListenContentMode.LocalReady
        !playback.analysisInFlight &&
            !playback.analysisCalculating &&
            !playback.audioLoading &&
            playback.analysisErrorMessage.isNullOrBlank() -> ListenContentMode.Empty
        else -> ListenContentMode.None
    }
}

@Composable
private fun LoadingStatus(
    progress: Int?,
    label: String?,
    showCancel: Boolean = false,
    onCancel: () -> Unit = {}
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier.size(72.dp),
            contentAlignment = Alignment.Center
        ) {
            val themeTokens = LocalThemeTokens.current
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                color = themeTokens.onBackground,
                trackColor = themeTokens.onBackground.copy(alpha = 0.2f),
                strokeWidth = 2.dp
            )
        }
        if (progress != null) {
            Text(
                text = "${progress}%",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onBackground
            )
        }
        if (!label.isNullOrBlank()) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (showCancel) {
            OutlinedButton(
                onClick = onCancel,
                colors = pillOutlinedButtonColors(),
                border = pillButtonBorder(),
                shape = PillShape,
                contentPadding = SmallButtonPadding,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .height(SmallButtonHeight)
            ) {
                Text("Cancel Analysis", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun ErrorStatus(
    message: String,
    showRetry: Boolean,
    onRetry: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (showRetry) {
            IconButton(
                onClick = onRetry,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .size(SmallButtonHeight)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Refresh,
                    contentDescription = "Retry",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

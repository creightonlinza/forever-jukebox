package com.foreverjukebox.app.ui

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import com.foreverjukebox.app.ui.LocalThemeTokens
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.foreverjukebox.app.data.AppPreferences
import com.foreverjukebox.app.data.ThemeMode
import com.foreverjukebox.app.engine.JukeboxState
import com.foreverjukebox.app.playback.PlaybackControllerHolder
import com.foreverjukebox.app.visualization.AutocanonizerVisualization
import com.foreverjukebox.app.visualization.JukeboxVisualization
import com.foreverjukebox.app.visualization.JumpLine
import com.foreverjukebox.app.visualization.positioners
import com.foreverjukebox.app.visualization.visualizationLabels

class FullscreenActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        val initialVizIndex = intent.getIntExtra(EXTRA_VIZ_INDEX, 0)
        val initialMode = intent.getStringExtra(EXTRA_MODE)?.let { raw ->
            runCatching { PlaybackMode.valueOf(raw) }.getOrNull()
        } ?: PlaybackMode.Jukebox
        setContent {
            val prefs = remember { AppPreferences(this) }
            val themeMode by prefs.themeMode.collectAsState(initial = ThemeMode.System)
            ForeverJukeboxTheme(mode = themeMode) {
                FullscreenScreen(
                    initialVizIndex = initialVizIndex,
                    initialMode = initialMode,
                    onExit = { selectedIndex, selectedMode ->
                        val result = Intent()
                            .putExtra(EXTRA_RESULT_VIZ_INDEX, selectedIndex)
                            .putExtra(EXTRA_RESULT_MODE, selectedMode.name)
                        setResult(RESULT_OK, result)
                        finish()
                    }
                )
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemBars()
        }
    }

    private fun hideSystemBars() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    companion object {
        const val EXTRA_VIZ_INDEX = "com.foreverjukebox.app.viz_index"
        const val EXTRA_RESULT_VIZ_INDEX = "com.foreverjukebox.app.viz_index_result"
        const val EXTRA_MODE = "com.foreverjukebox.app.play_mode"
        const val EXTRA_RESULT_MODE = "com.foreverjukebox.app.play_mode_result"
    }
}

@Composable
private fun FullscreenScreen(
    initialVizIndex: Int,
    initialMode: PlaybackMode,
    onExit: (Int, PlaybackMode) -> Unit
) {
    val context = LocalContext.current
    val controller = remember { PlaybackControllerHolder.get(context) }
    val engine = controller.engine
    val view = LocalView.current
    val vizLabels = visualizationLabels
    var activeVizIndex by rememberSaveable { mutableStateOf(initialVizIndex) }
    var playMode by rememberSaveable { mutableStateOf(initialMode) }
    var vizData by remember { mutableStateOf(engine.getVisualizationData()) }
    var canonizerData by remember { mutableStateOf(controller.autocanonizer.getData()) }
    var canonizerTileColorOverrides by remember { mutableStateOf(controller.autocanonizer.getTileColorOverrides()) }
    var currentBeatIndex by remember { mutableStateOf(-1) }
    var canonizerOtherIndex by remember { mutableStateOf<Int?>(null) }
    var jumpLine by remember { mutableStateOf<JumpLine?>(null) }
    var showVizMenu by remember { mutableStateOf(false) }
    var showModeMenu by remember { mutableStateOf(false) }
    var beatsPlayed by remember { mutableStateOf(0) }
    var listenTime by remember { mutableStateOf("00:00:00") }

    BackHandler {
        onExit(activeVizIndex, playMode)
    }

    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    DisposableEffect(engine) {
        val listener: (JukeboxState) -> Unit = { state ->
            currentBeatIndex = state.currentBeatIndex
            beatsPlayed = state.beatsPlayed
            val lastJumpFrom = state.lastJumpFromIndex
            if (state.lastJumped && lastJumpFrom != null) {
                jumpLine = JumpLine(lastJumpFrom, state.currentBeatIndex, SystemClock.elapsedRealtime())
            }
        }
        engine.onUpdate(listener)
        onDispose { engine.removeUpdateListener(listener) }
    }

    LaunchedEffect(Unit) {
        vizData = engine.getVisualizationData()
        canonizerData = controller.autocanonizer.getData()
        canonizerTileColorOverrides = controller.autocanonizer.getTileColorOverrides()
    }

    LaunchedEffect(Unit) {
        while (true) {
            listenTime = formatDuration(controller.getListenTimeSeconds())
            if (playMode == PlaybackMode.Autocanonizer) {
                currentBeatIndex = controller.autocanonizer.getCurrentIndex()
                canonizerOtherIndex = controller.autocanonizer.getForcedOtherIndex()
                canonizerTileColorOverrides = controller.autocanonizer.getTileColorOverrides()
                beatsPlayed = controller.autocanonizer.getBeatsPlayed()
                canonizerData = controller.autocanonizer.getData()
            }
            delay(200)
        }
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(LocalThemeTokens.current.vizBackground)
    ) {
        val squareSize = minOf(this.maxWidth, this.maxHeight)
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            if (playMode == PlaybackMode.Autocanonizer) {
                AutocanonizerVisualization(
                    data = canonizerData,
                    currentIndex = currentBeatIndex,
                    forcedOtherIndex = canonizerOtherIndex,
                    tileColorOverrides = canonizerTileColorOverrides,
                    onSelectBeat = { index ->
                        controller.autocanonizer.resetVisualization()
                        if (controller.autocanonizer.startAtIndex(index)) {
                            controller.startExternalPlayback(resetTimers = true)
                            currentBeatIndex = index
                            canonizerTileColorOverrides = controller.autocanonizer.getTileColorOverrides()
                        }
                    },
                    modifier = Modifier.size(squareSize)
                )
            } else {
                JukeboxVisualization(
                    data = vizData,
                    currentIndex = currentBeatIndex,
                    jumpLine = jumpLine,
                    positioner = positioners.getOrNull(activeVizIndex) ?: positioners.first(),
                    onSelectBeat = { index ->
                        if (!controller.seekToBeat(index, vizData)) return@JukeboxVisualization
                        currentBeatIndex = index
                    },
                    modifier = Modifier.size(squareSize)
                )
            }
        }

        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .windowInsetsPadding(WindowInsets.systemBars)
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box {
                OutlinedButton(
                    onClick = { showModeMenu = true },
                    colors = pillOutlinedButtonColors(),
                    border = pillButtonBorder(),
                    shape = PillShape,
                    modifier = Modifier.height(36.dp)
                ) {
                    Text(if (playMode == PlaybackMode.Autocanonizer) "Autocanonizer" else "Jukebox")
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
                        text = { Text("Jukebox") },
                        onClick = {
                            playMode = PlaybackMode.Jukebox
                            showModeMenu = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Autocanonizer") },
                        onClick = {
                            playMode = PlaybackMode.Autocanonizer
                            showModeMenu = false
                        }
                    )
                }
            }
        }

        if (playMode == PlaybackMode.Jukebox) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .windowInsetsPadding(WindowInsets.systemBars)
                    .padding(18.dp)
            ) {
                OutlinedButton(
                    onClick = { showVizMenu = true },
                    colors = pillOutlinedButtonColors(),
                    border = pillButtonBorder(),
                    shape = PillShape,
                    modifier = Modifier.height(36.dp)
                ) {
                    Text(vizLabels.getOrNull(activeVizIndex) ?: "Select")
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
                                activeVizIndex = index
                                showVizMenu = false
                            }
                        )
                    }
                }
            }
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.systemBars)
                .padding(horizontal = 18.dp, vertical = 16.dp)
        ) {
            val title = controller.getTrackTitle().orEmpty()
            val artist = controller.getTrackArtist().orEmpty()
            val nowPlaying = when {
                title.isNotBlank() && artist.isNotBlank() -> "$title - $artist"
                title.isNotBlank() -> title
                else -> "The Forever Jukebox"
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = nowPlaying,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (playMode == PlaybackMode.Autocanonizer) {
                            "Listen Time: $listenTime"
                        } else {
                            "Listen Time: $listenTime · Total Beats: $beatsPlayed"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(
                    onClick = { onExit(activeVizIndex, playMode) },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        Icons.Default.FullscreenExit,
                        contentDescription = "Exit fullscreen",
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

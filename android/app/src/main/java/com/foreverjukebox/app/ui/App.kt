package com.foreverjukebox.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.foreverjukebox.app.data.FavoriteSourceType
import com.foreverjukebox.app.data.TOP_SONGS_LIMIT

@Composable
fun ForeverJukeboxApp(viewModel: MainViewModel) {
    val state by viewModel.state.collectAsState()
    ForeverJukeboxTheme(mode = state.themeMode) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(16.dp)
        ) {
            if (state.showAppModeGate) {
                TitleOnlyHeaderBar()
            } else {
                HeaderBar(
                    state = state,
                    onEditBaseUrl = { viewModel.setBaseUrl(it) },
                    onThemeChange = viewModel::setThemeMode,
                    onAppModeChange = viewModel::setAppMode,
                    onRefreshCacheSize = viewModel::refreshCacheSize,
                    onClearCache = viewModel::clearCache,
                    onTabSelected = viewModel::setActiveTab,
                    onCastSessionStarted = {}
                )
                Spacer(modifier = Modifier.height(12.dp))

                when (state.activeTab) {
                    TabId.Input -> InputPanel(
                        state = state,
                        onOpenFile = viewModel::startLocalAnalysis
                    )
                    TabId.Top -> TopSongsPanel(
                        items = state.search.topSongs,
                        risingItems = state.search.risingSongs,
                        recentItems = state.search.recentSongs,
                        favorites = state.favorites,
                        loading = state.search.topSongsLoading,
                        risingLoading = state.search.risingSongsLoading,
                        recentLoading = state.search.recentSongsLoading,
                        topSongsLimit = TOP_SONGS_LIMIT,
                        activeTab = state.topSongsTab,
                        onTabSelected = viewModel::setTopSongsTab,
                        onSelect = { id, title, artist, tuningParams, sourceType ->
                            when (sourceType) {
                                FavoriteSourceType.Upload ->
                                    viewModel.loadTrackByJobId(id, title, artist, tuningParams)
                                FavoriteSourceType.Youtube ->
                                    viewModel.loadTrackByYoutubeId(id, title, artist, tuningParams)
                            }
                        },
                        onRemoveFavorite = viewModel::removeFavorite,
                        favoritesSyncCode = state.favoritesSyncCode,
                        allowFavoritesSync = state.allowFavoritesSync,
                        onRefreshSync = viewModel::refreshFavoritesFromSync,
                        onCreateSync = viewModel::createFavoritesSyncCode,
                        onFetchSync = viewModel::fetchFavoritesPreview,
                        onApplySync = viewModel::applyFavoritesSync
                    )
                    TabId.Search -> SearchPanel(
                        state = state,
                        onSearch = viewModel::runSpotifySearch,
                        onSpotifySelect = viewModel::selectSpotifyTrack,
                        onYoutubeSelect = viewModel::startYoutubeAnalysis
                    )
                    TabId.Play -> PlayPanel(state = state, viewModel = viewModel)
                    TabId.Faq -> FaqPanel()
                }
            }
        }

        if (state.showAppModeGate) {
            AppModeDialog(
                initialMode = defaultOnboardingMode,
                initialValue = state.baseUrl,
                onConfirm = viewModel::completeAppModeOnboarding
            )
        }
    }
}

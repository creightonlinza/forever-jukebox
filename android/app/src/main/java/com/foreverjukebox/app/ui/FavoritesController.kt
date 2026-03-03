package com.foreverjukebox.app.ui

import com.foreverjukebox.app.data.AppPreferences
import com.foreverjukebox.app.data.ApiClient
import com.foreverjukebox.app.data.FavoriteTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class FavoritesController(
    private val scope: CoroutineScope,
    private val api: ApiClient,
    private val preferences: AppPreferences,
    private val getState: () -> UiState,
    private val updateState: ((UiState) -> UiState) -> Unit,
    private val showToast: suspend (String) -> Unit
) {
    private var favoritesSyncHydratedFor: String? = null
    private var pendingSyncDelta: FavoritesDelta? = null
    private var syncInFlight = false

    fun refreshFavoritesFromSync() {
        scope.launch {
            val state = getState()
            if (!state.allowFavoritesSync) {
                showToast("Favorites sync is disabled.")
                return@launch
            }
            if (state.favoritesSyncCode.isNullOrBlank()) {
                showToast("Create or enter a sync code first.")
                return@launch
            }
            updateState { it.copy(favoritesSyncLoading = true) }
            try {
                val result = fetchFavoritesFromSync()
                if (result == null) {
                    showToast("Favorites sync failed.")
                } else {
                    updateFavorites(result, sync = false)
                    favoritesSyncHydratedFor = state.favoritesSyncCode
                    showToast("Favorites refreshed.")
                }
            } finally {
                updateState { it.copy(favoritesSyncLoading = false) }
            }
        }
    }

    fun createFavoritesSyncCode() {
        scope.launch {
            val state = getState()
            if (!state.allowFavoritesSync) {
                showToast("Favorites sync is disabled.")
                return@launch
            }
            val baseUrl = state.baseUrl
            if (baseUrl.isBlank()) {
                showToast("API base URL is required.")
                return@launch
            }
            try {
                val favorites = state.favorites
                val response = api.createFavoritesSync(baseUrl, favorites)
                val code = response.code ?: return@launch
                preferences.setFavoritesSyncCode(code)
                favoritesSyncHydratedFor = code
                val normalized = normalizeFavorites(response.favorites)
                if (normalized.isNotEmpty()) {
                    updateFavorites(normalized, sync = false)
                }
                showToast("Favorites synced.")
            } catch (_: Exception) {
                showToast("Favorites sync failed.")
            }
        }
    }

    suspend fun fetchFavoritesPreview(code: String): List<FavoriteTrack>? {
        return fetchFavoritesFromSync(code)
    }

    fun applyFavoritesSync(code: String, favorites: List<FavoriteTrack>) {
        scope.launch {
            val state = getState()
            if (!state.allowFavoritesSync) {
                showToast("Favorites sync is disabled.")
                return@launch
            }
            preferences.setFavoritesSyncCode(code)
            favoritesSyncHydratedFor = code
            updateFavorites(normalizeFavorites(favorites), sync = false)
        }
    }

    fun updateFavorites(favorites: List<FavoriteTrack>, sync: Boolean = true) {
        val previous = getState().favorites
        val sorted = sortFavorites(favorites).take(MAX_FAVORITES)
        updateState { it.copy(favorites = sorted) }
        scope.launch {
            preferences.setFavorites(sorted)
        }
        if (!sync) {
            return
        }
        val delta = computeFavoritesDelta(previous, sorted)
        if (delta.isNoop()) {
            return
        }
        scheduleFavoritesSync(delta)
    }

    fun maybeHydrateFavoritesFromSync() {
        val state = getState()
        val code = state.favoritesSyncCode
        val baseUrl = state.baseUrl
        if (code.isNullOrBlank() || baseUrl.isBlank() || !state.allowFavoritesSync) {
            return
        }
        if (favoritesSyncHydratedFor == code) {
            return
        }
        favoritesSyncHydratedFor = code
        scope.launch {
            val favorites = fetchFavoritesFromSync(code)
            if (favorites == null) {
                favoritesSyncHydratedFor = null
                showToast("Favorites sync failed.")
                return@launch
            }
            updateFavorites(favorites, sync = false)
        }
    }

    private fun scheduleFavoritesSync(delta: FavoritesDelta) {
        val state = getState()
        if (!state.allowFavoritesSync) {
            return
        }
        val code = state.favoritesSyncCode ?: return
        if (syncInFlight) {
            pendingSyncDelta = delta
            return
        }
        syncInFlight = true
        scope.launch {
            syncFavoritesToBackend(code, delta)
        }
    }

    private suspend fun syncFavoritesToBackend(code: String, delta: FavoritesDelta) {
        try {
            val state = getState()
            if (!state.allowFavoritesSync) {
                return
            }
            val baseUrl = state.baseUrl
            if (baseUrl.isBlank()) return
            val serverFavorites = fetchFavoritesFromSync(code) ?: return
            val merged = applyFavoritesDelta(serverFavorites, delta)
            val response = api.updateFavoritesSync(baseUrl, code, merged)
            val normalized = normalizeFavorites(response.favorites)
            if (normalized.isNotEmpty()) {
                updateFavorites(normalized, sync = false)
            }
        } catch (_: Exception) {
            showToast("Favorites sync failed.")
        } finally {
            syncInFlight = false
            val pending = pendingSyncDelta
            pendingSyncDelta = null
            if (pending != null && !pending.isNoop()) {
                scheduleFavoritesSync(pending)
            }
        }
    }

    private fun computeFavoritesDelta(
        previous: List<FavoriteTrack>,
        next: List<FavoriteTrack>
    ): FavoritesDelta {
        val prevMap = previous.associateBy { it.uniqueSongId }
        val nextMap = next.associateBy { it.uniqueSongId }
        val added = next.filter { !prevMap.containsKey(it.uniqueSongId) }
        val removedIds = prevMap.keys.filterNot { nextMap.containsKey(it) }.toSet()
        return FavoritesDelta(added = added, removedIds = removedIds)
    }

    private fun applyFavoritesDelta(
        serverFavorites: List<FavoriteTrack>,
        delta: FavoritesDelta
    ): List<FavoriteTrack> {
        val filtered = serverFavorites.filter { it.uniqueSongId !in delta.removedIds }
        val merged = filtered + delta.added.filter { added ->
            filtered.none { it.uniqueSongId == added.uniqueSongId }
        }
        return sortFavorites(merged).take(MAX_FAVORITES)
    }

    fun normalizeFavorites(items: List<FavoriteTrack>): List<FavoriteTrack> {
        val normalized = items.mapNotNull { item ->
            val id = item.uniqueSongId
            if (id.isBlank()) return@mapNotNull null
            item.copy(
                title = item.title.ifBlank { "Untitled" },
                artist = item.artist,
                tuningParams = TuningParamsCodec.stripHighlightAnchorParam(item.tuningParams)
            )
        }
        return sortFavorites(normalized).take(MAX_FAVORITES)
    }

    private suspend fun fetchFavoritesFromSync(codeOverride: String? = null): List<FavoriteTrack>? {
        val state = getState()
        if (!state.allowFavoritesSync) return null
        val baseUrl = state.baseUrl
        if (baseUrl.isBlank()) return null
        val code = codeOverride ?: state.favoritesSyncCode
        if (code.isNullOrBlank()) return null
        return try {
            api.fetchFavoritesSync(baseUrl, code.trim())
        } catch (_: Exception) {
            null
        }
    }

    fun sortFavorites(items: List<FavoriteTrack>): List<FavoriteTrack> {
        val deduped = items.distinctBy { it.uniqueSongId }
        return deduped.sortedWith(
            compareBy<FavoriteTrack, String>(String.CASE_INSENSITIVE_ORDER) { it.title }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.artist }
        )
    }

    companion object {
        private const val MAX_FAVORITES = 100
    }
}

private data class FavoritesDelta(
    val added: List<FavoriteTrack>,
    val removedIds: Set<String>
)

private fun FavoritesDelta.isNoop(): Boolean {
    return added.isEmpty() && removedIds.isEmpty()
}

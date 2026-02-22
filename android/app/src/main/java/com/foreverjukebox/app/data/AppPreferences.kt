package com.foreverjukebox.app.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.foreverjukebox.app.visualization.defaultVisualizationIndex
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "fj_preferences")

enum class ThemeMode {
    System,
    Light,
    Dark
}

class AppPreferences(private val context: Context) {
    companion object {
        private val KEY_BASE_URL = stringPreferencesKey("base_url")
        private val KEY_APP_MODE = stringPreferencesKey("app_mode")
        private val KEY_THEME = stringPreferencesKey("theme")
        private val KEY_VIZ_INDEX = intPreferencesKey("viz_index")
        private val KEY_FAVORITES = stringPreferencesKey("favorites")
        private val KEY_FAVORITES_SYNC_CODE = stringPreferencesKey("favorites_sync_code")
        private val KEY_APP_CONFIG = stringPreferencesKey("app_config")
        private val KEY_CANONIZER_FINISH = booleanPreferencesKey("canonizer_finish_out_song")
    }

    private val json = Json { ignoreUnknownKeys = true }

    val baseUrl: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[KEY_BASE_URL]
    }

    val appMode: Flow<AppMode?> = context.dataStore.data.map { prefs ->
        appModeFromString(prefs[KEY_APP_MODE])
    }

    val themeMode: Flow<ThemeMode> = context.dataStore.data.map { prefs ->
        themeFromString(prefs[KEY_THEME])
    }

    val activeVizIndex: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[KEY_VIZ_INDEX] ?: defaultVisualizationIndex
    }

    val favorites: Flow<List<FavoriteTrack>> = context.dataStore.data.map { prefs ->
        decodeFavorites(prefs[KEY_FAVORITES])
    }

    val favoritesSyncCode: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[KEY_FAVORITES_SYNC_CODE]
    }

    val appConfig: Flow<AppConfigResponse?> = context.dataStore.data.map { prefs ->
        val raw = prefs[KEY_APP_CONFIG] ?: return@map null
        runCatching { json.decodeFromString<AppConfigResponse>(raw) }.getOrNull()
    }

    val canonizerFinishOutSong: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_CANONIZER_FINISH] ?: false
    }

    suspend fun setBaseUrl(url: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_BASE_URL] = url
        }
    }

    suspend fun setAppMode(mode: AppMode) {
        context.dataStore.edit { prefs ->
            prefs[KEY_APP_MODE] = mode.name
        }
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.dataStore.edit { prefs ->
            prefs[KEY_THEME] = mode.name
        }
    }

    suspend fun setActiveVizIndex(index: Int) {
        context.dataStore.edit { prefs ->
            prefs[KEY_VIZ_INDEX] = index
        }
    }

    suspend fun setFavorites(items: List<FavoriteTrack>) {
        context.dataStore.edit { prefs ->
            val payload = json.encodeToString(ListSerializer(FavoriteTrack.serializer()), items)
            prefs[KEY_FAVORITES] = payload
        }
    }

    suspend fun setFavoritesSyncCode(code: String?) {
        context.dataStore.edit { prefs ->
            if (code.isNullOrBlank()) {
                prefs.remove(KEY_FAVORITES_SYNC_CODE)
            } else {
                prefs[KEY_FAVORITES_SYNC_CODE] = code.trim().lowercase()
            }
        }
    }

    suspend fun setAppConfig(config: AppConfigResponse) {
        context.dataStore.edit { prefs ->
            prefs[KEY_APP_CONFIG] = json.encodeToString(config)
        }
    }

    suspend fun setCanonizerFinishOutSong(enabled: Boolean) {
        context.dataStore.edit { prefs ->
            prefs[KEY_CANONIZER_FINISH] = enabled
        }
    }

    private fun decodeFavorites(raw: String?): List<FavoriteTrack> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            json.decodeFromString(ListSerializer(FavoriteTrack.serializer()), raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun themeFromString(raw: String?): ThemeMode {
        return when (raw) {
            ThemeMode.System.name -> ThemeMode.System
            ThemeMode.Light.name -> ThemeMode.Light
            ThemeMode.Dark.name -> ThemeMode.Dark
            else -> ThemeMode.System
        }
    }

    private fun appModeFromString(raw: String?): AppMode? {
        return when (raw) {
            AppMode.Local.name -> AppMode.Local
            AppMode.Server.name -> AppMode.Server
            else -> null
        }
    }
}

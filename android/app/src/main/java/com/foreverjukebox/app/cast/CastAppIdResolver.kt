package com.foreverjukebox.app.cast

import android.content.Context
import android.net.Uri
import org.json.JSONObject

object CastAppIdResolver {
    @Volatile
    private var cachedMap: Map<String, String>? = null

    fun resolve(context: Context, baseUrl: String?): String? {
        val normalized = normalize(baseUrl) ?: return null
        val map = cachedMap ?: loadMap(context).also { cachedMap = it }
        return map[normalized]
    }

    // CastContext is initialized once per app process via OptionsProvider and is not re-created
    // when the API base URL changes. We fall back to any configured receiver app ID here so
    // early startup (before preferences load) still uses a custom receiver. If you need different
    // receiver app IDs per base URL, the app must be restarted after changing base URL.
    fun resolveAny(context: Context): String? {
        val map = cachedMap ?: loadMap(context).also { cachedMap = it }
        return map.values.firstOrNull()
    }

    fun normalize(baseUrl: String?): String? {
        val trimmed = baseUrl?.trim()?.trimEnd('/') ?: return null
        if (trimmed.isBlank()) return null
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return trimmed
        val scheme = uri.scheme?.lowercase() ?: return trimmed
        val host = uri.host?.lowercase() ?: return trimmed
        val port = if (uri.port != -1) ":${uri.port}" else ""
        val path = uri.encodedPath?.trimEnd('/')?.takeIf { it.isNotBlank() && it != "/" } ?: ""
        return "$scheme://$host$port$path"
    }

    private fun loadMap(context: Context): Map<String, String> {
        return try {
            val raw = context.assets.open("cast_app_ids.json").bufferedReader().use { it.readText() }
            val json = JSONObject(raw)
            val result = mutableMapOf<String, String>()
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = json.optString(key, "").trim()
                if (value.isNotBlank()) {
                    normalize(key)?.let { normalizedKey ->
                        result[normalizedKey] = value
                    }
                }
            }
            result
        } catch (_: Exception) {
            emptyMap()
        }
    }
}

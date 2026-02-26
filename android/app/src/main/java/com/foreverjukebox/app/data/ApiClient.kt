package com.foreverjukebox.app.data
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiClient(private val json: Json = Json { ignoreUnknownKeys = true }) {
    private val jsonWithDefaults = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val client = sharedClient

    suspend fun searchSpotify(baseUrl: String, query: String): List<SpotifySearchItem> {
        val url = buildUrl(baseUrl, ApiPaths.SEARCH_SPOTIFY) {
            addQueryParameter("q", query)
        }
        return getJson<SearchResponse<SpotifySearchItem>>(url).items
    }

    suspend fun searchYoutube(
        baseUrl: String,
        query: String,
        duration: Double
    ): List<YoutubeSearchItem> {
        val url = buildUrl(baseUrl, ApiPaths.SEARCH_YOUTUBE) {
            addQueryParameter("q", query)
            addQueryParameter("target_duration", duration.toString())
        }
        return getJson<SearchResponse<YoutubeSearchItem>>(url).items
    }

    suspend fun startYoutubeAnalysis(
        baseUrl: String,
        youtubeId: String,
        title: String?,
        artist: String?
    ): AnalysisStartResponse {
        val url = buildUrl(baseUrl, ApiPaths.ANALYSIS_YOUTUBE)
        val body = AnalysisStartRequest(youtubeId, title, artist)
        val payload = json.encodeToString(body)
        return postJson(url, payload).let { json.decodeFromString(it) }
    }

    suspend fun getAnalysis(baseUrl: String, jobId: String): AnalysisResponse {
        val url = buildUrl(baseUrl, ApiPaths.analysisJob(jobId))
        return getJson(url)
    }

    suspend fun getJobByYoutube(baseUrl: String, youtubeId: String): AnalysisResponse {
        val url = buildUrl(baseUrl, ApiPaths.jobByYoutube(youtubeId))
        return getJson(url)
    }

    suspend fun getJobByTrack(baseUrl: String, title: String, artist: String): AnalysisResponse {
        val url = buildUrl(baseUrl, ApiPaths.JOB_BY_TRACK) {
            addQueryParameter("title", title)
            addQueryParameter("artist", artist)
        }
        return getJson(url)
    }

    suspend fun fetchTopSongs(baseUrl: String, limit: Int = TOP_SONGS_LIMIT): List<TopSongItem> {
        val url = buildUrl(baseUrl, ApiPaths.TOP) {
            addQueryParameter("limit", limit.toString())
        }
        return getJson<TopSongsResponse>(url).items
    }

    suspend fun fetchRisingSongs(baseUrl: String): List<TopSongItem> {
        val url = buildUrl(baseUrl, ApiPaths.TOP) {
            addQueryParameter("limit", RISING_LIMIT.toString())
            addQueryParameter("days", RISING_DAYS.toString())
            addQueryParameter("exclude_top_n", RISING_EXCLUDE_TOP_N.toString())
        }
        return getJson<TopSongsResponse>(url).items
    }

    suspend fun fetchRecentSongs(baseUrl: String, limit: Int = TOP_SONGS_LIMIT): List<TopSongItem> {
        val url = buildUrl(baseUrl, ApiPaths.RECENT) {
            addQueryParameter("limit", limit.toString())
        }
        return getJson<TopSongsResponse>(url).items
    }

    suspend fun createFavoritesSync(
        baseUrl: String,
        favorites: List<FavoriteTrack>
    ): FavoritesSyncResponse {
        val url = buildUrl(baseUrl, ApiPaths.FAVORITES_SYNC)
        val trimmed = favorites.take(MAX_FAVORITES)
        val payload = jsonWithDefaults.encodeToString(FavoritesSyncRequest(trimmed))
        return postJson(url, payload).let { json.decodeFromString(it) }
    }

    suspend fun updateFavoritesSync(
        baseUrl: String,
        code: String,
        favorites: List<FavoriteTrack>
    ): FavoritesSyncResponse {
        val url = buildUrl(baseUrl, ApiPaths.favoritesSync(code))
        val trimmed = favorites.take(MAX_FAVORITES)
        val payload = jsonWithDefaults.encodeToString(FavoritesSyncRequest(trimmed))
        return putJson(url, payload).let { json.decodeFromString(it) }
    }

    suspend fun fetchFavoritesSync(baseUrl: String, code: String): List<FavoriteTrack> {
        val url = buildUrl(baseUrl, ApiPaths.favoritesSync(code))
        return getJson<FavoritesSyncPayload>(url).favorites
    }

    suspend fun getAppConfig(baseUrl: String): AppConfigResponse {
        val url = buildUrl(baseUrl, ApiPaths.APP_CONFIG)
        return getJson(url)
    }

    suspend fun postPlay(baseUrl: String, jobId: String) {
        val url = buildUrl(baseUrl, ApiPaths.play(jobId))
        postEmpty(url)
    }

    suspend fun fetchAudioToFile(baseUrl: String, jobId: String, target: File): File {
        val url = buildUrl(baseUrl, ApiPaths.audio(jobId))
        return getToFile(url, target)
    }

    suspend fun repairJob(baseUrl: String, jobId: String): AnalysisResponse {
        val url = buildUrl(baseUrl, ApiPaths.repair(jobId))
        return postEmptyJson(url).let { json.decodeFromString(it) }
    }

    suspend fun deleteJob(baseUrl: String, jobId: String) {
        val url = buildUrl(baseUrl, ApiPaths.job(jobId))
        deleteEmpty(url)
    }

    suspend fun fetchLatestGitHubRelease(
        owner: String,
        repo: String
    ): GitHubReleaseResponse {
        val url = "https://api.github.com/repos/$owner/$repo/releases/latest"
        return getGitHubJson(url)
    }

    private suspend fun get(url: String): String = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
            response.body?.string() ?: ""
        }
    }

    private suspend fun getToFile(url: String, target: File): File = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
            val body = response.body ?: throw IOException("Empty response body")
            target.outputStream().use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                    }
                }
            }
            target
        }
    }

    private suspend fun postJson(url: String, payload: String): String = withContext(Dispatchers.IO) {
        val body = payload.toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(url).post(body).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
            response.body?.string() ?: ""
        }
    }

    private suspend fun putJson(url: String, payload: String): String = withContext(Dispatchers.IO) {
        val body = payload.toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(url).put(body).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
            response.body?.string() ?: ""
        }
    }

    private suspend fun postEmpty(url: String) = withContext(Dispatchers.IO) {
        val body = ByteArray(0).toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(url).post(body).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
        }
    }

    private suspend fun postEmptyJson(url: String): String = withContext(Dispatchers.IO) {
        val body = ByteArray(0).toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(url).post(body).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
            response.body?.string() ?: ""
        }
    }

    private suspend fun deleteEmpty(url: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).delete().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
        }
    }

    private fun buildUrl(
        baseUrl: String,
        pathSegments: List<String>,
        builder: (HttpUrl.Builder.() -> Unit)? = null
    ): String {
        val normalized = baseUrl.trimEnd('/')
        val base = normalized.toHttpUrlOrNull()
            ?: throw IllegalArgumentException("Invalid base URL")
        val urlBuilder = base.newBuilder()
        pathSegments.forEach { urlBuilder.addPathSegment(it) }
        builder?.invoke(urlBuilder)
        return urlBuilder.build().toString()
    }

    private suspend inline fun <reified T> getJson(url: String): T {
        val response = get(url)
        return json.decodeFromString(response)
    }

    private suspend inline fun <reified T> getGitHubJson(url: String): T = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "ForeverJukebox-Android")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("HTTP ${response.code}")
            }
            val body = response.body?.string() ?: ""
            json.decodeFromString(body)
        }
    }

    private object ApiPaths {
        val SEARCH_SPOTIFY = listOf("api", "search", "spotify")
        val SEARCH_YOUTUBE = listOf("api", "search", "youtube")
        val ANALYSIS_YOUTUBE = listOf("api", "analysis", "youtube")
        val JOB_BY_TRACK = listOf("api", "jobs", "by-track")
        val TOP = listOf("api", "top")
        val RECENT = listOf("api", "recent")
        val APP_CONFIG = listOf("api", "app-config")
        val FAVORITES_SYNC = listOf("api", "favorites", "sync")

        fun analysisJob(jobId: String) = listOf("api", "analysis", jobId)
        fun jobByYoutube(youtubeId: String) = listOf("api", "jobs", "by-youtube", youtubeId)
        fun job(jobId: String) = listOf("api", "jobs", jobId)
        fun play(jobId: String) = listOf("api", "plays", jobId)
        fun audio(jobId: String) = listOf("api", "audio", jobId)
        fun repair(jobId: String) = listOf("api", "repair", jobId)
        fun favoritesSync(code: String) = listOf("api", "favorites", "sync", code)
    }

    companion object {
        private const val MAX_FAVORITES = 100
        private const val RISING_LIMIT = 10
        private const val RISING_DAYS = 7
        private const val RISING_EXCLUDE_TOP_N = 25
        private val sharedClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

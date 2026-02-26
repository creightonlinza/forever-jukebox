package com.foreverjukebox.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class SpotifySearchItem(
    val id: String? = null,
    val name: String? = null,
    val artist: String? = null,
    val duration: Double? = null
)

@Serializable
data class YoutubeSearchItem(
    val id: String? = null,
    val title: String? = null,
    val duration: Double? = null
)

@Serializable
data class SearchResponse<T>(
    val items: List<T> = emptyList()
)

@Serializable
data class AnalysisStartRequest(
    @SerialName("youtube_id") val youtubeId: String,
    val title: String? = null,
    val artist: String? = null
)

@Serializable
data class AnalysisStartResponse(
    val id: String? = null,
    val status: String? = null,
    val progress: Double? = null,
    val message: String? = null
)

@Serializable
data class AnalysisResponse(
    val id: String? = null,
    val status: String? = null,
    val progress: Double? = null,
    val message: String? = null,
    @SerialName("youtube_id") val youtubeId: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    val result: JsonElement? = null,
    val error: String? = null,
    @SerialName("error_code") val errorCode: String? = null
)

@Serializable
data class AppConfigResponse(
    @SerialName("allow_user_upload") val allowUserUpload: Boolean = false,
    @SerialName("allow_user_youtube") val allowUserYoutube: Boolean = false,
    @SerialName("allow_favorites_sync") val allowFavoritesSync: Boolean = false,
    @SerialName("max_upload_size") val maxUploadSize: Int? = null,
    @SerialName("allowed_upload_exts") val allowedUploadExts: List<String>? = null
)

@Serializable
data class TopSongItem(
    val id: String? = null,
    @SerialName("youtube_id") val youtubeId: String? = null,
    val title: String? = null,
    val artist: String? = null,
    @SerialName("play_count") val playCount: Int? = null
)

@Serializable
data class TopSongsResponse(
    val items: List<TopSongItem> = emptyList()
)

@Serializable
data class FavoritesSyncRequest(
    val favorites: List<FavoriteTrack> = emptyList()
)

@Serializable
data class FavoritesSyncResponse(
    val code: String? = null,
    val count: Int? = null,
    val favorites: List<FavoriteTrack> = emptyList()
)

@Serializable
data class FavoritesSyncPayload(
    val favorites: List<FavoriteTrack> = emptyList()
)

@Serializable
data class GitHubReleaseResponse(
    @SerialName("tag_name") val tagName: String? = null,
    @SerialName("html_url") val htmlUrl: String? = null
)

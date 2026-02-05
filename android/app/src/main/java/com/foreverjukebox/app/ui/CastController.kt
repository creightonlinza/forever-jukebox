package com.foreverjukebox.app.ui

import android.app.Application
import com.google.android.gms.cast.Cast
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import org.json.JSONObject

class CastController(private val application: Application) {
    private var statusListenerRegistered = false

    fun resetStatusListener() {
        statusListenerRegistered = false
    }

    fun getSession(): CastSession? {
        val castContext = try {
            CastContext.getSharedInstance(application)
        } catch (_: Exception) {
            return null
        }
        return castContext.sessionManager.currentCastSession
    }

    fun endSession() {
        val castContext = try {
            CastContext.getSharedInstance(application)
        } catch (_: Exception) {
            null
        }
        castContext?.sessionManager?.endCurrentSession(true)
    }

    fun ensureStatusListener(
        session: CastSession,
        namespace: String,
        onMessage: (String) -> Unit
    ) {
        if (statusListenerRegistered) {
            return
        }
        session.setMessageReceivedCallbacks(namespace, Cast.MessageReceivedCallback { _, _, message ->
            onMessage(message)
        })
        statusListenerRegistered = true
    }

    fun requestStatus(session: CastSession, namespace: String) {
        val payload = JSONObject().apply { put("type", "getStatus") }
        runCatching { session.sendMessage(namespace, payload.toString()) }
    }

    fun sendCommand(namespace: String, command: String): Boolean {
        val session = getSession() ?: return false
        val payload = JSONObject().apply { put("type", command) }
        return try {
            session.sendMessage(namespace, payload.toString())
            true
        } catch (_: Exception) {
            false
        }
    }

    fun sendTuningParams(namespace: String, tuningParams: String?): Boolean {
        val session = getSession() ?: return false
        val payload = JSONObject().apply {
            put("type", "setTuning")
            if (tuningParams == null) {
                put("tuningParams", JSONObject.NULL)
            } else {
                put("tuningParams", tuningParams)
            }
        }
        return try {
            session.sendMessage(namespace, payload.toString())
            true
        } catch (_: Exception) {
            false
        }
    }

    fun loadTrack(
        session: CastSession,
        baseUrl: String,
        trackId: String,
        title: String?,
        artist: String?,
        tuningParams: String?
    ) {
        val normalizedBaseUrl = baseUrl.trimEnd('/')
        val customData = JSONObject().apply {
            put("baseUrl", normalizedBaseUrl)
            put("songId", trackId)
            if (!tuningParams.isNullOrBlank()) {
                put("tuningParams", tuningParams)
            }
        }
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK).apply {
            title?.let { putString(MediaMetadata.KEY_TITLE, it) }
            artist?.let { putString(MediaMetadata.KEY_ARTIST, it) }
        }
        val mediaInfo = MediaInfo.Builder("foreverjukebox://cast/$trackId")
            .setStreamType(MediaInfo.STREAM_TYPE_NONE)
            .setContentType("application/json")
            .setMetadata(metadata)
            .build()
        val request = MediaLoadRequestData.Builder()
            .setMediaInfo(mediaInfo)
            .setAutoplay(true)
            .setCustomData(customData)
            .build()
        session.remoteMediaClient?.load(request)
    }
}

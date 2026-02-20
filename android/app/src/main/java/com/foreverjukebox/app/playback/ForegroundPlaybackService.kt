package com.foreverjukebox.app.playback

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.app.NotificationCompat
import androidx.core.graphics.createBitmap
import androidx.core.graphics.drawable.IconCompat
import androidx.core.graphics.toColorInt
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import com.foreverjukebox.app.MainActivity
import com.foreverjukebox.app.R
import com.foreverjukebox.app.ui.CastController

private object PlaybackServiceConstants {
    const val CHANNEL_ID = "fj_playback"
    const val NOTIFICATION_ID = 2001
    const val ACTION_START = "com.foreverjukebox.app.playback.START"
    const val ACTION_UPDATE = "com.foreverjukebox.app.playback.UPDATE"
    const val ACTION_TOGGLE = "com.foreverjukebox.app.playback.TOGGLE"
    const val EXTRA_IS_CASTING = "com.foreverjukebox.app.playback.extra.IS_CASTING"
    const val EXTRA_CAST_IS_PLAYING = "com.foreverjukebox.app.playback.extra.CAST_IS_PLAYING"
    const val EXTRA_TRACK_TITLE = "com.foreverjukebox.app.playback.extra.TRACK_TITLE"
    const val EXTRA_TRACK_ARTIST = "com.foreverjukebox.app.playback.extra.TRACK_ARTIST"
    const val EXTRA_CAST_DEVICE_NAME = "com.foreverjukebox.app.playback.extra.CAST_DEVICE_NAME"
    const val CAST_COMMAND_NAMESPACE = "urn:x-cast:com.foreverjukebox.app"
}

private const val NOTIFICATION_ACCENT = "#4AC7FF"
private const val DEFAULT_NOTIFICATION_TITLE = "The Forever Jukebox"
private const val CAST_FALLBACK_DEVICE_LABEL = "Other device"

private enum class NotificationMode {
    Local,
    Cast
}

private data class PlaybackNotificationState(
    val mode: NotificationMode,
    val isPlaying: Boolean,
    val title: String,
    val artist: String,
    val castDeviceName: String?,
    val positionMs: Long = 0L,
    val durationMs: Long? = null
) {
    fun contentText(): String = artist

    fun subText(): String? {
        if (mode != NotificationMode.Cast) {
            return null
        }
        return castDeviceName?.takeIf { it.isNotBlank() } ?: CAST_FALLBACK_DEVICE_LABEL
    }
}

class ForegroundPlaybackService : Service() {
    private lateinit var mediaSession: MediaSessionCompat
    private val castController by lazy { CastController(application as Application) }
    private var activeNotificationState: PlaybackNotificationState? = null

    override fun onBind(intent: Intent?) = null

    override fun onCreate() {
        super.onCreate()
        mediaSession = MediaSessionCompat(this, "ForeverJukeboxPlayback").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    handlePlayPause(shouldPlay = true)
                }

                override fun onPause() {
                    handlePlayPause(shouldPlay = false)
                }

                override fun onStop() {
                    handlePlayPause(shouldPlay = false)
                }
            })
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        MediaButtonReceiver.handleIntent(mediaSession, intent)
        when (intent?.action) {
            PlaybackServiceConstants.ACTION_TOGGLE -> {
                if (intent.getBooleanExtra(PlaybackServiceConstants.EXTRA_IS_CASTING, false)) {
                    handleCastToggle(intent)
                } else {
                    val controller = PlaybackControllerHolder.get(this)
                    val isPlaying = controller.togglePlayback()
                    updateNotification(buildLocalNotificationState(isPlaying))
                }
            }
            PlaybackServiceConstants.ACTION_START, PlaybackServiceConstants.ACTION_UPDATE -> {
                val castState = intent.toCastNotificationState()
                if (castState != null) {
                    updateNotification(castState)
                } else {
                    val controller = PlaybackControllerHolder.get(this)
                    val isPlaying = controller.isPlaying()
                    updateNotification(buildLocalNotificationState(isPlaying))
                }
            }
        }
        return START_STICKY
    }

    private fun buildLocalNotificationState(isPlaying: Boolean): PlaybackNotificationState {
        val controller = PlaybackControllerHolder.get(this)
        val title = controller.getTrackTitle().orEmpty().ifBlank { DEFAULT_NOTIFICATION_TITLE }
        val artist = controller.getTrackArtist().orEmpty()
        val positionMs = controller.getPlaybackPositionMs().coerceAtLeast(0L)
        val durationMs = controller.getTrackDurationMs()?.coerceAtLeast(0L)
        return PlaybackNotificationState(
            mode = NotificationMode.Local,
            isPlaying = isPlaying,
            title = title,
            artist = artist,
            castDeviceName = null,
            positionMs = positionMs,
            durationMs = durationMs
        )
    }

    private fun Intent.toCastNotificationState(): PlaybackNotificationState? {
        if (!getBooleanExtra(PlaybackServiceConstants.EXTRA_IS_CASTING, false)) {
            return null
        }
        val title = getStringExtra(PlaybackServiceConstants.EXTRA_TRACK_TITLE)
            ?.takeIf { it.isNotBlank() }
            ?: DEFAULT_NOTIFICATION_TITLE
        val artist = getStringExtra(PlaybackServiceConstants.EXTRA_TRACK_ARTIST).orEmpty()
        val deviceName = getStringExtra(PlaybackServiceConstants.EXTRA_CAST_DEVICE_NAME)
        return PlaybackNotificationState(
            mode = NotificationMode.Cast,
            isPlaying = getBooleanExtra(PlaybackServiceConstants.EXTRA_CAST_IS_PLAYING, false),
            title = title,
            artist = artist,
            castDeviceName = deviceName
        )
    }

    private fun updateNotification(state: PlaybackNotificationState) {
        if (state.mode == NotificationMode.Local && !state.isPlaying) {
            activeNotificationState = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        activeNotificationState = state
        createChannel()
        val contentText = state.contentText()
        val artwork = if (state.mode == NotificationMode.Local) {
            loadNotificationArtwork()
        } else {
            null
        }
        if (state.mode == NotificationMode.Local) {
            updateMediaSession(state, artwork)
        } else {
            clearMediaSession()
        }

        val toggleIntent = Intent(this, ForegroundPlaybackService::class.java).apply {
            action = PlaybackServiceConstants.ACTION_TOGGLE
            putExtra(PlaybackServiceConstants.EXTRA_IS_CASTING, state.mode == NotificationMode.Cast)
            if (state.mode == NotificationMode.Cast) {
                putExtra(PlaybackServiceConstants.EXTRA_CAST_IS_PLAYING, state.isPlaying)
                putExtra(PlaybackServiceConstants.EXTRA_TRACK_TITLE, state.title)
                putExtra(PlaybackServiceConstants.EXTRA_TRACK_ARTIST, state.artist)
                putExtra(PlaybackServiceConstants.EXTRA_CAST_DEVICE_NAME, state.castDeviceName)
            }
        }
        val togglePendingIntent = PendingIntent.getService(
            this,
            0,
            toggleIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val activityIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_OPEN_LISTEN_TAB, true)
        }
        val activityPendingIntent = PendingIntent.getActivity(
            this,
            0,
            activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val actionIconRes = when (state.mode) {
            NotificationMode.Cast -> if (state.isPlaying) {
                android.R.drawable.ic_menu_close_clear_cancel
            } else {
                android.R.drawable.ic_media_play
            }
            NotificationMode.Local -> android.R.drawable.ic_media_pause
        }
        val actionLabel = when (state.mode) {
            NotificationMode.Cast -> if (state.isPlaying) "Stop" else "Play"
            NotificationMode.Local -> "Stop"
        }
        val actionIcon = tintedIcon(actionIconRes, NOTIFICATION_ACCENT.toColorInt())

        val builder = NotificationCompat.Builder(this, PlaybackServiceConstants.CHANNEL_ID)
            .setContentTitle(state.title)
            .setSmallIcon(R.drawable.ic_all_inclusive)
            .setColor(NOTIFICATION_ACCENT.toColorInt())
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setContentIntent(activityPendingIntent)
            .setOngoing(true)
            .addAction(
                NotificationCompat.Action.Builder(
                    actionIcon,
                    actionLabel,
                    togglePendingIntent
                ).build()
            )

        if (contentText.isNotBlank()) {
            builder.setContentText(contentText)
        }
        state.subText()?.let { builder.setSubText(it) }

        if (state.mode == NotificationMode.Local) {
            if (artwork != null) {
                builder.setLargeIcon(artwork)
            }
            builder.setProgress(
                state.durationMs?.toInt() ?: 0,
                state.positionMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
                state.durationMs == null
            )
            builder.setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0)
            )
        }

        val notification: Notification = builder.build()

        startForeground(PlaybackServiceConstants.NOTIFICATION_ID, notification)
    }

    private fun tintedIcon(resId: Int, color: Int): IconCompat {
        val source = BitmapFactory.decodeResource(resources, resId)
        val bitmap = createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN)
        }
        canvas.drawBitmap(source, 0f, 0f, paint)
        return IconCompat.createWithBitmap(bitmap)
    }

    private fun updateMediaSession(
        notificationState: PlaybackNotificationState,
        artwork: Bitmap?
    ) {
        val playbackState = PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY_PAUSE)
            .setState(
                if (notificationState.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                notificationState.positionMs,
                if (notificationState.isPlaying) 1f else 0f
            )
            .build()
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, notificationState.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, notificationState.artist)
        if (notificationState.durationMs != null) {
            metadata.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, notificationState.durationMs)
        }
        if (artwork != null) {
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork)
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork)
        }
        mediaSession.setPlaybackState(playbackState)
        mediaSession.setMetadata(metadata.build())
        mediaSession.isActive = notificationState.isPlaying
    }

    private fun clearMediaSession() {
        mediaSession.isActive = false
    }

    private fun handlePlayPause(shouldPlay: Boolean) {
        val activeState = activeNotificationState
        if (activeState?.mode == NotificationMode.Cast) {
            val command = if (shouldPlay) "play" else "stop"
            val sent = castController.sendCommand(
                PlaybackServiceConstants.CAST_COMMAND_NAMESPACE,
                command
            )
            if (sent) {
                updateNotification(activeState.copy(isPlaying = shouldPlay))
            } else {
                activeNotificationState = null
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            return
        }
        val controller = PlaybackControllerHolder.get(this)
        val isPlaying = controller.isPlaying()
        if (shouldPlay && !isPlaying) {
            updateNotification(buildLocalNotificationState(controller.togglePlayback()))
        } else if (!shouldPlay && isPlaying) {
            controller.stopPlayback()
            updateNotification(buildLocalNotificationState(false))
        } else {
            updateNotification(buildLocalNotificationState(isPlaying))
        }
    }

    private fun handleCastToggle(intent: Intent) {
        val isPlaying = intent.getBooleanExtra(
            PlaybackServiceConstants.EXTRA_CAST_IS_PLAYING,
            activeNotificationState?.isPlaying == true
        )
        handlePlayPause(shouldPlay = !isPlaying)
    }

    override fun onDestroy() {
        activeNotificationState = null
        mediaSession.release()
        super.onDestroy()
    }

    private fun createChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(PlaybackServiceConstants.CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            PlaybackServiceConstants.CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)
    }

    private fun loadNotificationArtwork(): Bitmap? {
        val drawable = AppCompatResources.getDrawable(this, R.drawable.notification_background) ?: return null
        val width = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else 512
        val height = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else 512
        val bitmap = createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    companion object {
        fun start(context: Context) {
            val intent = Intent(context, ForegroundPlaybackService::class.java).apply {
                action = PlaybackServiceConstants.ACTION_START
            }
            context.startForegroundService(intent)
        }

        fun update(context: Context) {
            val intent = Intent(context, ForegroundPlaybackService::class.java).apply {
                action = PlaybackServiceConstants.ACTION_UPDATE
            }
            context.startService(intent)
        }

        fun updateCast(
            context: Context,
            isPlaying: Boolean,
            title: String?,
            artist: String?,
            deviceName: String?
        ) {
            val intent = Intent(context, ForegroundPlaybackService::class.java).apply {
                action = PlaybackServiceConstants.ACTION_UPDATE
                putExtra(PlaybackServiceConstants.EXTRA_IS_CASTING, true)
                putExtra(PlaybackServiceConstants.EXTRA_CAST_IS_PLAYING, isPlaying)
                putExtra(PlaybackServiceConstants.EXTRA_TRACK_TITLE, title)
                putExtra(PlaybackServiceConstants.EXTRA_TRACK_ARTIST, artist)
                putExtra(PlaybackServiceConstants.EXTRA_CAST_DEVICE_NAME, deviceName)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ForegroundPlaybackService::class.java))
        }
    }
}

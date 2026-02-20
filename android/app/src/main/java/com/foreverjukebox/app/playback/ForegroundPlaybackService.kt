package com.foreverjukebox.app.playback

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

private object PlaybackServiceConstants {
    const val CHANNEL_ID = "fj_playback"
    const val NOTIFICATION_ID = 2001
    const val ACTION_START = "com.foreverjukebox.app.playback.START"
    const val ACTION_UPDATE = "com.foreverjukebox.app.playback.UPDATE"
    const val ACTION_TOGGLE = "com.foreverjukebox.app.playback.TOGGLE"
}

private const val NOTIFICATION_ACCENT = "#4AC7FF"

class ForegroundPlaybackService : Service() {
    private lateinit var mediaSession: MediaSessionCompat

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
                val controller = PlaybackControllerHolder.get(this)
                val isPlaying = controller.togglePlayback()
                updateNotification(isPlaying)
            }
            PlaybackServiceConstants.ACTION_START, PlaybackServiceConstants.ACTION_UPDATE -> {
                val controller = PlaybackControllerHolder.get(this)
                val isPlaying = controller.isPlaying()
                updateNotification(isPlaying)
            }
        }
        return START_STICKY
    }

    private fun updateNotification(isPlaying: Boolean) {
        if (!isPlaying) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        createChannel()
        val controller = PlaybackControllerHolder.get(this)
        val title = controller.getTrackTitle().orEmpty().ifBlank { "The Forever Jukebox" }
        val artist = controller.getTrackArtist().orEmpty()
        val positionMs = controller.getPlaybackPositionMs().coerceAtLeast(0L)
        val durationMs = controller.getTrackDurationMs()?.coerceAtLeast(0L)
        val artwork = loadNotificationArtwork()
        updateMediaSession(title, artist, positionMs, durationMs, isPlaying, artwork)

        val toggleIntent = Intent(this, ForegroundPlaybackService::class.java).apply {
            action = PlaybackServiceConstants.ACTION_TOGGLE
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

        val actionIconRes = android.R.drawable.ic_media_pause
        val actionLabel = "Stop"
        val actionIcon = tintedIcon(actionIconRes, NOTIFICATION_ACCENT.toColorInt())

        val notification: Notification = NotificationCompat.Builder(this, PlaybackServiceConstants.CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(R.drawable.ic_all_inclusive)
            .setLargeIcon(artwork)
            .setColor(NOTIFICATION_ACCENT.toColorInt())
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setContentIntent(activityPendingIntent)
            .setOngoing(true)
            .setProgress(
                durationMs?.toInt() ?: 0,
                positionMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
                durationMs == null
            )
            .addAction(
                NotificationCompat.Action.Builder(
                    actionIcon,
                    actionLabel,
                    togglePendingIntent
                ).build()
            )
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0)
            )
            .build()

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
        title: String,
        artist: String,
        positionMs: Long,
        durationMs: Long?,
        isPlaying: Boolean,
        artwork: Bitmap?
    ) {
        val state = PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY_PAUSE)
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                positionMs,
                1f
            )
            .build()
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
        if (durationMs != null) {
            metadata.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
        }
        if (artwork != null) {
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork)
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork)
        }
        mediaSession.setPlaybackState(state)
        mediaSession.setMetadata(metadata.build())
        mediaSession.isActive = isPlaying
    }

    private fun handlePlayPause(shouldPlay: Boolean) {
        val controller = PlaybackControllerHolder.get(this)
        val isPlaying = controller.isPlaying()
        if (shouldPlay && !isPlaying) {
            updateNotification(controller.togglePlayback())
        } else if (!shouldPlay && isPlaying) {
            controller.stopPlayback()
            updateNotification(false)
        } else {
            updateNotification(isPlaying)
        }
    }

    override fun onDestroy() {
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

        fun stop(context: Context) {
            context.stopService(Intent(context, ForegroundPlaybackService::class.java))
        }
    }
}

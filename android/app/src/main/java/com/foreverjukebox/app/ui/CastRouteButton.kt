package com.foreverjukebox.app.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.appcompat.content.res.AppCompatResources
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener

@Composable
fun CastRouteButton(
    modifier: Modifier = Modifier,
    enabled: Boolean,
    onSessionStarted: () -> Unit,
    onDisabledClick: (() -> Unit)? = null
) {
    val context = LocalContext.current
    val onSessionStartedState = rememberUpdatedState(onSessionStarted)
    val enabledTint = MaterialTheme.colorScheme.onSurface
    val disabledTint = enabledTint.copy(alpha = 0.4f)
    if (!enabled) {
        IconButton(
            onClick = { onDisabledClick?.invoke() },
            modifier = modifier
        ) {
            Icon(
                imageVector = Icons.Outlined.Cast,
                contentDescription = "Cast unavailable",
                tint = disabledTint
            )
        }
        return
    }
    val castContext = remember {
        runCatching { CastContext.getSharedInstance(context) }.getOrNull()
    }
    if (castContext == null) {
        return
    }
    val sessionManager = castContext.sessionManager

    DisposableEffect(sessionManager) {
        val listener = object : SessionManagerListener<CastSession> {
            override fun onSessionStarted(session: CastSession, sessionId: String) {
                onSessionStartedState.value()
            }

            override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
                onSessionStartedState.value()
            }

            override fun onSessionStarting(session: CastSession) = Unit
            override fun onSessionStartFailed(session: CastSession, error: Int) = Unit
            override fun onSessionEnding(session: CastSession) = Unit
            override fun onSessionEnded(session: CastSession, error: Int) = Unit
            override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
            override fun onSessionResumeFailed(session: CastSession, error: Int) = Unit
            override fun onSessionSuspended(session: CastSession, reason: Int) = Unit
        }
        sessionManager.addSessionManagerListener(listener, CastSession::class.java)
        onDispose {
            sessionManager.removeSessionManagerListener(listener, CastSession::class.java)
        }
    }

    AndroidView(
        factory = { ctx ->
            MediaRouteButton(ctx).apply {
                CastButtonFactory.setUpMediaRouteButton(ctx, this)
                setRemoteIndicatorDrawable(tintedRemoteIndicator(ctx, enabledTint.toArgb()))
            }
        },
        modifier = modifier,
        update = { button ->
            button.isEnabled = enabled
            button.setRemoteIndicatorDrawable(tintedRemoteIndicator(button.context, enabledTint.toArgb()))
        }
    )
}

private fun tintedRemoteIndicator(context: Context, tint: Int) =
    AppCompatResources.getDrawable(context, androidx.mediarouter.R.drawable.mr_button_light)
        ?.mutate()
        ?.apply { setTint(tint) }

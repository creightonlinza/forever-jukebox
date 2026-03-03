package com.foreverjukebox.app

import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.OnBackPressedCallback
import androidx.activity.viewModels
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.foreverjukebox.app.data.AppMode
import com.foreverjukebox.app.playback.ForegroundPlaybackService
import com.foreverjukebox.app.ui.ForeverJukeboxApp
import com.foreverjukebox.app.ui.MainViewModel
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    private val viewModel: MainViewModel by viewModels()
    private var lastBackPressMs: Long = 0
    private val requestNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }
    private var sessionListener: SessionManagerListener<CastSession>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    syncCastSessionListener(state.appMode == AppMode.Server)
                }
            }
        }
        viewModel.handleDeepLink(intent?.data)
        if (intent.getBooleanExtra(EXTRA_OPEN_LISTEN_TAB, false)) {
            viewModel.openListenTab()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (!viewModel.navigateBack()) {
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastBackPressMs < EXIT_CONFIRM_WINDOW_MS) {
                            viewModel.prepareForExit()
                            finishAffinity()
                        } else {
                            lastBackPressMs = now
                            Toast.makeText(
                                this@MainActivity,
                                "Tap back again to exit",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            }
        )
        setContent {
            ForeverJukeboxApp(viewModel)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        viewModel.handleDeepLink(intent.data)
        if (intent.getBooleanExtra(EXTRA_OPEN_LISTEN_TAB, false)) {
            viewModel.openListenTab()
        }
    }

    override fun onDestroy() {
        syncCastSessionListener(enable = false)
        if (isFinishing) {
            ForegroundPlaybackService.stop(this)
        }
        super.onDestroy()
    }

    private fun syncCastSessionListener(enable: Boolean) {
        if (!enable) {
            sessionListener?.let { listener ->
                runCatching {
                    CastContext.getSharedInstance(this)
                        .sessionManager
                        .removeSessionManagerListener(listener, CastSession::class.java)
                }
            }
            sessionListener = null
            viewModel.setCastingConnected(false)
            return
        }

        if (sessionListener != null) {
            return
        }

        val castContext = runCatching { CastContext.getSharedInstance(this) }.getOrNull()
            ?: return
        val listener = object : SessionManagerListener<CastSession> {
            override fun onSessionStarted(session: CastSession, sessionId: String) {
                viewModel.setCastingConnected(true, session.castDevice?.friendlyName)
                viewModel.requestCastStatus()
            }

            override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
                viewModel.setCastingConnected(true, session.castDevice?.friendlyName)
                viewModel.requestCastStatus()
            }

            override fun onSessionEnded(session: CastSession, error: Int) {
                viewModel.setCastingConnected(false)
            }

            override fun onSessionStarting(session: CastSession) = Unit
            override fun onSessionStartFailed(session: CastSession, error: Int) = Unit
            override fun onSessionEnding(session: CastSession) = Unit
            override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
            override fun onSessionResumeFailed(session: CastSession, error: Int) = Unit
            override fun onSessionSuspended(session: CastSession, reason: Int) = Unit
        }
        castContext.sessionManager.addSessionManagerListener(listener, CastSession::class.java)
        sessionListener = listener

        castContext.sessionManager.currentCastSession?.let { session ->
            viewModel.setCastingConnected(true, session.castDevice?.friendlyName)
            viewModel.requestCastStatus()
        }
    }

    companion object {
        const val EXTRA_OPEN_LISTEN_TAB = "com.foreverjukebox.app.open_listen_tab"
        private const val EXIT_CONFIRM_WINDOW_MS = 2000L
    }
}

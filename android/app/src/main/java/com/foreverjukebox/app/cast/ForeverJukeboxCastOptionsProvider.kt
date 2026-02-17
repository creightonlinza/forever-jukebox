package com.foreverjukebox.app.cast

import android.content.Context
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import com.foreverjukebox.app.data.AppPreferences

class ForeverJukeboxCastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions {
        val baseUrl = runBlocking { AppPreferences(context).baseUrl.first() }
        val appId = CastAppIdResolver.resolve(context, baseUrl)
            ?: CastAppIdResolver.resolveAny(context)
            ?: throw IllegalStateException(
                "No Cast receiver app ID configured in cast_app_ids.json"
            )
        return CastOptions.Builder()
            .setReceiverApplicationId(appId)
            .setResumeSavedSession(true)
            .build()
    }

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? {
        return null
    }
}

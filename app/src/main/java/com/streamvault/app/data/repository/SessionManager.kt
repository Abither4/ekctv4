package com.streamvault.app.data.repository

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.streamvault.app.data.model.ConnectionType
import com.streamvault.app.data.model.StremioConfig
import com.streamvault.app.data.model.UserSession
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SessionManager @Inject constructor(
    @ApplicationContext context: Context
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("streamvault_session", Context.MODE_PRIVATE)
    private val gson = Gson()

    var session: UserSession?
        get() {
            val json = prefs.getString("session", null) ?: return null
            return gson.fromJson(json, UserSession::class.java)
        }
        set(value) {
            prefs.edit().putString("session", if (value != null) gson.toJson(value) else null).apply()
        }

    var stremioConfig: StremioConfig?
        get() {
            val json = prefs.getString("stremio_config", null) ?: return null
            return gson.fromJson(json, StremioConfig::class.java)
        }
        set(value) {
            prefs.edit().putString("stremio_config", if (value != null) gson.toJson(value) else null).apply()
        }

    // Panel login credentials (for your custom panel)
    var panelUrl: String?
        get() = prefs.getString("panel_url", null)
        set(value) = prefs.edit().putString("panel_url", value).apply()

    var panelToken: String?
        get() = prefs.getString("panel_token", null)
        set(value) = prefs.edit().putString("panel_token", value).apply()

    val isLoggedIn: Boolean
        get() = session != null

    val isStremioConfigured: Boolean
        get() = stremioConfig != null

    fun logout() {
        prefs.edit().clear().apply()
    }
}

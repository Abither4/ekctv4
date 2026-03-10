package com.streamvault.app.data.repository

import com.streamvault.app.data.api.*
import com.streamvault.app.data.model.StremioConfig
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class StremioRepository @Inject constructor(
    private val sessionManager: SessionManager
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun buildApi(baseUrl: String): StremioApi {
        return Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(StremioApi::class.java)
    }

    fun configure(config: StremioConfig) {
        sessionManager.stremioConfig = config
    }

    suspend fun getAddonManifest(addonUrl: String): Result<StremioManifest> {
        return try {
            val url = if (addonUrl.endsWith("/manifest.json")) addonUrl
                else "${addonUrl.trimEnd('/')}/manifest.json"
            val api = buildApi(addonUrl)
            Result.success(api.getManifest(url))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCatalog(
        addonUrl: String,
        type: String,
        catalogId: String,
        extra: String? = null
    ): Result<StremioCatalogResponse> {
        return try {
            val base = addonUrl.trimEnd('/')
            val url = if (extra != null) "$base/catalog/$type/$catalogId/$extra.json"
                else "$base/catalog/$type/$catalogId.json"
            val api = buildApi(addonUrl)
            Result.success(api.getCatalog(url))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getStreams(
        addonUrl: String,
        type: String,
        id: String
    ): Result<StremioStreamsResponse> {
        return try {
            val base = addonUrl.trimEnd('/')
            val url = "$base/stream/$type/${java.net.URLEncoder.encode(id, "UTF-8")}.json"
            val api = buildApi(addonUrl)
            Result.success(api.getStreams(url))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getMeta(
        addonUrl: String,
        type: String,
        id: String
    ): Result<StremioMetaResponse> {
        return try {
            val base = addonUrl.trimEnd('/')
            val url = "$base/meta/$type/${java.net.URLEncoder.encode(id, "UTF-8")}.json"
            val api = buildApi(addonUrl)
            Result.success(api.getMeta(url))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

package com.streamvault.app.data.repository

import com.streamvault.app.data.api.XtreamApi
import com.streamvault.app.data.model.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class IptvRepository @Inject constructor(
    private val sessionManager: SessionManager
) {
    private var xtreamApi: XtreamApi? = null

    private val session get() = sessionManager.session

    fun buildStreamUrl(streamId: Int, type: String, extension: String = "ts"): String {
        val s = session ?: return ""
        val ext = if (type == "live") extension else extension
        return "${s.serverUrl}/${type}/${s.username}/${s.token}/$streamId.$ext"
    }

    fun buildXtreamApi(baseUrl: String): XtreamApi {
        val retrofit = retrofit2.Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .addConverterFactory(retrofit2.converter.gson.GsonConverterFactory.create())
            .client(
                okhttp3.OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .build()
            )
            .build()
        xtreamApi = retrofit.create(XtreamApi::class.java)
        return xtreamApi!!
    }

    suspend fun loginXtream(serverUrl: String, username: String, password: String): Result<XtreamAuthResponse> {
        return try {
            val api = buildXtreamApi(serverUrl)
            val response = api.login(username, password)
            if (response.userInfo?.status == "Active") {
                sessionManager.session = UserSession(
                    username = username,
                    serverUrl = serverUrl,
                    token = password,
                    type = ConnectionType.XTREAM,
                    expiration = response.userInfo.expDate?.toLongOrNull(),
                    maxConnections = response.userInfo.maxConnections?.toIntOrNull()
                )
                Result.success(response)
            } else {
                Result.failure(Exception("Account not active: ${response.userInfo?.status}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getLiveCategories(): Result<List<XtreamCategory>> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getLiveCategories(s.username, s.token!!))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getLiveStreams(categoryId: String? = null): Result<List<XtreamLiveStream>> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getLiveStreams(s.username, s.token!!, categoryId = categoryId))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getVodCategories(): Result<List<XtreamCategory>> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getVodCategories(s.username, s.token!!))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getVodStreams(categoryId: String? = null): Result<List<XtreamVodStream>> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getVodStreams(s.username, s.token!!, categoryId = categoryId))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSeriesCategories(): Result<List<XtreamCategory>> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getSeriesCategories(s.username, s.token!!))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSeries(categoryId: String? = null): Result<List<XtreamSeriesInfo>> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getSeries(s.username, s.token!!, categoryId = categoryId))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSeriesDetail(seriesId: Int): Result<XtreamSeriesDetail> {
        return try {
            val s = session ?: return Result.failure(Exception("Not logged in"))
            val api = xtreamApi ?: buildXtreamApi(s.serverUrl)
            Result.success(api.getSeriesInfo(s.username, s.token!!, seriesId))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

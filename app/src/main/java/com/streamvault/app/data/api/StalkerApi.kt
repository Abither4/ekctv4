package com.streamvault.app.data.api

import com.streamvault.app.data.model.StalkerAuthResponse
import retrofit2.http.*

interface StalkerApi {

    @GET("server/load.php")
    suspend fun handshake(
        @Header("Cookie") cookie: String,
        @Query("type") type: String = "stb",
        @Query("action") action: String = "handshake",
        @Query("prehash") prehash: String = "0",
        @Query("token") token: String = "",
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): StalkerAuthResponse

    @GET("server/load.php")
    suspend fun getProfile(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "stb",
        @Query("action") action: String = "get_profile",
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun getLiveCategories(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "itv",
        @Query("action") action: String = "get_genres",
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun getLiveChannels(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "itv",
        @Query("action") action: String = "get_ordered_list",
        @Query("genre") genre: String? = null,
        @Query("p") page: Int = 1,
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun getVodCategories(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "vod",
        @Query("action") action: String = "get_categories",
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun getVodList(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "vod",
        @Query("action") action: String = "get_ordered_list",
        @Query("category") category: String? = null,
        @Query("p") page: Int = 1,
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun getSeriesCategories(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "series",
        @Query("action") action: String = "get_categories",
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun getSeriesList(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "series",
        @Query("action") action: String = "get_ordered_list",
        @Query("category") category: String? = null,
        @Query("p") page: Int = 1,
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any

    @GET("server/load.php")
    suspend fun createLink(
        @Header("Cookie") cookie: String,
        @Header("Authorization") auth: String,
        @Query("type") type: String = "itv",
        @Query("action") action: String = "create_link",
        @Query("cmd") cmd: String,
        @Query("JsHttpRequest") jsRequest: String = "1-xml"
    ): Any
}

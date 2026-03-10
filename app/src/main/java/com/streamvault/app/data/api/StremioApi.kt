package com.streamvault.app.data.api

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Url

/**
 * Stremio Addon Protocol API
 * Communicates with stremio-server (local or remote) and addon endpoints
 */
interface StremioApi {

    // Get addon manifest
    @GET
    suspend fun getManifest(@Url manifestUrl: String): StremioManifest

    // Get catalog from addon
    @GET
    suspend fun getCatalog(@Url catalogUrl: String): StremioCatalogResponse

    // Get streams for a media item
    @GET
    suspend fun getStreams(@Url streamsUrl: String): StremioStreamsResponse

    // Get meta info for a media item
    @GET
    suspend fun getMeta(@Url metaUrl: String): StremioMetaResponse
}

// === Stremio Protocol Models ===

data class StremioManifest(
    val id: String?,
    val version: String?,
    val name: String?,
    val description: String?,
    val types: List<String>?,
    val catalogs: List<StremioCatalog>?,
    val resources: List<Any>?,
    val idPrefixes: List<String>?
)

data class StremioCatalog(
    val type: String?,
    val id: String?,
    val name: String?,
    val extra: List<StremioExtra>?
)

data class StremioExtra(
    val name: String?,
    val isRequired: Boolean?,
    val options: List<String>?
)

data class StremioCatalogResponse(
    val metas: List<StremioMeta>?
)

data class StremioMeta(
    val id: String?,
    val type: String?,
    val name: String?,
    val poster: String?,
    val posterShape: String?,
    val background: String?,
    val description: String?,
    val releaseInfo: String?,
    val imdbRating: String?,
    val genres: List<String>?,
    val videos: List<StremioVideo>?
)

data class StremioVideo(
    val id: String?,
    val title: String?,
    val season: Int?,
    val episode: Int?,
    val released: String?,
    val thumbnail: String?,
    val overview: String?
)

data class StremioMetaResponse(
    val meta: StremioMeta?
)

data class StremioStreamsResponse(
    val streams: List<StremioStream>?
)

data class StremioStream(
    val name: String?,
    val title: String?,
    val url: String?,
    val infoHash: String?,
    val fileIdx: Int?,
    val behaviorHints: StreamBehaviorHints?
)

data class StreamBehaviorHints(
    val bingeGroup: String?,
    val notWebReady: Boolean?,
    val proxyHeaders: Map<String, Map<String, String>>?
)

package com.streamvault.app.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

// === Auth / Login ===

data class LoginRequest(
    val username: String,
    val password: String,
    val serverUrl: String,
    val type: ConnectionType = ConnectionType.XTREAM
)

enum class ConnectionType {
    XTREAM, STALKER, M3U, STREMIO
}

data class UserSession(
    val username: String,
    val serverUrl: String,
    val token: String? = null,
    val type: ConnectionType,
    val expiration: Long? = null,
    val maxConnections: Int? = null,
    val activatedAt: Long? = null
)

// === Xtream Codes API Models ===

data class XtreamAuthResponse(
    @SerializedName("user_info") val userInfo: XtreamUserInfo?,
    @SerializedName("server_info") val serverInfo: XtreamServerInfo?
)

data class XtreamUserInfo(
    val username: String?,
    val password: String?,
    val status: String?,
    @SerializedName("exp_date") val expDate: String?,
    @SerializedName("is_trial") val isTrial: String?,
    @SerializedName("active_cons") val activeCons: String?,
    @SerializedName("created_at") val createdAt: String?,
    @SerializedName("max_connections") val maxConnections: String?,
    @SerializedName("allowed_output_formats") val allowedOutputFormats: List<String>?
)

data class XtreamServerInfo(
    val url: String?,
    val port: String?,
    @SerializedName("https_port") val httpsPort: String?,
    @SerializedName("server_protocol") val serverProtocol: String?,
    @SerializedName("rtmp_port") val rtmpPort: String?,
    val timezone: String?,
    @SerializedName("timestamp_now") val timestampNow: Long?,
    @SerializedName("time_now") val timeNow: String?
)

data class XtreamCategory(
    @SerializedName("category_id") val categoryId: String,
    @SerializedName("category_name") val categoryName: String,
    @SerializedName("parent_id") val parentId: Int?
)

data class XtreamLiveStream(
    val num: Int?,
    val name: String?,
    @SerializedName("stream_type") val streamType: String?,
    @SerializedName("stream_id") val streamId: Int?,
    @SerializedName("stream_icon") val streamIcon: String?,
    @SerializedName("epg_channel_id") val epgChannelId: String?,
    @SerializedName("category_id") val categoryId: String?,
    @SerializedName("tv_archive") val tvArchive: Int?,
    @SerializedName("tv_archive_duration") val tvArchiveDuration: Int?
)

data class XtreamVodStream(
    val num: Int?,
    val name: String?,
    @SerializedName("stream_type") val streamType: String?,
    @SerializedName("stream_id") val streamId: Int?,
    @SerializedName("stream_icon") val streamIcon: String?,
    val rating: String?,
    @SerializedName("category_id") val categoryId: String?,
    @SerializedName("container_extension") val containerExtension: String?
)

data class XtreamSeriesInfo(
    val num: Int?,
    val name: String?,
    @SerializedName("series_id") val seriesId: Int?,
    val cover: String?,
    val plot: String?,
    val cast: String?,
    val director: String?,
    val genre: String?,
    val rating: String?,
    @SerializedName("category_id") val categoryId: String?,
    @SerializedName("last_modified") val lastModified: String?
)

data class XtreamSeriesDetail(
    val seasons: List<XtreamSeason>?,
    val info: XtreamSeriesDetailInfo?,
    val episodes: Map<String, List<XtreamEpisode>>?
)

data class XtreamSeason(
    @SerializedName("season_number") val seasonNumber: Int?,
    val name: String?,
    val cover: String?
)

data class XtreamSeriesDetailInfo(
    val name: String?,
    val cover: String?,
    val plot: String?,
    val cast: String?,
    val director: String?,
    val genre: String?,
    val rating: String?,
    @SerializedName("backdrop_path") val backdropPath: List<String>?
)

data class XtreamEpisode(
    val id: String?,
    @SerializedName("episode_num") val episodeNum: Int?,
    val title: String?,
    @SerializedName("container_extension") val containerExtension: String?,
    val info: XtreamEpisodeInfo?
)

data class XtreamEpisodeInfo(
    @SerializedName("movie_image") val movieImage: String?,
    val plot: String?,
    val duration: String?,
    val rating: String?
)

// === EPG ===

data class EpgProgram(
    val title: String,
    val description: String?,
    val start: Long,
    val end: Long,
    val channelId: String
)

// === Stalker Portal ===

data class StalkerAuthResponse(
    val js: StalkerToken?,
    val status: Int?
)

data class StalkerToken(
    val token: String?,
    @SerializedName("random") val random: String?
)

// === Favorites DB ===

@Entity(tableName = "favorites")
data class FavoriteItem(
    @PrimaryKey val id: String,
    val name: String,
    val streamUrl: String?,
    val iconUrl: String?,
    val type: String, // "live", "vod", "series"
    val categoryId: String?,
    val addedAt: Long = System.currentTimeMillis()
)

// === Stremio Integration (placeholder for your custom app) ===

data class StremioConfig(
    val serverUrl: String,
    val premiumizeApiKey: String? = null,
    val addons: List<String> = emptyList()
)

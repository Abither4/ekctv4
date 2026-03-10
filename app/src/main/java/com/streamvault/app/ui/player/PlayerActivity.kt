package com.streamvault.app.ui.player

import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.streamvault.app.databinding.ActivityPlayerBinding
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class PlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_STREAM_URL = "stream_url"
        const val EXTRA_STREAM_TITLE = "stream_title"
        const val EXTRA_USER_AGENT = "user_agent"
    }

    private lateinit var binding: ActivityPlayerBinding
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val url = intent.getStringExtra(EXTRA_STREAM_URL) ?: run { finish(); return }
        val title = intent.getStringExtra(EXTRA_STREAM_TITLE) ?: "Stream"

        binding.tvPlayerTitle.text = title
        binding.btnBack.setOnClickListener { finish() }

        initPlayer(url)
    }

    private fun initPlayer(url: String) {
        player = ExoPlayer.Builder(this).build().apply {
            binding.playerView.player = this

            val mediaItem = MediaItem.fromUri(url)
            setMediaItem(mediaItem)
            playWhenReady = true
            prepare()

            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    binding.tvPlayerError.text = "Playback error: ${error.message}"
                    binding.tvPlayerError.visibility = android.view.View.VISIBLE
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    binding.progressBar.visibility = when (playbackState) {
                        Player.STATE_BUFFERING -> android.view.View.VISIBLE
                        else -> android.view.View.GONE
                    }
                }
            })
        }
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onResume() {
        super.onResume()
        player?.play()
    }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
        player = null
    }
}

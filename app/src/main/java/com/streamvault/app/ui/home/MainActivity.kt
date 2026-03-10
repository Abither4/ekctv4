package com.streamvault.app.ui.home

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.streamvault.app.R
import com.streamvault.app.data.model.ConnectionType
import com.streamvault.app.data.repository.SessionManager
import com.streamvault.app.databinding.ActivityMainBinding
import com.streamvault.app.ui.auth.LoginActivity
import com.streamvault.app.ui.live.LiveFragment
import com.streamvault.app.ui.vod.VodFragment
import com.streamvault.app.ui.series.SeriesFragment
import com.streamvault.app.ui.stremio.StremioFragment
import com.streamvault.app.ui.settings.SettingsFragment
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject lateinit var sessionManager: SessionManager
    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupBottomNav()

        if (savedInstanceState == null) {
            val startTab = when (sessionManager.session?.type) {
                ConnectionType.STREMIO -> R.id.nav_stremio
                else -> R.id.nav_live
            }
            binding.bottomNav.selectedItemId = startTab
        }
    }

    private fun setupBottomNav() {
        binding.bottomNav.setOnItemSelectedListener { item ->
            val fragment: Fragment = when (item.itemId) {
                R.id.nav_live -> LiveFragment()
                R.id.nav_vod -> VodFragment()
                R.id.nav_series -> SeriesFragment()
                R.id.nav_stremio -> StremioFragment()
                R.id.nav_settings -> SettingsFragment()
                else -> return@setOnItemSelectedListener false
            }
            supportFragmentManager.beginTransaction()
                .replace(R.id.fragment_container, fragment)
                .commit()
            true
        }
    }

    fun logout() {
        sessionManager.logout()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}

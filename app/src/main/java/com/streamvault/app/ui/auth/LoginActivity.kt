package com.streamvault.app.ui.auth

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.streamvault.app.data.model.ConnectionType
import com.streamvault.app.data.model.StremioConfig
import com.streamvault.app.data.repository.IptvRepository
import com.streamvault.app.data.repository.SessionManager
import com.streamvault.app.data.repository.StremioRepository
import com.streamvault.app.databinding.ActivityLoginBinding
import com.streamvault.app.ui.home.MainActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class LoginActivity : AppCompatActivity() {

    @Inject lateinit var sessionManager: SessionManager
    @Inject lateinit var iptvRepository: IptvRepository
    @Inject lateinit var stremioRepository: StremioRepository

    private lateinit var binding: ActivityLoginBinding
    private var selectedType = ConnectionType.XTREAM

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Skip login if already logged in
        if (sessionManager.isLoggedIn) {
            startMain()
            return
        }

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupConnectionTypeSelector()
        setupLoginButton()
    }

    private fun setupConnectionTypeSelector() {
        binding.chipGroupType.setOnCheckedStateChangeListener { _, checkedIds ->
            when {
                checkedIds.contains(binding.chipXtream.id) -> {
                    selectedType = ConnectionType.XTREAM
                    binding.layoutXtream.visibility = View.VISIBLE
                    binding.layoutStalker.visibility = View.GONE
                    binding.layoutM3u.visibility = View.GONE
                    binding.layoutStremio.visibility = View.GONE
                }
                checkedIds.contains(binding.chipStalker.id) -> {
                    selectedType = ConnectionType.STALKER
                    binding.layoutXtream.visibility = View.GONE
                    binding.layoutStalker.visibility = View.VISIBLE
                    binding.layoutM3u.visibility = View.GONE
                    binding.layoutStremio.visibility = View.GONE
                }
                checkedIds.contains(binding.chipM3u.id) -> {
                    selectedType = ConnectionType.M3U
                    binding.layoutXtream.visibility = View.GONE
                    binding.layoutStalker.visibility = View.GONE
                    binding.layoutM3u.visibility = View.VISIBLE
                    binding.layoutStremio.visibility = View.GONE
                }
                checkedIds.contains(binding.chipStremio.id) -> {
                    selectedType = ConnectionType.STREMIO
                    binding.layoutXtream.visibility = View.GONE
                    binding.layoutStalker.visibility = View.GONE
                    binding.layoutM3u.visibility = View.GONE
                    binding.layoutStremio.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun setupLoginButton() {
        binding.btnLogin.setOnClickListener {
            when (selectedType) {
                ConnectionType.XTREAM -> loginXtream()
                ConnectionType.STALKER -> loginStalker()
                ConnectionType.M3U -> loginM3u()
                ConnectionType.STREMIO -> loginStremio()
            }
        }
    }

    private fun loginXtream() {
        val server = binding.etXtreamServer.text.toString().trim()
        val user = binding.etXtreamUsername.text.toString().trim()
        val pass = binding.etXtreamPassword.text.toString().trim()

        if (server.isEmpty() || user.isEmpty() || pass.isEmpty()) {
            Toast.makeText(this, "Fill in all fields", Toast.LENGTH_SHORT).show()
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            val result = iptvRepository.loginXtream(server, user, pass)
            setLoading(false)
            result.onSuccess {
                Toast.makeText(this@LoginActivity, "Connected!", Toast.LENGTH_SHORT).show()
                startMain()
            }.onFailure {
                Toast.makeText(this@LoginActivity, "Login failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loginStalker() {
        val server = binding.etStalkerPortal.text.toString().trim()
        val mac = binding.etStalkerMac.text.toString().trim()

        if (server.isEmpty() || mac.isEmpty()) {
            Toast.makeText(this, "Fill in all fields", Toast.LENGTH_SHORT).show()
            return
        }

        // Store stalker session
        sessionManager.session = com.streamvault.app.data.model.UserSession(
            username = mac,
            serverUrl = server,
            token = mac,
            type = ConnectionType.STALKER
        )
        startMain()
    }

    private fun loginM3u() {
        val url = binding.etM3uUrl.text.toString().trim()
        if (url.isEmpty()) {
            Toast.makeText(this, "Enter M3U URL", Toast.LENGTH_SHORT).show()
            return
        }

        sessionManager.session = com.streamvault.app.data.model.UserSession(
            username = "m3u_user",
            serverUrl = url,
            token = null,
            type = ConnectionType.M3U
        )
        startMain()
    }

    private fun loginStremio() {
        val serverUrl = binding.etStremioServer.text.toString().trim()
        val premiumizeKey = binding.etPremiumizeKey.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "Enter Stremio server URL", Toast.LENGTH_SHORT).show()
            return
        }

        stremioRepository.configure(StremioConfig(
            serverUrl = serverUrl,
            premiumizeApiKey = premiumizeKey.ifEmpty { null }
        ))

        sessionManager.session = com.streamvault.app.data.model.UserSession(
            username = "stremio_user",
            serverUrl = serverUrl,
            token = premiumizeKey.ifEmpty { null },
            type = ConnectionType.STREMIO
        )
        startMain()
    }

    private fun setLoading(loading: Boolean) {
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnLogin.isEnabled = !loading
    }

    private fun startMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}

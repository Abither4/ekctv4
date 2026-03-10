package com.streamvault.app.ui.stremio

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import com.streamvault.app.data.api.StremioMeta
import com.streamvault.app.data.repository.SessionManager
import com.streamvault.app.data.repository.StremioRepository
import com.streamvault.app.databinding.FragmentStremioBinding
import com.streamvault.app.ui.player.PlayerActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class StremioFragment : Fragment() {

    @Inject lateinit var stremioRepository: StremioRepository
    @Inject lateinit var sessionManager: SessionManager

    private var _binding: FragmentStremioBinding? = null
    private val binding get() = _binding!!

    private val installedAddons = mutableListOf<String>()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentStremioBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.rvStremio.layoutManager = GridLayoutManager(requireContext(), 3)

        val config = sessionManager.stremioConfig
        if (config != null) {
            installedAddons.addAll(config.addons)
        }

        binding.btnAddAddon.setOnClickListener {
            val url = binding.etAddonUrl.text.toString().trim()
            if (url.isNotEmpty()) {
                addAddon(url)
            }
        }

        if (installedAddons.isNotEmpty()) {
            loadCatalog(installedAddons.first(), "movie", "top")
        }
    }

    private fun addAddon(url: String) {
        lifecycleScope.launch {
            stremioRepository.getAddonManifest(url).onSuccess { manifest ->
                Toast.makeText(requireContext(), "Added: ${manifest.name}", Toast.LENGTH_SHORT).show()
                installedAddons.add(url)
                val config = sessionManager.stremioConfig
                if (config != null) {
                    sessionManager.stremioConfig = config.copy(addons = installedAddons.toList())
                }
                // Load first catalog
                manifest.catalogs?.firstOrNull()?.let { cat ->
                    loadCatalog(url, cat.type ?: "movie", cat.id ?: "top")
                }
            }.onFailure {
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadCatalog(addonUrl: String, type: String, catalogId: String) {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            stremioRepository.getCatalog(addonUrl, type, catalogId).onSuccess { response ->
                binding.rvStremio.adapter = StremioAdapter(response.metas ?: emptyList()) { meta ->
                    loadStreams(addonUrl, meta)
                }
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadStreams(addonUrl: String, meta: StremioMeta) {
        lifecycleScope.launch {
            stremioRepository.getStreams(addonUrl, meta.type ?: "movie", meta.id ?: "").onSuccess { response ->
                val stream = response.streams?.firstOrNull()
                if (stream?.url != null) {
                    startActivity(Intent(requireContext(), PlayerActivity::class.java).apply {
                        putExtra(PlayerActivity.EXTRA_STREAM_URL, stream.url)
                        putExtra(PlayerActivity.EXTRA_STREAM_TITLE, meta.name ?: "Stream")
                    })
                } else {
                    Toast.makeText(requireContext(), "No streams available", Toast.LENGTH_SHORT).show()
                }
            }.onFailure {
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}

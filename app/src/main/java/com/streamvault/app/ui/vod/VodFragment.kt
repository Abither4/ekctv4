package com.streamvault.app.ui.vod

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import com.streamvault.app.data.repository.IptvRepository
import com.streamvault.app.databinding.FragmentVodBinding
import com.streamvault.app.ui.live.CategoryAdapter
import com.streamvault.app.ui.player.PlayerActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class VodFragment : Fragment() {

    @Inject lateinit var iptvRepository: IptvRepository
    private var _binding: FragmentVodBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentVodBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.rvCategories.layoutManager = LinearLayoutManager(requireContext())
        binding.rvVod.layoutManager = GridLayoutManager(requireContext(), 3)
        loadCategories()
    }

    private fun loadCategories() {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            iptvRepository.getVodCategories().onSuccess { cats ->
                binding.rvCategories.adapter = CategoryAdapter(cats) { loadVod(it.categoryId) }
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadVod(categoryId: String) {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            iptvRepository.getVodStreams(categoryId).onSuccess { list ->
                binding.rvVod.adapter = VodAdapter(list) { vod ->
                    val url = iptvRepository.buildStreamUrl(vod.streamId ?: 0, "movie", vod.containerExtension ?: "mp4")
                    startActivity(Intent(requireContext(), PlayerActivity::class.java).apply {
                        putExtra(PlayerActivity.EXTRA_STREAM_URL, url)
                        putExtra(PlayerActivity.EXTRA_STREAM_TITLE, vod.name)
                    })
                }
                binding.rvCategories.visibility = View.GONE
                binding.rvVod.visibility = View.VISIBLE
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}

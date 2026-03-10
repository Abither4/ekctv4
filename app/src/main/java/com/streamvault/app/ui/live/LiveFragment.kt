package com.streamvault.app.ui.live

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.streamvault.app.data.model.XtreamCategory
import com.streamvault.app.data.model.XtreamLiveStream
import com.streamvault.app.data.repository.IptvRepository
import com.streamvault.app.databinding.FragmentLiveBinding
import com.streamvault.app.ui.player.PlayerActivity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class LiveFragment : Fragment() {

    @Inject lateinit var iptvRepository: IptvRepository

    private var _binding: FragmentLiveBinding? = null
    private val binding get() = _binding!!

    private var categories = listOf<XtreamCategory>()
    private var streams = listOf<XtreamLiveStream>()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentLiveBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.rvCategories.layoutManager = LinearLayoutManager(requireContext())
        binding.rvStreams.layoutManager = LinearLayoutManager(requireContext())
        loadCategories()
    }

    private fun loadCategories() {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            iptvRepository.getLiveCategories().onSuccess { cats ->
                categories = cats
                binding.rvCategories.adapter = CategoryAdapter(cats) { category ->
                    loadStreams(category.categoryId)
                }
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed to load: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadStreams(categoryId: String) {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            iptvRepository.getLiveStreams(categoryId).onSuccess { list ->
                streams = list
                binding.rvStreams.adapter = StreamAdapter(list) { stream ->
                    val url = iptvRepository.buildStreamUrl(stream.streamId ?: 0, "live")
                    startActivity(Intent(requireContext(), PlayerActivity::class.java).apply {
                        putExtra(PlayerActivity.EXTRA_STREAM_URL, url)
                        putExtra(PlayerActivity.EXTRA_STREAM_TITLE, stream.name)
                    })
                }
                binding.rvCategories.visibility = View.GONE
                binding.rvStreams.visibility = View.VISIBLE
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

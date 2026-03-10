package com.streamvault.app.ui.series

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
import com.streamvault.app.databinding.FragmentSeriesBinding
import com.streamvault.app.ui.live.CategoryAdapter
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class SeriesFragment : Fragment() {

    @Inject lateinit var iptvRepository: IptvRepository
    private var _binding: FragmentSeriesBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSeriesBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.rvCategories.layoutManager = LinearLayoutManager(requireContext())
        binding.rvSeries.layoutManager = GridLayoutManager(requireContext(), 3)
        loadCategories()
    }

    private fun loadCategories() {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            iptvRepository.getSeriesCategories().onSuccess { cats ->
                binding.rvCategories.adapter = CategoryAdapter(cats) { loadSeries(it.categoryId) }
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadSeries(categoryId: String) {
        lifecycleScope.launch {
            binding.progressBar.visibility = View.VISIBLE
            iptvRepository.getSeries(categoryId).onSuccess { list ->
                binding.rvSeries.adapter = SeriesAdapter(list) { /* open detail */ }
                binding.rvCategories.visibility = View.GONE
                binding.rvSeries.visibility = View.VISIBLE
                binding.progressBar.visibility = View.GONE
            }.onFailure {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed: ${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}

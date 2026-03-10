package com.streamvault.app.ui.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.streamvault.app.data.repository.SessionManager
import com.streamvault.app.databinding.FragmentSettingsBinding
import com.streamvault.app.ui.home.MainActivity
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class SettingsFragment : Fragment() {

    @Inject lateinit var sessionManager: SessionManager
    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val session = sessionManager.session
        binding.tvUsername.text = session?.username ?: "N/A"
        binding.tvServer.text = session?.serverUrl ?: "N/A"
        binding.tvType.text = session?.type?.name ?: "N/A"

        binding.btnLogout.setOnClickListener {
            (activity as? MainActivity)?.logout()
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _binding = null }
}

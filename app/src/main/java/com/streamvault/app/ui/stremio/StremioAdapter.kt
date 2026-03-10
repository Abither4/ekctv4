package com.streamvault.app.ui.stremio

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamvault.app.R
import com.streamvault.app.data.api.StremioMeta
import com.streamvault.app.databinding.ItemVodBinding

class StremioAdapter(
    private val items: List<StremioMeta>,
    private val onClick: (StremioMeta) -> Unit
) : RecyclerView.Adapter<StremioAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemVodBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemVodBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        holder.binding.tvVodName.text = item.name ?: ""
        holder.binding.tvVodRating.text = item.imdbRating ?: ""
        Glide.with(holder.binding.root.context)
            .load(item.poster)
            .placeholder(R.drawable.ic_movie_placeholder)
            .into(holder.binding.ivVodPoster)
        holder.binding.root.setOnClickListener { onClick(item) }
    }

    override fun getItemCount() = items.size
}

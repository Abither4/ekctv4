package com.streamvault.app.ui.vod

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamvault.app.R
import com.streamvault.app.data.model.XtreamVodStream
import com.streamvault.app.databinding.ItemVodBinding

class VodAdapter(
    private val items: List<XtreamVodStream>,
    private val onClick: (XtreamVodStream) -> Unit
) : RecyclerView.Adapter<VodAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemVodBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemVodBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        holder.binding.tvVodName.text = item.name
        holder.binding.tvVodRating.text = item.rating ?: ""
        Glide.with(holder.binding.root.context)
            .load(item.streamIcon)
            .placeholder(R.drawable.ic_movie_placeholder)
            .into(holder.binding.ivVodPoster)
        holder.binding.root.setOnClickListener { onClick(item) }
    }

    override fun getItemCount() = items.size
}

package com.streamvault.app.ui.live

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamvault.app.R
import com.streamvault.app.data.model.XtreamLiveStream
import com.streamvault.app.databinding.ItemStreamBinding

class StreamAdapter(
    private val streams: List<XtreamLiveStream>,
    private val onClick: (XtreamLiveStream) -> Unit
) : RecyclerView.Adapter<StreamAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemStreamBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemStreamBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val stream = streams[position]
        holder.binding.tvStreamName.text = stream.name
        Glide.with(holder.binding.root.context)
            .load(stream.streamIcon)
            .placeholder(R.drawable.ic_tv_placeholder)
            .into(holder.binding.ivStreamIcon)
        holder.binding.root.setOnClickListener { onClick(stream) }
    }

    override fun getItemCount() = streams.size
}

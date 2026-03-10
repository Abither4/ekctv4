package com.streamvault.app.ui.live

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.streamvault.app.data.model.XtreamCategory
import com.streamvault.app.databinding.ItemCategoryBinding

class CategoryAdapter(
    private val categories: List<XtreamCategory>,
    private val onClick: (XtreamCategory) -> Unit
) : RecyclerView.Adapter<CategoryAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemCategoryBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemCategoryBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val category = categories[position]
        holder.binding.tvCategoryName.text = category.categoryName
        holder.binding.root.setOnClickListener { onClick(category) }
    }

    override fun getItemCount() = categories.size
}

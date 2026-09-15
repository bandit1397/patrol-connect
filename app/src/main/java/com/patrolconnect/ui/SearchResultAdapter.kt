package com.patrolconnect.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.patrolconnect.databinding.ItemSearchResultBinding
import com.patrolconnect.geo.GeocodeResult

class SearchResultAdapter(
    private val onSelect: (GeocodeResult) -> Unit
) : RecyclerView.Adapter<SearchResultAdapter.ViewHolder>() {

    private val items = mutableListOf<GeocodeResult>()

    fun submitList(newItems: List<GeocodeResult>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemSearchResultBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(items[position])

    override fun getItemCount() = items.size

    inner class ViewHolder(private val binding: ItemSearchResultBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(result: GeocodeResult) {
            binding.resultLabel.text = result.label
            binding.root.setOnClickListener { onSelect(result) }
        }
    }
}

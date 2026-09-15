package com.patrolconnect.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.patrolconnect.R
import com.patrolconnect.data.PatrolPoint
import com.patrolconnect.databinding.ItemPatrolPointBinding

class PointListAdapter(
    private val onDelete: (PatrolPoint) -> Unit
) : RecyclerView.Adapter<PointListAdapter.ViewHolder>() {

    private val items = mutableListOf<PatrolPoint>()

    fun submitList(newItems: List<PatrolPoint>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemPatrolPointBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(items[position])

    override fun getItemCount() = items.size

    inner class ViewHolder(private val binding: ItemPatrolPointBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(point: PatrolPoint) {
            binding.pointLabel.text = point.label
            binding.statusDot.setBackgroundResource(
                if (point.visited) R.drawable.ic_marker_done else R.drawable.ic_marker_pending
            )
            binding.deletePointButton.setOnClickListener { onDelete(point) }
        }
    }
}

package com.patrolconnect.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "patrol_points")
data class PatrolPoint(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val label: String,
    val lat: Double,
    val lng: Double,
    val visited: Boolean = false,
    val visitedAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis()
)

package com.patrolconnect.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "patrol_log")
data class PatrolLogEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val pointLabel: String,
    val visitedAt: Long,
    val dateKey: String // yyyy-MM-dd, used to scope "today's log"
)

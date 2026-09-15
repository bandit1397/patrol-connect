package com.patrolconnect.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PatrolLogDao {
    @Insert
    suspend fun insert(entry: PatrolLogEntry)

    @Query("SELECT * FROM patrol_log WHERE dateKey = :dateKey ORDER BY visitedAt ASC")
    fun observeForDate(dateKey: String): Flow<List<PatrolLogEntry>>
}

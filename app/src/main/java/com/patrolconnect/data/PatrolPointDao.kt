package com.patrolconnect.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface PatrolPointDao {
    @Query("SELECT * FROM patrol_points ORDER BY createdAt ASC")
    fun observeAll(): Flow<List<PatrolPoint>>

    @Query("SELECT * FROM patrol_points WHERE visited = 0")
    suspend fun getUnvisited(): List<PatrolPoint>

    @Query("SELECT * FROM patrol_points WHERE id = :id")
    suspend fun getById(id: Long): PatrolPoint?

    @Insert
    suspend fun insert(point: PatrolPoint): Long

    @Update
    suspend fun update(point: PatrolPoint)

    @Delete
    suspend fun delete(point: PatrolPoint)

    @Query("UPDATE patrol_points SET visited = 0, visitedAt = NULL")
    suspend fun resetAllVisited()
}

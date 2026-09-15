package com.patrolconnect.data

import com.patrolconnect.geo.DistanceUtils
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PatrolRepository(db: AppDatabase) {
    private val pointDao = db.patrolPointDao()
    private val logDao = db.patrolLogDao()

    fun observePoints() = pointDao.observeAll()

    fun observeTodayLog() = logDao.observeForDate(todayKey())

    suspend fun addPoint(label: String, lat: Double, lng: Double): Long =
        pointDao.insert(PatrolPoint(label = label, lat = lat, lng = lng))

    suspend fun deletePoint(point: PatrolPoint) = pointDao.delete(point)

    suspend fun getPoint(id: Long): PatrolPoint? = pointDao.getById(id)

    /** Nearest-neighbor by straight-line distance among points not yet visited today. */
    suspend fun findNearestUnvisited(fromLat: Double, fromLng: Double): PatrolPoint? =
        pointDao.getUnvisited().minByOrNull { DistanceUtils.meters(fromLat, fromLng, it.lat, it.lng) }

    suspend fun markVisited(pointId: Long) {
        val point = pointDao.getById(pointId) ?: return
        val now = System.currentTimeMillis()
        pointDao.update(point.copy(visited = true, visitedAt = now))
        logDao.insert(PatrolLogEntry(pointLabel = point.label, visitedAt = now, dateKey = todayKey()))
    }

    /** Called at the start of a new patrol run so previously completed points can be visited again. */
    suspend fun resetForNewPatrol() = pointDao.resetAllVisited()

    private fun todayKey(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
}

package com.patrolconnect.service

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.IBinder
import androidx.core.app.ActivityCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.patrolconnect.data.AppDatabase
import com.patrolconnect.data.PatrolPoint
import com.patrolconnect.data.PatrolRepository
import com.patrolconnect.kakao.KakaoMapLauncher
import com.patrolconnect.notification.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Owns the whole patrol run: tracks location, decides the next nearest unvisited
 * point, hands navigation off to Kakao Map, and watches a geofence around the
 * active target to detect arrival and advance automatically.
 */
class PatrolForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var repository: PatrolRepository
    private lateinit var fusedLocationClient: com.google.android.gms.location.FusedLocationProviderClient
    private lateinit var geofencingClient: GeofencingClient

    override fun onCreate() {
        super.onCreate()
        repository = PatrolRepository(AppDatabase.getInstance(this))
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        geofencingClient = LocationServices.getGeofencingClient(this)
        NotificationHelper.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NotificationHelper.NOTIF_ID_ONGOING, NotificationHelper.buildOngoingNotification(this))

        when (intent?.action) {
            ACTION_START -> scope.launch { beginPatrol() }
            ACTION_ARRIVED -> {
                val pointId = intent.getLongExtra(EXTRA_POINT_ID, -1L)
                if (pointId != -1L) scope.launch { handleArrival(pointId) }
            }
            ACTION_STOP -> {
                geofencingClient.removeGeofences(geofencePendingIntent())
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private suspend fun beginPatrol() {
        repository.resetForNewPatrol()
        val location = currentLocation() ?: return
        advanceToNearest(location.first, location.second, launchImmediately = true)
    }

    private suspend fun handleArrival(pointId: Long) {
        repository.markVisited(pointId)
        val arrivedPoint = repository.getPoint(pointId) ?: return
        advanceToNearest(arrivedPoint.lat, arrivedPoint.lng, launchImmediately = false)
    }

    private suspend fun advanceToNearest(fromLat: Double, fromLng: Double, launchImmediately: Boolean) {
        val next = repository.findNearestUnvisited(fromLat, fromLng)
        if (next == null) {
            geofencingClient.removeGeofences(geofencePendingIntent())
            NotificationHelper.showCompleted(this)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        registerGeofence(next)

        if (launchImmediately) {
            // First hop of the run: the user just tapped "start patrol" in the foreground app,
            // so we can open Kakao Map directly instead of going through a notification.
            KakaoMapLauncher.launchRoute(this, next.lat, next.lng, next.label)
        } else {
            NotificationHelper.showArrivalNotification(this, next)
        }
    }

    private suspend fun currentLocation(): Pair<Double, Double>? {
        if (ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }
        val location = fusedLocationClient
            .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
            .await() ?: return null
        return location.latitude to location.longitude
    }

    private fun registerGeofence(point: PatrolPoint) {
        if (ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val geofence = Geofence.Builder()
            .setRequestId(point.id.toString())
            .setCircularRegion(point.lat, point.lng, ARRIVAL_RADIUS_METERS)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()

        val pendingIntent = geofencePendingIntent()
        geofencingClient.removeGeofences(pendingIntent).addOnCompleteListener {
            geofencingClient.addGeofences(request, pendingIntent)
        }
    }

    private fun geofencePendingIntent(): PendingIntent {
        val intent = Intent(this, GeofenceBroadcastReceiver::class.java)
        return PendingIntent.getBroadcast(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.patrolconnect.action.START"
        const val ACTION_ARRIVED = "com.patrolconnect.action.ARRIVED"
        const val ACTION_STOP = "com.patrolconnect.action.STOP"
        const val EXTRA_POINT_ID = "extra_point_id"
        private const val ARRIVAL_RADIUS_METERS = 50f
    }
}

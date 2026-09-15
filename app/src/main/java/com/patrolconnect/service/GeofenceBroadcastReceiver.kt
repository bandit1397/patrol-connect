package com.patrolconnect.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        @Suppress("DEPRECATION")
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return

        val pointId = event.triggeringGeofences?.firstOrNull()?.requestId?.toLongOrNull() ?: return

        val serviceIntent = Intent(context, PatrolForegroundService::class.java).apply {
            action = PatrolForegroundService.ACTION_ARRIVED
            putExtra(PatrolForegroundService.EXTRA_POINT_ID, pointId)
        }
        context.startForegroundService(serviceIntent)
    }
}

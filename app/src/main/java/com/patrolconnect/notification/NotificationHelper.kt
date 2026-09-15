package com.patrolconnect.notification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.patrolconnect.R
import com.patrolconnect.data.PatrolPoint
import com.patrolconnect.kakao.KakaoTrampolineActivity

object NotificationHelper {
    const val CHANNEL_ONGOING = "patrol_ongoing"
    const val CHANNEL_ARRIVAL = "patrol_arrival"

    const val NOTIF_ID_ONGOING = 1
    const val NOTIF_ID_ARRIVAL = 2
    const val NOTIF_ID_COMPLETED = 3

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ONGOING,
                context.getString(R.string.notif_channel_ongoing_name),
                NotificationManager.IMPORTANCE_LOW
            )
        )

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ARRIVAL,
                context.getString(R.string.notif_channel_arrival_name),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                enableVibration(true)
                setBypassDnd(true)
            }
        )
    }

    fun buildOngoingNotification(context: Context): Notification =
        NotificationCompat.Builder(context, CHANNEL_ONGOING)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(context.getString(R.string.notif_ongoing_title))
            .setContentText(context.getString(R.string.notif_ongoing_text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    /**
     * Hybrid auto-advance notification: carries a full-screen intent so capable
     * devices jump straight into Kakao Map, and the identical action as its normal
     * tap target so devices that suppress the full-screen intent still advance
     * with a single tap.
     */
    fun showArrivalNotification(context: Context, next: PatrolPoint) {
        val trampolineIntent = Intent(context, KakaoTrampolineActivity::class.java).apply {
            putExtra(KakaoTrampolineActivity.EXTRA_LAT, next.lat)
            putExtra(KakaoTrampolineActivity.EXTRA_LNG, next.lng)
            putExtra(KakaoTrampolineActivity.EXTRA_LABEL, next.label)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(context, next.id.toInt(), trampolineIntent, flags)

        val canFullScreen = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        } else {
            true
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ARRIVAL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(context.getString(R.string.notif_arrival_title))
            .setContentText(context.getString(R.string.notif_arrival_text, next.label))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)

        if (canFullScreen) {
            builder.setFullScreenIntent(pendingIntent, true)
        }

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(NOTIF_ID_ARRIVAL, builder.build())
    }

    fun showCompleted(context: Context) {
        val builder = NotificationCompat.Builder(context, CHANNEL_ARRIVAL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(context.getString(R.string.notif_completed_title))
            .setContentText(context.getString(R.string.notif_completed_text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(NOTIF_ID_COMPLETED, builder.build())
    }
}

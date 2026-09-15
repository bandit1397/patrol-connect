package com.patrolconnect

import android.app.Application
import org.osmdroid.config.Configuration

class PatrolApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // osmdroid requires a distinct user agent to avoid being blocked by tile servers.
        Configuration.getInstance().userAgentValue = packageName
        Configuration.getInstance().load(
            this,
            getSharedPreferences("osmdroid_prefs", MODE_PRIVATE)
        )
    }
}

package com.patrolconnect.kakao

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

/**
 * Invisible hand-off screen used as the target of both the arrival notification's
 * full-screen intent and its regular tap action. Either path lands here and immediately
 * opens Kakao Map to the next patrol point, then closes itself.
 *
 * This is what makes the "hybrid" auto-advance work: when the OS/device allows a
 * full-screen intent to fire on its own (screen off, high-priority channel), this
 * activity launches Kakao Map with no user action. When the OS downgrades the
 * notification to a heads-up banner instead, the same activity opens after a single tap.
 */
class KakaoTrampolineActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        val lat = intent.getDoubleExtra(EXTRA_LAT, Double.NaN)
        val lng = intent.getDoubleExtra(EXTRA_LNG, Double.NaN)
        val label = intent.getStringExtra(EXTRA_LABEL).orEmpty()

        if (!lat.isNaN() && !lng.isNaN()) {
            KakaoMapLauncher.launchRoute(this, lat, lng, label)
        }
        finish()
    }

    companion object {
        const val EXTRA_LAT = "extra_lat"
        const val EXTRA_LNG = "extra_lng"
        const val EXTRA_LABEL = "extra_label"
    }
}

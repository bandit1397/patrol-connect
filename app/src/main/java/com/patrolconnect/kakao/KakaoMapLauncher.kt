package com.patrolconnect.kakao

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Hands navigation off to the Kakao Map app via its URL scheme. This is a deep link,
 * not a Kakao API call, so no API key or developer account is required.
 */
object KakaoMapLauncher {
    private const val KAKAO_MAP_PACKAGE = "net.daum.android.map"

    fun launchRoute(context: Context, destLat: Double, destLng: Double, label: String) {
        val uri = Uri.parse(
            "kakaomap://route?ep=$destLat,$destLng&by=CAR"
        )
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            setPackage(KAKAO_MAP_PACKAGE)
        }
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            openInstallPage(context)
        }
    }

    private fun openInstallPage(context: Context) {
        val marketIntent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("market://details?id=$KAKAO_MAP_PACKAGE")
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        try {
            context.startActivity(marketIntent)
        } catch (e: ActivityNotFoundException) {
            val webIntent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://play.google.com/store/apps/details?id=$KAKAO_MAP_PACKAGE")
            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            context.startActivity(webIntent)
        }
    }
}

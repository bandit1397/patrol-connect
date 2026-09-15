package com.patrolconnect.geo

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.net.URLEncoder

data class GeocodeResult(val label: String, val lat: Double, val lng: Double)

/**
 * Thin client for OSM's free Nominatim search API. No API key required, but its usage
 * policy requires a distinguishing User-Agent and asks callers to keep requests infrequent
 * (fine here: one request per manual address search).
 */
object NominatimClient {
    private const val BASE_URL = "https://nominatim.openstreetmap.org/search"
    private val client = OkHttpClient()

    suspend fun search(query: String, userAgent: String): List<GeocodeResult> = withContext(Dispatchers.IO) {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val url = "$BASE_URL?q=$encoded&format=json&limit=5"
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", userAgent)
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext emptyList()
            val body = response.body?.string() ?: return@withContext emptyList()
            parse(body)
        }
    }

    private fun parse(body: String): List<GeocodeResult> {
        val array = JSONArray(body)
        val results = mutableListOf<GeocodeResult>()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            results.add(
                GeocodeResult(
                    label = obj.optString("display_name"),
                    lat = obj.optString("lat").toDouble(),
                    lng = obj.optString("lon").toDouble()
                )
            )
        }
        return results
    }
}

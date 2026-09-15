package com.patrolconnect.ui

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.patrolconnect.R
import com.patrolconnect.data.AppDatabase
import com.patrolconnect.data.PatrolRepository
import com.patrolconnect.databinding.ActivityMainBinding
import com.patrolconnect.geo.NominatimClient
import com.patrolconnect.notification.NotificationHelper
import com.patrolconnect.service.PatrolForegroundService
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.events.MapEventsReceiver

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var repository: PatrolRepository
    private lateinit var pointAdapter: PointListAdapter
    private lateinit var searchAdapter: SearchResultAdapter
    private val markers = mutableMapOf<Long, Marker>()
    private var tapModeOn = false
    private var patrolActive = false

    private val locationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val fineGranted = results[Manifest.permission.ACCESS_FINE_LOCATION] == true
            if (fineGranted) {
                requestBackgroundLocationIfNeeded()
            } else {
                Toast.makeText(this, R.string.need_location_permission, Toast.LENGTH_LONG).show()
            }
        }

    private val backgroundLocationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* no-op either way */ }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* no-op either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        repository = PatrolRepository(AppDatabase.getInstance(this))
        NotificationHelper.ensureChannels(this)

        setupMap()
        setupPointsList()
        setupSearch()
        setupTapMode()
        setupStartButton()
        observePoints()
        ensurePermissions()
        checkFullScreenIntentPermission()
    }

    private fun setupMap() {
        Configuration.getInstance().userAgentValue = packageName
        binding.mapView.setTileSource(TileSourceFactory.MAPNIK)
        binding.mapView.setMultiTouchControls(true)
        binding.mapView.controller.setZoom(15.0)
        binding.mapView.controller.setCenter(GeoPoint(37.5665, 126.9780)) // default: Seoul

        val eventsOverlay = MapEventsOverlay(object : MapEventsReceiver {
            override fun singleTapConfirmedHelper(p: GeoPoint): Boolean {
                if (tapModeOn) {
                    addPoint(p.latitude, p.longitude, null)
                    return true
                }
                return false
            }

            override fun longPressHelper(p: GeoPoint): Boolean = false
        })
        binding.mapView.overlays.add(eventsOverlay)
    }

    private fun setupPointsList() {
        pointAdapter = PointListAdapter { point ->
            lifecycleScope.launch { repository.deletePoint(point) }
        }
        binding.pointsList.layoutManager = LinearLayoutManager(this)
        binding.pointsList.adapter = pointAdapter
    }

    private fun setupSearch() {
        searchAdapter = SearchResultAdapter { result ->
            addPoint(result.lat, result.lng, result.label)
            binding.searchResultsList.visibility = android.view.View.GONE
            binding.addressInput.setText("")
            moveCamera(result.lat, result.lng)
        }
        binding.searchResultsList.layoutManager = LinearLayoutManager(this)
        binding.searchResultsList.adapter = searchAdapter

        binding.searchButton.setOnClickListener { performSearch() }
        binding.addressInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                performSearch()
                true
            } else {
                false
            }
        }
    }

    private fun performSearch() {
        val query = binding.addressInput.text.toString().trim()
        if (query.isEmpty()) return
        lifecycleScope.launch {
            val results = NominatimClient.search(query, packageName)
            if (results.isEmpty()) {
                Toast.makeText(this@MainActivity, "검색 결과가 없습니다", Toast.LENGTH_SHORT).show()
                binding.searchResultsList.visibility = android.view.View.GONE
            } else {
                searchAdapter.submitList(results)
                binding.searchResultsList.visibility = android.view.View.VISIBLE
            }
        }
    }

    private fun setupTapMode() {
        binding.tapModeToggle.setOnCheckedChangeListener { _, checked -> tapModeOn = checked }
    }

    private fun addPoint(lat: Double, lng: Double, label: String?) {
        lifecycleScope.launch {
            val finalLabel = label ?: "지점 (%.5f, %.5f)".format(lat, lng)
            repository.addPoint(finalLabel, lat, lng)
        }
    }

    private fun observePoints() {
        lifecycleScope.launch {
            repository.observePoints().collect { points ->
                pointAdapter.submitList(points)
                binding.noPointsText.visibility =
                    if (points.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE
                syncMarkers(points)
            }
        }
    }

    private fun syncMarkers(points: List<com.patrolconnect.data.PatrolPoint>) {
        val currentIds = points.map { it.id }.toSet()
        val toRemove = markers.keys - currentIds
        toRemove.forEach { id ->
            markers[id]?.let { binding.mapView.overlays.remove(it) }
            markers.remove(id)
        }
        points.forEach { point ->
            val marker = markers.getOrPut(point.id) {
                Marker(binding.mapView).also { binding.mapView.overlays.add(it) }
            }
            marker.position = GeoPoint(point.lat, point.lng)
            marker.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
            marker.icon = ContextCompat.getDrawable(
                this,
                if (point.visited) R.drawable.ic_marker_done else R.drawable.ic_marker_pending
            )
            marker.title = point.label
        }
        binding.mapView.invalidate()
    }

    private fun moveCamera(lat: Double, lng: Double) {
        binding.mapView.controller.animateTo(GeoPoint(lat, lng))
    }

    private fun setupStartButton() {
        binding.startPatrolButton.setOnClickListener {
            if (!patrolActive) {
                if (!hasFineLocationPermission()) {
                    ensurePermissions()
                    return@setOnClickListener
                }
                ContextCompat.startForegroundService(
                    this,
                    Intent(this, PatrolForegroundService::class.java).setAction(PatrolForegroundService.ACTION_START)
                )
                patrolActive = true
                binding.startPatrolButton.text = getString(R.string.action_stop_patrol)
            } else {
                ContextCompat.startForegroundService(
                    this,
                    Intent(this, PatrolForegroundService::class.java).setAction(PatrolForegroundService.ACTION_STOP)
                )
                patrolActive = false
                binding.startPatrolButton.text = getString(R.string.action_start_patrol)
            }
        }
    }

    private fun hasFineLocationPermission(): Boolean =
        ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun ensurePermissions() {
        if (!hasFineLocationPermission()) {
            locationPermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        } else {
            requestBackgroundLocationIfNeeded()
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        AlertDialog.Builder(this)
            .setMessage(R.string.need_background_location_permission)
            .setPositiveButton(R.string.grant) { _, _ ->
                backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun checkFullScreenIntentPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
        val manager = getSystemService<NotificationManager>() ?: return
        if (manager.canUseFullScreenIntent()) return

        AlertDialog.Builder(this)
            .setMessage(R.string.need_full_screen_intent_permission)
            .setPositiveButton(R.string.grant) { _, _ ->
                val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                    data = Uri.fromParts("package", packageName, null)
                }
                startActivity(intent)
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    override fun onResume() {
        super.onResume()
        binding.mapView.onResume()
    }

    override fun onPause() {
        super.onPause()
        binding.mapView.onPause()
    }
}

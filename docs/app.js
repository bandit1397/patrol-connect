// Patrol Connect — web prototype
// Same core logic as the native Android app (nearest-unvisited-point auto sequencing,
// Kakao Map hand-off), minus the OS-level automation a browser can't do:
// every hop into Kakao Map needs one tap here, since browsers block scripts from
// opening another app without a real user gesture.

const STORAGE_KEY = 'patrol_points_v1';
const ARRIVAL_RADIUS_METERS = 50;
const KAKAO_PACKAGE = 'net.daum.android.map';

let points = loadPoints();
let tapModeOn = false;
let patrolActive = false;
let currentTarget = null; // point currently being navigated to
let watchId = null;
let markers = {}; // id -> Leaflet marker

// ---------- storage ----------
function loadPoints() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function savePoints() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
}

// ---------- distance ----------
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestUnvisited(lat, lng) {
  const unvisited = points.filter(p => !p.visited);
  if (unvisited.length === 0) return null;
  let best = unvisited[0];
  let bestDist = distanceMeters(lat, lng, best.lat, best.lng);
  for (const p of unvisited.slice(1)) {
    const d = distanceMeters(lat, lng, p.lat, p.lng);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

// ---------- map ----------
const map = L.map('map').setView([37.5665, 126.9780], 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

map.on('click', (e) => {
  if (!tapModeOn) return;
  addPoint(`지점 (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`, e.latlng.lat, e.latlng.lng);
});

function markerIcon(visited) {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${visited ? '#2E7D32' : '#E53935'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22]
  });
}

function syncMarkers() {
  const currentIds = new Set(points.map(p => p.id));
  for (const id of Object.keys(markers)) {
    if (!currentIds.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
  }
  for (const p of points) {
    if (!markers[p.id]) {
      markers[p.id] = L.marker([p.lat, p.lng], { icon: markerIcon(p.visited) }).addTo(map);
    } else {
      markers[p.id].setLatLng([p.lat, p.lng]);
      markers[p.id].setIcon(markerIcon(p.visited));
    }
    markers[p.id].bindPopup(p.label);
  }
}

// ---------- points list ----------
function renderPointsList() {
  const list = document.getElementById('pointsList');
  const noPoints = document.getElementById('noPoints');
  const count = document.getElementById('pointCount');
  list.innerHTML = '';
  count.textContent = points.length ? `${points.filter(p => p.visited).length}/${points.length} 완료` : '';
  noPoints.classList.toggle('hidden', points.length > 0);

  for (const p of points) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="dot ${p.visited ? 'done' : 'pending'}"></span>
      <span class="label">${escapeHtml(p.label)}</span>
      <button class="delete" data-id="${p.id}">삭제</button>
    `;
    list.appendChild(li);
  }
  list.querySelectorAll('button.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      points = points.filter(p => p.id !== btn.dataset.id);
      savePoints();
      renderAll();
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderAll() {
  savePoints();
  renderPointsList();
  syncMarkers();
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function addPoint(label, lat, lng) {
  points.push({ id: makeId(), label, lat, lng, visited: false });
  renderAll();
  showToast('지점이 추가되었습니다');
}

// ---------- search (Nominatim, free, no key) ----------
async function searchAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url); // browsers can't set a custom User-Agent, but always send Referer,
  if (!res.ok) return [];       // which is what Nominatim's usage policy asks apps to identify with
  return res.json();
}

document.getElementById('searchBtn').addEventListener('click', doSearch);
document.getElementById('addressInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const input = document.getElementById('addressInput');
  const query = input.value.trim();
  if (!query) return;
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '<li>검색중...</li>';
  resultsEl.classList.remove('hidden');

  const results = await searchAddress(query);
  resultsEl.innerHTML = '';
  if (results.length === 0) {
    resultsEl.innerHTML = '<li>검색 결과가 없습니다</li>';
    return;
  }
  for (const r of results) {
    const li = document.createElement('li');
    li.textContent = r.display_name;
    li.addEventListener('click', () => {
      addPoint(r.display_name, parseFloat(r.lat), parseFloat(r.lon));
      map.setView([r.lat, r.lon], 17);
      resultsEl.classList.add('hidden');
      input.value = '';
    });
    resultsEl.appendChild(li);
  }
}

// ---------- tap mode ----------
const tapModeBtn = document.getElementById('tapModeBtn');
tapModeBtn.addEventListener('click', () => {
  tapModeOn = !tapModeOn;
  tapModeBtn.classList.toggle('active', tapModeOn);
});

// ---------- kakao hand-off ----------
function launchKakao(point) {
  const uri = `kakaomap://route?ep=${point.lat},${point.lng}&by=CAR`;
  const fallbackUrl = `https://play.google.com/store/apps/details?id=${KAKAO_PACKAGE}`;

  let didHide = false;
  const onHide = () => { didHide = true; };
  document.addEventListener('visibilitychange', onHide, { once: true });

  window.location.href = uri;

  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    if (!didHide) {
      // Kakao Map likely isn't installed on this device/browser — offer the install page.
      showToast('카카오맵 앱이 없으면 설치 페이지로 이동합니다');
      window.location.href = fallbackUrl;
    }
  }, 1500);
}

// ---------- patrol flow ----------
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const arrivalBanner = document.getElementById('arrivalBanner');
const arrivalText = document.getElementById('arrivalText');
const arrivalGoBtn = document.getElementById('arrivalGoBtn');

startBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showToast('이 브라우저는 위치 정보를 지원하지 않습니다');
    return;
  }
  points = points.map(p => ({ ...p, visited: false }));
  renderAll();

  navigator.geolocation.getCurrentPosition(
    (pos) => beginLeg(pos.coords.latitude, pos.coords.longitude),
    () => showToast('위치 권한이 필요합니다'),
    { enableHighAccuracy: true }
  );
});

stopBtn.addEventListener('click', stopPatrol);

function beginLeg(fromLat, fromLng) {
  const next = findNearestUnvisited(fromLat, fromLng);
  if (!next) { finishPatrol(); return; }

  currentTarget = next;
  patrolActive = true;
  startBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  arrivalBanner.classList.add('hidden');

  launchKakao(next);
  startWatch();
}

function startWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => checkArrival(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function checkArrival(lat, lng) {
  if (!currentTarget) return;
  const d = distanceMeters(lat, lng, currentTarget.lat, currentTarget.lng);
  if (d <= ARRIVAL_RADIUS_METERS) {
    markArrived(lat, lng);
  }
}

function markArrived(lat, lng) {
  points = points.map(p => p.id === currentTarget.id ? { ...p, visited: true } : p);
  renderAll();

  const next = findNearestUnvisited(lat, lng);
  if (!next) { finishPatrol(); return; }

  currentTarget = next;
  arrivalText.textContent = `${next.label} 지점으로 안내`;
  arrivalBanner.classList.remove('hidden');
}

arrivalGoBtn.addEventListener('click', () => {
  arrivalBanner.classList.add('hidden');
  launchKakao(currentTarget);
});

// When the tab regains focus after visiting Kakao Map, watchPosition may have been
// suspended by the browser — force one fresh location check right away.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && patrolActive && currentTarget) {
    navigator.geolocation.getCurrentPosition(
      (pos) => checkArrival(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { enableHighAccuracy: true }
    );
  }
});

function finishPatrol() {
  showToast('모든 지점을 순찰했습니다');
  stopPatrol();
}

function stopPatrol() {
  patrolActive = false;
  currentTarget = null;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  arrivalBanner.classList.add('hidden');
}

// ---------- toast ----------
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ---------- init ----------
renderAll();

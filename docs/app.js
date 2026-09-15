// Officer-facing patrol navigation. Points are read-only here — they come from
// points.json, which only the admin (admin.html) edits and commits. This page just
// lets the officer pick which categories to patrol today, then hands off to Kakao
// Map for each nearest-unvisited stop.

const ARRIVAL_RADIUS_METERS = 50;
const VISITED_KEY = 'patrol_visited_v1';

let allPoints = [];
let selectedCategories = new Set();
let visited = loadVisited();
let patrolActive = false;
let currentTarget = null;
let watchId = null;
let markers = {};

// ---------- visited (local per-device progress, separate from the shared point list) ----------
function loadVisited() {
  try { return JSON.parse(localStorage.getItem(VISITED_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveVisited() {
  localStorage.setItem(VISITED_KEY, JSON.stringify(visited));
}

// ---------- map ----------
const map = L.map('map').setView([37.5665, 126.9780], 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function markerIcon(isVisited) {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${isVisited ? '#2E7D32' : '#E53935'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22]
  });
}

function filteredPoints() {
  return allPoints.filter(p => selectedCategories.has(p.category));
}

function syncMarkers() {
  const shown = filteredPoints();
  const currentIds = new Set(shown.map(p => p.id));
  for (const id of Object.keys(markers)) {
    if (!currentIds.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
  }
  for (const p of shown) {
    const isVisited = !!visited[p.id];
    if (!markers[p.id]) {
      markers[p.id] = L.marker([p.lat, p.lng], { icon: markerIcon(isVisited) }).addTo(map);
    } else {
      markers[p.id].setIcon(markerIcon(isVisited));
    }
    markers[p.id].bindPopup(p.label);
  }
}

// ---------- category tabs ----------
function renderTabs() {
  const wrap = document.getElementById('categoryTabs');
  const noCategories = document.getElementById('noCategories');
  const categories = [...new Set(allPoints.map(p => p.category))];
  noCategories.classList.toggle('hidden', categories.length > 0);

  wrap.innerHTML = '';
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.className = 'tab-btn' + (selectedCategories.has(cat) ? ' active' : '');
    btn.addEventListener('click', () => {
      if (selectedCategories.has(cat)) selectedCategories.delete(cat);
      else selectedCategories.add(cat);
      renderTabs();
      renderPointsList();
      syncMarkers();
    });
    wrap.appendChild(btn);
  }
}

// ---------- points list (read-only) ----------
function renderPointsList() {
  const list = document.getElementById('pointsList');
  const noPoints = document.getElementById('noPoints');
  const count = document.getElementById('pointCount');
  const shown = filteredPoints();

  list.innerHTML = '';
  const doneCount = shown.filter(p => visited[p.id]).length;
  count.textContent = shown.length ? `${doneCount}/${shown.length} 완료` : '';
  noPoints.classList.toggle('hidden', shown.length > 0);

  for (const p of shown) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="dot ${visited[p.id] ? 'done' : 'pending'}"></span>
      <span class="label">${escapeHtml(p.label)}</span>
    `;
    list.appendChild(li);
  }

  document.getElementById('startBtn').disabled = shown.length === 0 || patrolActive;
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
  // Fresh run: clear visited status for whatever is in scope today.
  for (const p of filteredPoints()) delete visited[p.id];
  saveVisited();
  renderPointsList();
  syncMarkers();

  navigator.geolocation.getCurrentPosition(
    (pos) => beginLeg(pos.coords.latitude, pos.coords.longitude),
    () => showToast('위치 권한이 필요합니다'),
    { enableHighAccuracy: true }
  );
});

stopBtn.addEventListener('click', stopPatrol);

function beginLeg(fromLat, fromLng) {
  const next = findNearest(filteredPoints().filter(p => !visited[p.id]), fromLat, fromLng);
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
  if (d <= ARRIVAL_RADIUS_METERS) markArrived(lat, lng);
}

function markArrived(lat, lng) {
  visited[currentTarget.id] = true;
  saveVisited();
  renderPointsList();
  syncMarkers();

  const next = findNearest(filteredPoints().filter(p => !visited[p.id]), lat, lng);
  if (!next) { finishPatrol(); return; }

  currentTarget = next;
  arrivalText.textContent = `${next.label} 지점으로 안내`;
  arrivalBanner.classList.remove('hidden');
}

arrivalGoBtn.addEventListener('click', () => {
  arrivalBanner.classList.add('hidden');
  launchKakao(currentTarget);
});

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
  showToast('선택한 종류의 지점을 모두 순찰했습니다');
  stopPatrol();
}

function stopPatrol() {
  patrolActive = false;
  currentTarget = null;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  arrivalBanner.classList.add('hidden');
  renderPointsList();
}

// ---------- init ----------
async function init() {
  try {
    const res = await fetch(`points.json?v=${Date.now()}`);
    allPoints = res.ok ? await res.json() : [];
  } catch (e) {
    allPoints = [];
  }
  renderTabs();
  renderPointsList();
  syncMarkers();
}

init();

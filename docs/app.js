// Officer-facing patrol navigation. Points are read-only here — they come from
// points.json, which only the admin (admin.html) edits and commits. The map is the
// whole interface: the officer picks which categories to patrol, then taps stops
// directly on the map one at a time, each tap handing that leg to Kakao Map. There
// is no automatic "nearest stop" selection: GPS accuracy can't reliably tell apart
// stops that sit closer together than its own error margin (e.g. bank branches
// 40-60m apart), so the officer always chooses.
//
// The run itself lives in localStorage, not just in memory: handing off to Kakao Map
// puts this tab in the background, and Android is free to discard and reload a
// background tab at any time. Without persistence that reload wiped the run, which
// left the patrol apparently stuck on the first stop. On load we resume it.

const DEFAULT_RADIUS_METERS = 50;
const VISITED_KEY = 'patrol_visited_v1';
const SESSION_KEY = 'patrol_session_v1';
const RADIUS_KEY = 'patrol_radius_v1';

let allPoints = [];
let selectedCategories = new Set();
let visited = loadJson(VISITED_KEY, {});   // id -> true (완료) | 'skip' (건너뜀)
let session = loadJson(SESSION_KEY, null); // { active, targetId, categories, startedAt }
let arrivalRadius = Number(localStorage.getItem(RADIUS_KEY)) || DEFAULT_RADIUS_METERS;
let watchId = null;
let markers = {};
let lastFix = null; // { lat, lng, accuracy }

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
function saveVisited() { saveJson(VISITED_KEY, visited); }
function saveSession() { saveJson(SESSION_KEY, session); }

function isActive() { return !!(session && session.active); }
function pointById(id) { return allPoints.find(p => p.id === id) || null; }
function currentTarget() { return isActive() ? pointById(session.targetId) : null; }

// ---------- map ----------
const map = L.map('map').setView([37.5665, 126.9780], 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function markerColor(p) {
  if (visited[p.id] === true) return '#2E7D32';               // 완료
  if (visited[p.id] === 'skip') return '#9E9E9E';             // 건너뜀
  if (session && session.targetId === p.id) return '#1565C0'; // 현재 목표
  return '#E53935';                                           // 미방문
}

function markerIcon(p) {
  const isTarget = !!(session && session.targetId === p.id);
  const size = isTarget ? 28 : 22;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${markerColor(p)};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size]
  });
}

function filteredPoints() {
  return allPoints.filter(p => selectedCategories.has(p.category));
}

// Keeps the selected stops on screen — they are usually nowhere near the default view.
function fitToPoints() {
  const shown = filteredPoints();
  if (!shown.length) return;
  map.fitBounds(L.latLngBounds(shown.map(p => [p.lat, p.lng])).pad(0.3), { maxZoom: 17 });
}
function pendingPoints() {
  return filteredPoints().filter(p => !visited[p.id]);
}

function syncMarkers() {
  const shown = filteredPoints();
  const currentIds = new Set(shown.map(p => p.id));
  for (const id of Object.keys(markers)) {
    if (!currentIds.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
  }
  for (const p of shown) {
    if (!markers[p.id]) {
      markers[p.id] = L.marker([p.lat, p.lng], { icon: markerIcon(p) }).addTo(map);
      // Tapping a marker is the whole interaction: pick it, patrol it, tap the next.
      markers[p.id].on('click', () => manualSelect(p.id));
    } else {
      markers[p.id].setIcon(markerIcon(p));
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
    btn.disabled = isActive(); // 순찰 중에는 대상 종류를 바꾸지 않는다
    btn.addEventListener('click', () => {
      if (selectedCategories.has(cat)) selectedCategories.delete(cat);
      else selectedCategories.add(cat);
      renderAll();
      fitToPoints();
    });
    wrap.appendChild(btn);
  }
}

// ---------- controls ----------
// No list — the map itself is the interface. This just keeps the start button and
// the "pick a category first" hint in sync with what's selected.
function renderControls() {
  document.getElementById('noPoints').classList.toggle('hidden', filteredPoints().length > 0);
  document.getElementById('startBtn').disabled = filteredPoints().length === 0 || isActive();
}

function renderCurrentBox() {
  const box = document.getElementById('currentBox');
  const text = document.getElementById('currentText');
  const btnRow = box.querySelector('.btn-row');
  const target = currentTarget();

  box.classList.toggle('hidden', !isActive());
  if (!isActive()) return;

  if (!target) {
    btnRow.classList.add('hidden');
    text.innerHTML = `지도에서 다음 지점을 선택하세요 · 남은 지점 ${pendingPoints().length}곳`;
    return;
  }

  btnRow.classList.remove('hidden');
  let line = `현재 목표: <b>${escapeHtml(target.label)}</b>`;
  if (lastFix) {
    line += ` · 약 ${Math.round(distanceMeters(lastFix.lat, lastFix.lng, target.lat, target.lng))}m`;
  }
  line += ` · 남은 지점 ${pendingPoints().length}곳`;
  text.innerHTML = line;
}

function renderAll() {
  renderTabs();
  renderCurrentBox();
  renderControls();
  syncMarkers();
}

// ---------- patrol flow ----------
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const stopBtn = document.getElementById('stopBtn');
const arrivalBanner = document.getElementById('arrivalBanner');
const arrivalText = document.getElementById('arrivalText');

startBtn.addEventListener('click', () => {
  if (filteredPoints().length === 0) return;
  activateSession();
  renderAll();
  showToast('지도에서 순찰할 지점을 선택하세요');
});

// Mid-patrol reset: clear today's progress and start over from the first stop,
// without having to finish (or skip) whatever's still pending first.
resetBtn.addEventListener('click', () => {
  if (!confirm('지금까지의 진행 상황을 지우고 처음부터 다시 시작할까요?')) return;
  activateSession();
  renderAll();
  showToast('초기화되었습니다 · 지도에서 순찰할 지점을 선택하세요');
});

// Fresh run: clear today's progress and open an active session with no target yet —
// the officer picks the first stop by tapping it on the map.
function activateSession() {
  for (const p of filteredPoints()) delete visited[p.id];
  saveVisited();

  session = {
    active: true,
    targetId: null,
    categories: [...selectedCategories],
    startedAt: Date.now()
  };
  saveSession();

  startBtn.classList.add('hidden');
  resetBtn.classList.remove('hidden');
  stopBtn.classList.remove('hidden');
  arrivalBanner.classList.add('hidden');
  if (navigator.geolocation) startWatch();
}

function startWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      renderCurrentBox();
      checkArrival(lastFix.lat, lastFix.lng);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function checkArrival(lat, lng) {
  const target = currentTarget();
  if (!target) return;
  if (distanceMeters(lat, lng, target.lat, target.lng) <= arrivalRadius) {
    markArrived(false);
  }
}

// Marks the current stop done and clears the target — the officer taps the next
// stop on the map rather than the app guessing the nearest one.
function markArrived(userInitiated) {
  const target = currentTarget();
  if (!target) return;
  visited[target.id] = true;
  saveVisited();
  advanceFrom(`${target.label} 순찰 완료`, userInitiated);
}

function skipCurrent() {
  const target = currentTarget();
  if (!target) return;
  visited[target.id] = 'skip';
  saveVisited();
  advanceFrom(`${target.label} 건너뜀`, true);
}

function advanceFrom(doneMsg, userInitiated) {
  session.targetId = null;
  saveSession();
  renderAll();

  if (pendingPoints().length === 0) {
    finishPatrol();
    return;
  }

  // A foreground page can show this right away. When it's backgrounded (officer
  // still inside Kakao Map) a toast may go unseen, so leave a banner for when they
  // come back instead.
  if (userInitiated || document.visibilityState === 'visible') {
    showToast(`${doneMsg} · 다음 지점을 선택하세요`);
  } else {
    arrivalText.textContent = `${doneMsg} · 지도에서 다음 지점을 선택하세요`;
    arrivalBanner.classList.remove('hidden');
  }
}

// ---------- manual controls ----------
document.getElementById('renavBtn').addEventListener('click', () => {
  const t = currentTarget();
  if (t) launchKakao(t);
});

document.getElementById('arrivedBtn').addEventListener('click', () => {
  if (!isActive()) return;
  markArrived(true);
});

document.getElementById('skipBtn').addEventListener('click', () => {
  if (!isActive()) return;
  skipCurrent();
});

// Picking a stop by tapping its marker on the map: during a run it switches the
// target by hand, before one it starts the patrol at that stop.
function manualSelect(id) {
  const p = pointById(id);
  if (!p) return;

  if (!isActive()) {
    activateSession();
    setTarget(id);
    return;
  }

  // 이미 완료/건너뛴 지점을 다시 고르면 미방문 상태로 되돌린다.
  if (visited[id]) { delete visited[id]; saveVisited(); }
  setTarget(id);
}

function setTarget(id) {
  session.targetId = id;
  saveSession();
  arrivalBanner.classList.add('hidden');
  renderAll();
  launchKakao(pointById(id));
  showToast(`${pointById(id).label}(으)로 안내합니다`);
}

document.getElementById('arrivalCloseBtn').addEventListener('click', () => {
  arrivalBanner.classList.add('hidden');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !isActive()) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      renderCurrentBox();
      checkArrival(lastFix.lat, lastFix.lng);
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function finishPatrol() {
  const scope = filteredPoints();
  const done = scope.filter(p => visited[p.id] === true).length;
  const skipped = scope.filter(p => visited[p.id] === 'skip').length;
  showToast(skipped
    ? `순찰 종료 · 완료 ${done}곳, 건너뜀 ${skipped}곳`
    : `선택한 종류의 지점 ${done}곳을 모두 순찰했습니다`);
  stopPatrol();
}

function stopPatrol() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  startBtn.classList.remove('hidden');
  resetBtn.classList.add('hidden');
  stopBtn.classList.add('hidden');
  arrivalBanner.classList.add('hidden');
  renderAll();
}

stopBtn.addEventListener('click', stopPatrol);

// ---------- arrival radius ----------
// Stops can sit closer together than the default 50 m (bank branches on one block),
// in which case a wide radius would tick several of them off at once.
const radiusSel = document.getElementById('radiusSel');
radiusSel.value = String(arrivalRadius);
radiusSel.addEventListener('change', () => {
  arrivalRadius = Number(radiusSel.value);
  localStorage.setItem(RADIUS_KEY, String(arrivalRadius));
  showToast(`도착 인정 반경 ${arrivalRadius}m`);
});

// ---------- init ----------
// Resumes a run interrupted by the tab being discarded while Kakao Map was in the
// foreground — the case that used to leave the patrol stuck on stop #1.
function resumeSession() {
  if (!isActive()) { session = null; return; }

  const known = new Set(allPoints.map(p => p.id));
  selectedCategories = new Set(session.categories || []);

  // A stale target (removed point) just gets cleared — the officer re-picks
  // manually rather than the app guessing a replacement.
  if (session.targetId && !known.has(session.targetId)) {
    session.targetId = null;
  }
  if (pendingPoints().length === 0) { stopPatrol(); return; }

  saveSession();
  startBtn.classList.add('hidden');
  resetBtn.classList.remove('hidden');
  stopBtn.classList.remove('hidden');
  startWatch();
  showToast(session.targetId
    ? `순찰을 이어서 진행합니다 · ${currentTarget().label}`
    : '순찰 진행 중 · 지도에서 다음 지점을 선택하세요');
}

async function init() {
  try {
    const res = await fetch(`points.json?v=${Date.now()}`);
    allPoints = res.ok ? await res.json() : [];
  } catch (e) {
    allPoints = [];
  }
  resumeSession();
  renderAll();
  fitToPoints();
}

init();

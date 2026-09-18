// Officer-facing patrol navigation. Points are read-only here — they come from
// points.json, which only the admin (admin.html) edits and commits. This page lets
// the officer pick which categories to patrol, plans a nearest-first order, and
// hands each leg to Kakao Map.
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
let session = loadJson(SESSION_KEY, null); // { active, order: [id], targetId, categories }
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

// ---------- route order ----------
// Greedy nearest-neighbour chain: from where you are, the closest unvisited stop;
// from that stop, the closest of the rest; and so on. Same rule the Android app
// uses, but computed for the whole remaining route at once so the officer can see
// the order up front (1 → 2 → 3).
function planOrder(fromLat, fromLng) {
  const rest = pendingPoints();
  const order = [];
  let lat = fromLat, lng = fromLng;
  while (rest.length) {
    let bestIdx = 0;
    let bestDist = distanceMeters(lat, lng, rest[0].lat, rest[0].lng);
    for (let i = 1; i < rest.length; i++) {
      const d = distanceMeters(lat, lng, rest[i].lat, rest[i].lng);
      if (d < bestDist) { bestIdx = i; bestDist = d; }
    }
    const chosen = rest.splice(bestIdx, 1)[0];
    order.push(chosen.id);
    lat = chosen.lat; lng = chosen.lng;
  }
  return order;
}

// Picks the nearest candidate, but only when its lead over the next-closest one
// beats the fix's own error margin. Points that sit closer together than the GPS
// accuracy (e.g. bank branches 40-60m apart with a 50-150m cold-start fix) can't be
// told apart reliably — guessing risks sending the officer to the wrong branch, so
// this reports the pick as ambiguous instead and lets the caller ask the officer.
function nearestWithConfidence(candidates, fromLat, fromLng, accuracy) {
  if (candidates.length === 0) return { point: null, ambiguous: false };
  const withDist = candidates
    .map(p => ({ p, d: distanceMeters(fromLat, fromLng, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d);
  if (withDist.length === 1) return { point: withDist[0].p, ambiguous: false };
  const margin = withDist[1].d - withDist[0].d;
  const ambiguous = accuracy != null && margin < accuracy;
  return { point: withDist[0].p, ambiguous };
}

// Display order: stops already handled (in the order they were handled), then the
// freshly planned remainder.
function rebuildOrder(planned) {
  const handled = (session && session.order ? session.order : []).filter(id => visited[id]);
  return handled.concat(planned);
}

function displayOrder() {
  const byId = new Map(filteredPoints().map(p => [p.id, p]));
  const out = [];
  if (session && session.order) {
    for (const id of session.order) {
      if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); }
    }
  }
  return out.concat([...byId.values()]);
}

// ---------- points list ----------
function renderPointsList() {
  const list = document.getElementById('pointsList');
  const noPoints = document.getElementById('noPoints');
  const count = document.getElementById('pointCount');
  const shown = displayOrder();

  list.innerHTML = '';
  const doneCount = shown.filter(p => visited[p.id] === true).length;
  count.textContent = shown.length ? `${doneCount}/${shown.length} 완료` : '';
  noPoints.classList.toggle('hidden', shown.length > 0);

  shown.forEach((p, idx) => {
    const state = visited[p.id] === true ? 'done' : visited[p.id] === 'skip' ? 'skip' : 'pending';
    const isTarget = !!(session && session.targetId === p.id);
    const li = document.createElement('li');
    if (isTarget) li.className = 'target';
    const distText = lastFix
      ? `<span class="dist">${Math.round(distanceMeters(lastFix.lat, lastFix.lng, p.lat, p.lng))}m</span>`
      : '';
    li.innerHTML = `
      <span class="seq ${state}">${idx + 1}</span>
      <span class="label">${escapeHtml(p.label)}${isTarget ? ' <b>← 현재 목표</b>' : ''}</span>
      ${distText}
      <button class="goto" data-id="${p.id}">${isTarget ? '안내' : '여기로'}</button>
    `;
    list.appendChild(li);
  });

  // 수동 지정: 자동 전환이 안 되면 목록에서 직접 다음 지점을 고를 수 있다.
  list.querySelectorAll('button.goto').forEach(btn => {
    btn.addEventListener('click', () => manualSelect(btn.dataset.id));
  });

  document.getElementById('startBtn').disabled = filteredPoints().length === 0 || isActive();
}

function renderCurrentBox() {
  const box = document.getElementById('currentBox');
  const text = document.getElementById('currentText');
  const target = currentTarget();
  box.classList.toggle('hidden', !target);
  if (!target) return;

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
  renderPointsList();
  syncMarkers();
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
  if (filteredPoints().length === 0) return;

  // Fresh run: clear progress for whatever is in scope today.
  for (const p of filteredPoints()) delete visited[p.id];
  saveVisited();
  renderAll();

  showToast('현재 위치를 확인하는 중...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      beginSession(lastFix.lat, lastFix.lng, lastFix.accuracy);
    },
    () => showToast('위치 권한이 필요합니다'),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

function beginSession(fromLat, fromLng, accuracy) {
  const order = planOrder(fromLat, fromLng);
  if (order.length === 0) { showToast('순찰할 지점이 없습니다'); return; }

  // Always auto-pick the nearest guess so 완료/건너뛰기 always have a target to act
  // on — a blocked target left the officer stuck with no way to progress. When the
  // fix can't confidently tell close stops apart we still go with the best guess,
  // just flag it so the officer knows to double-check (and can override from the list).
  const { ambiguous } = nearestWithConfidence(pendingPoints(), fromLat, fromLng, accuracy);

  session = {
    active: true,
    order,
    targetId: order[0],
    categories: [...selectedCategories],
    startedAt: Date.now()
  };
  saveSession();

  startBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  arrivalBanner.classList.add('hidden');
  renderAll();
  startWatch();
  launchKakao(currentTarget());
  showToast(ambiguous
    ? `1/${order.length} · ${currentTarget().label} 안내 시작 (가까운 지점이 여러 곳이라 다를 수 있어요, 목록에서 변경 가능)`
    : `1/${order.length} · ${currentTarget().label} 안내 시작`);
}

function startWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      renderCurrentBox();
      renderPointsList();
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
    markArrived(lat, lng, false);
  }
}

// Marks the current stop done and moves on to the next nearest one, recomputed from
// where the officer actually is — the behaviour the Android app has.
function markArrived(lat, lng, userInitiated) {
  const target = currentTarget();
  if (!target) return;
  visited[target.id] = true;
  saveVisited();
  advanceFrom(lat, lng, `${target.label} 순찰 완료`, userInitiated, lastFix ? lastFix.accuracy : null);
}

function skipCurrent(lat, lng) {
  const target = currentTarget();
  if (!target) return;
  visited[target.id] = 'skip';
  saveVisited();
  advanceFrom(lat, lng, `${target.label} 건너뜀`, true, lastFix ? lastFix.accuracy : null);
}

function advanceFrom(lat, lng, doneMsg, userInitiated, accuracy) {
  const planned = planOrder(lat, lng);
  session.order = rebuildOrder(planned);

  if (planned.length === 0) {
    session.targetId = null;
    saveSession();
    renderAll();
    finishPatrol();
    return;
  }

  // Already-visited/skipped stops are excluded from pendingPoints(), so as the run
  // progresses the candidate set shrinks — fewer nearby stops left means less room
  // for the GPS fix to confuse which one is closest. Still auto-pick the best guess
  // even when ambiguous (see beginSession) — 완료/건너뛰기 need a target to act on.
  const { ambiguous } = nearestWithConfidence(pendingPoints(), lat, lng, accuracy);
  const noteMsg = ambiguous ? ' (가까운 지점이 여러 곳이라 다를 수 있어요)' : '';

  session.targetId = planned[0];
  saveSession();
  renderAll();

  const next = currentTarget();
  // Auto-advance whenever we can: a foreground page may launch the app itself. When
  // it is backgrounded (officer still inside Kakao Map) the browser swallows the
  // launch, so park it in the banner and fire it on the next tap / return instead.
  if (userInitiated || document.visibilityState === 'visible') {
    showToast(`${doneMsg} → 다음: ${next.label}${noteMsg}`);
    launchKakao(next);
  } else {
    arrivalText.textContent = `${doneMsg} / 다음 지점: ${next.label}${noteMsg}`;
    arrivalBanner.classList.remove('hidden');
  }
}

// ---------- manual controls (자동 전환이 안 될 때) ----------
function withPosition(fn) {
  if (lastFix) { fn(lastFix.lat, lastFix.lng); return; }
  if (!navigator.geolocation) { showToast('위치 정보를 사용할 수 없습니다'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      fn(lastFix.lat, lastFix.lng);
    },
    () => {
      // No fix — fall back to the target's own position so the manual buttons still
      // work indoors or with location turned off.
      const t = currentTarget();
      if (t) fn(t.lat, t.lng);
      else showToast('위치를 확인할 수 없습니다');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.getElementById('renavBtn').addEventListener('click', () => {
  const t = currentTarget();
  if (t) launchKakao(t);
});

document.getElementById('arrivedBtn').addEventListener('click', () => {
  if (!isActive()) return;
  withPosition((lat, lng) => markArrived(lat, lng, true));
});

document.getElementById('skipBtn').addEventListener('click', () => {
  if (!isActive()) return;
  withPosition((lat, lng) => skipCurrent(lat, lng));
});

// Picking a stop straight from the list: during a run it reorders the route by hand,
// before one it starts the patrol at the stop the officer chose.
function manualSelect(id) {
  const p = pointById(id);
  if (!p) return;

  if (!isActive()) {
    if (!navigator.geolocation) { showToast('이 브라우저는 위치 정보를 지원하지 않습니다'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        for (const q of filteredPoints()) delete visited[q.id];
        saveVisited();
        beginSession(lastFix.lat, lastFix.lng);
        setTarget(id);
      },
      () => showToast('위치 권한이 필요합니다'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
    return;
  }

  // 이미 완료/건너뛴 지점을 다시 고르면 미방문 상태로 되돌린다.
  if (visited[id]) { delete visited[id]; saveVisited(); }
  setTarget(id);
}

function setTarget(id) {
  session.targetId = id;
  // Put the chosen stop at the head of the remaining route, keeping the rest as is.
  const handled = session.order.filter(x => visited[x]);
  const rest = session.order.filter(x => !visited[x] && x !== id);
  session.order = handled.concat([id], rest);
  saveSession();
  arrivalBanner.classList.add('hidden');
  renderAll();
  launchKakao(pointById(id));
  showToast(`${pointById(id).label}(으)로 안내합니다`);
}

arrivalGoBtn.addEventListener('click', () => {
  arrivalBanner.classList.add('hidden');
  const t = currentTarget();
  if (t) launchKakao(t);
});
document.getElementById('arrivalCloseBtn').addEventListener('click', () => {
  arrivalBanner.classList.add('hidden');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !isActive()) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      renderCurrentBox();
      renderPointsList();
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
  session.order = (session.order || []).filter(id => known.has(id));

  if (!session.targetId || !known.has(session.targetId)) {
    session.targetId = session.order.find(id => !visited[id]) || null;
  }
  if (!session.targetId) { stopPatrol(); return; }

  saveSession();
  startBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  startWatch();
  showToast(`순찰을 이어서 진행합니다 · ${currentTarget().label}`);
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

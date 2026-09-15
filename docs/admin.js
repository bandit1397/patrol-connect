// Admin tool: design the shared patrol point list, then export it as points.json
// to commit into the repo. This page's edits are a local draft only — nothing here
// is what officers see until you export and push the file.

let points = [];
let tapModeOn = false;
let lastCategory = '';
let markers = {};

// ---------- map ----------
const map = L.map('map').setView([37.5665, 126.9780], 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

map.on('click', (e) => {
  if (!tapModeOn) return;
  promptAddPoint(`지점 (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`, e.latlng.lat, e.latlng.lng);
});

function markerIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:#1565C0;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
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
      markers[p.id] = L.marker([p.lat, p.lng], { icon: markerIcon() }).addTo(map);
    } else {
      markers[p.id].setLatLng([p.lat, p.lng]);
    }
    markers[p.id].bindPopup(`${p.label} [${p.category}]`);
  }
}

// ---------- points list ----------
function renderPointsList() {
  const list = document.getElementById('pointsList');
  const noPoints = document.getElementById('noPoints');
  const count = document.getElementById('pointCount');
  list.innerHTML = '';
  count.textContent = points.length ? `${points.length}개` : '';
  noPoints.classList.toggle('hidden', points.length > 0);

  for (const p of points) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="category-chip">${escapeHtml(p.category || '미분류')}</span>
      <span class="label">${escapeHtml(p.label)}</span>
      <button class="delete" data-id="${p.id}">삭제</button>
    `;
    list.appendChild(li);
  }
  list.querySelectorAll('button.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      points = points.filter(p => p.id !== btn.dataset.id);
      renderAll();
    });
  });
}

function renderAll() {
  renderPointsList();
  syncMarkers();
}

function promptAddPoint(label, lat, lng) {
  const category = window.prompt('종류(카테고리)를 입력하세요 (예: 금융기관, 무인점포, 금은방)', lastCategory);
  if (category === null) return; // cancelled
  const trimmed = category.trim();
  if (!trimmed) { showToast('종류를 입력해야 합니다'); return; }
  lastCategory = trimmed;
  points.push({ id: makeId(), label, lat, lng, category: trimmed });
  renderAll();
  showToast('지점이 추가되었습니다');
}

// ---------- search ----------
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
      promptAddPoint(r.display_name, parseFloat(r.lat), parseFloat(r.lon));
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

// ---------- load / export ----------
async function loadFromServer() {
  try {
    const res = await fetch(`points.json?v=${Date.now()}`);
    points = res.ok ? await res.json() : [];
  } catch (e) {
    points = [];
  }
  renderAll();
}

document.getElementById('reloadBtn').addEventListener('click', () => {
  if (points.length && !confirm('현재 편집중인 내용을 버리고 points.json을 다시 불러올까요?')) return;
  loadFromServer();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const json = JSON.stringify(points, null, 2);
  document.getElementById('exportText').value = json;
  const blob = new Blob([json], { type: 'application/json' });
  document.getElementById('downloadLink').href = URL.createObjectURL(blob);
  document.getElementById('exportOverlay').classList.remove('hidden');
});

document.getElementById('closeExportBtn').addEventListener('click', () => {
  document.getElementById('exportOverlay').classList.add('hidden');
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const text = document.getElementById('exportText').value;
  try {
    await navigator.clipboard.writeText(text);
    showToast('클립보드에 복사했습니다');
  } catch (e) {
    document.getElementById('exportText').select();
    showToast('복사 버튼이 안되면 직접 선택해서 복사하세요');
  }
});

// ---------- init ----------
loadFromServer();

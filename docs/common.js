// Shared helpers used by both admin.js (route authoring) and app.js (patrol navigation).

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearest(candidatePoints, fromLat, fromLng) {
  if (candidatePoints.length === 0) return null;
  let best = candidatePoints[0];
  let bestDist = distanceMeters(fromLat, fromLng, best.lat, best.lng);
  for (const p of candidatePoints.slice(1)) {
    const d = distanceMeters(fromLat, fromLng, p.lat, p.lng);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const KAKAO_PACKAGE = 'net.daum.android.map';

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

// Hands navigation to Kakao Map (deep link — no API key).
//
// The patrol page MUST survive this call: everything about the run (which stop is
// current, what's left) lives in this tab, so a navigation that unloads the page
// kills the patrol. So:
//   - Android: an intent:// URL. Chrome/Samsung Internet open the app if installed
//     and only fall back to the store when it isn't — the page itself is never
//     navigated away when the app is there.
//   - Anything else (PC testing): open the Kakao Map web route in a new tab.
function launchKakao(point) {
  const name = encodeURIComponent(point.label || '목적지');
  const webUrl = `https://map.kakao.com/link/to/${name},${point.lat},${point.lng}`;

  if (!isAndroid()) {
    window.open(webUrl, '_blank');
    showToast('PC에서는 카카오맵 웹으로 엽니다 (실제 안내는 휴대폰에서)');
    return;
  }

  const fallback = encodeURIComponent(`https://play.google.com/store/apps/details?id=${KAKAO_PACKAGE}`);
  const intentUrl =
    `intent://route?ep=${point.lat},${point.lng}&by=CAR` +
    `#Intent;scheme=kakaomap;package=${KAKAO_PACKAGE};S.browser_fallback_url=${fallback};end`;
  window.location.href = intentUrl;
}

let _toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// Nominatim (OSM) address search — free, no API key. Browsers can't set a custom
// User-Agent, but they always send Referer, which is what Nominatim's usage policy
// asks apps to identify themselves with.
async function searchAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

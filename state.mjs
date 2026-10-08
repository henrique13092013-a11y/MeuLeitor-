export function normalizeRotation(value) {
  const n = Number(value) || 0;
  return ((n % 360) + 360) % 360;
}

export function valueAt(markers, page, fallback) {
  let value = fallback;
  for (const marker of markers || []) {
    if (!Number.isInteger(marker.page) || marker.page < 1) continue;
    if (marker.page > page) break;
    value = marker.value;
  }
  return value;
}

export function compactMarkers(markers, fallback) {
  const sorted = (markers || [])
    .filter(m => Number.isInteger(m.page) && m.page >= 1)
    .sort((a, b) => a.page - b.page);
  const out = [];
  let current = fallback;
  for (const marker of sorted) {
    if (Object.is(marker.value, current)) continue;
    const existing = out.findIndex(x => x.page === marker.page);
    if (existing >= 0) out.splice(existing, 1);
    out.push({ page: marker.page, value: marker.value });
    current = marker.value;
  }
  return out.sort((a, b) => a.page - b.page);
}

export function setMarker(markers, page, value, fallback) {
  const next = (markers || []).filter(m => m.page !== page);
  next.push({ page, value });
  return compactMarkers(next, fallback);
}

export function readingPosition(totalPages, pageNum, half, splitMarkers) {
  let total = 0;
  let before = 0;
  for (let page = 1; page <= totalPages; page++) {
    const count = valueAt(splitMarkers, page, false) ? 2 : 1;
    if (page < pageNum) before += count;
    total += count;
  }
  const current = before + (valueAt(splitMarkers, pageNum, false) && half === 2 ? 2 : 1);
  return { current, total };
}

export function migrateLegacySplit(rawRules) {
  const list = Array.isArray(rawRules) ? rawRules : [];
  const perPage = list
    .filter(r => Number.isInteger(r.page) && r.page >= 1)
    .map(r => ({ page: r.page, value: r.mode === 'split' }))
    .sort((a, b) => a.page - b.page);
  return compactMarkers(perPage, false);
}

export function migrateLegacyRotation(rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return [];
  const perPage = Object.entries(rawMap)
    .map(([page, value]) => ({ page: Number(page), value: normalizeRotation(value) }))
    .filter(x => Number.isInteger(x.page) && x.page >= 1)
    .sort((a, b) => a.page - b.page);
  return compactMarkers(perPage, 0);
}

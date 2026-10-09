export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clampZoom(value) {
  return clamp(value, 1, 4);
}

export function activeMarker(markers, page, fallback) {
  let value = fallback;
  let start = null;
  for (const marker of markers || []) {
    if (!Number.isInteger(marker.page) || marker.page < 1) continue;
    if (marker.page > page) break;
    if (!Object.is(marker.value, value)) {
      value = marker.value;
      start = marker.page;
    }
  }
  return { value, start };
}

export function focalRatio(rect, clientX, clientY) {
  const width = Math.max(1, rect.width || 0);
  const height = Math.max(1, rect.height || 0);
  return {
    x: clamp((clientX - rect.left) / width, 0, 1),
    y: clamp((clientY - rect.top) / height, 0, 1)
  };
}

export function focalDelta(rect, ratio, clientX, clientY) {
  return {
    x: rect.left + ratio.x * rect.width - clientX,
    y: rect.top + ratio.y * rect.height - clientY
  };
}

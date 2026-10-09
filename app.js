import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { compactMarkers, migrateLegacyRotation, migrateLegacySplit, normalizeRotation, readingPosition, setMarker, valueAt } from './state.mjs';
import { activeMarker, clampZoom, focalDelta, focalRatio } from './ux.mjs';
import { friendlyOpenError, loadPdfRobust } from './pdf-loader.mjs';
import { exportAdjustedPdf } from './exporter.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const $ = id => document.getElementById(id);

const ui = {
  fileInput: $('fileInput'), fileInputBig: $('fileInputBig'), fileName: $('fileName'), homeBackBtn: $('homeBackBtn'),
  emptyState: $('emptyState'), reader: $('reader'), recentFiles: $('recentFiles'), stage: $('stage'), canvasWrap: $('canvasWrap'), canvas: $('pageCanvas'), loading: $('loading'),
  zoomResetBtn: $('zoomResetBtn'), splitQuickState: $('splitQuickState'), splitQuickBtn: $('splitQuickBtn'), splitQuickLabel: $('splitQuickLabel'),
  controlsToggle: $('controlsToggle'), controls: $('controls'), controlsClose: $('controlsClose'),
  rotateLeftBtn: $('rotateLeftBtn'), rotateRightBtn: $('rotateRightBtn'), rotationStatus: $('rotationStatus'), splitSettingsBtn: $('splitSettingsBtn'),
  splitSlider: $('splitSlider'), splitOutput: $('splitOutput'), gutterSlider: $('gutterSlider'), gutterOutput: $('gutterOutput'),
  zoomOutBtn: $('zoomOutBtn'), zoomInBtn: $('zoomInBtn'), fitBtn: $('fitBtn'), zoomLabel: $('zoomLabel'),
  cropToggle: $('cropToggle'), cropSlider: $('cropSlider'), cropOutput: $('cropOutput'), cropSliderRow: $('cropSliderRow'), rtlToggle: $('rtlToggle'), themeToggle: $('themeToggle'), rulesSummary: $('rulesSummary'),
  prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), pageInfoBtn: $('pageInfoBtn'), pageLabel: $('pageLabel'), sideLabel: $('sideLabel'),
  jumpSheet: $('jumpSheet'), jumpClose: $('jumpClose'), pageJump: $('pageJump'), pageJumpBtn: $('pageJumpBtn'), pageSeek: $('pageSeek'), jumpHint: $('jumpHint'),
  exportBtn: $('exportBtn'), exportModal: $('exportModal'), exportCancelBtn: $('exportCancelBtn'), exportName: $('exportName'), exportStartBtn: $('exportStartBtn'), exportProgressWrap: $('exportProgressWrap'), exportProgressBar: $('exportProgressBar'), exportProgressText: $('exportProgressText'), exportNote: $('exportNote')
};

let pdf = null;
let sourceFile = null;
let sourceObjectUrl = null;
let fileKey = null;
let pageNum = 1;
let half = 0;
let zoom = 1;
let baseCssWidth = 0;
let baseCssHeight = 0;
let renderToken = 0;
let navigationBusy = false;
let rotationMarkers = [];
let splitMarkers = [];

const prefs = { splitAt: 50, gutter: 1, crop: false, cropPct: 3, rtl: false };
const SETTINGS_KEY = 'meuleitor:v3:settings';
const RECENT_KEY = 'meuleitor:v3:recent';

function key(kind) { return `meuleitor:v3:${kind}:${fileKey}`; }
function legacyV2Key(kind) { return `meuleitor:v2:${kind}:${fileKey}`; }
function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function safeJSON(raw, fallback) { try { return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function isMobile() { return window.innerWidth <= 760; }
function showMessage(message) { alert(message); }

function loadSettings() {
  const saved = safeJSON(storageGet(SETTINGS_KEY), null) || safeJSON(storageGet('meuleitor:v2:settings'), {});
  Object.assign(prefs, saved);
  storageSet(SETTINGS_KEY, JSON.stringify(prefs));
  ui.splitSlider.value = prefs.splitAt;
  ui.gutterSlider.value = prefs.gutter;
  ui.cropToggle.checked = !!prefs.crop;
  ui.cropSlider.value = prefs.cropPct;
  ui.rtlToggle.checked = !!prefs.rtl;
  const dark = (storageGet('meuleitor:v3:theme') || storageGet('meuleitor:v2:theme')) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  ui.themeToggle.checked = dark;
  updateSettingOutputs();
}
function saveSettings() { storageSet(SETTINGS_KEY, JSON.stringify(prefs)); }
function updateSettingOutputs() {
  ui.splitOutput.value = `${Number(prefs.splitAt).toFixed(Number(prefs.splitAt) % 1 ? 1 : 0)}%`;
  ui.gutterOutput.value = `${Number(prefs.gutter).toFixed(1)}%`;
  ui.cropOutput.value = `${Number(prefs.cropPct).toFixed(Number(prefs.cropPct) % 1 ? 1 : 0)}%`;
  ui.cropSliderRow.classList.toggle('hidden', !prefs.crop);
}

function sanitizeRotationMarkers(list) {
  return compactMarkers((Array.isArray(list) ? list : []).map(m => ({ page: Number(m.page), value: normalizeRotation(m.value) })), 0);
}
function sanitizeSplitMarkers(list) {
  return compactMarkers((Array.isArray(list) ? list : []).map(m => ({ page: Number(m.page), value: !!m.value })), false);
}
function loadDocumentState() {
  let savedRot = safeJSON(storageGet(key('rotation')), null);
  let savedSplit = safeJSON(storageGet(key('split')), null);
  if (!Array.isArray(savedRot)) savedRot = safeJSON(storageGet(legacyV2Key('rotation')), null);
  if (!Array.isArray(savedSplit)) savedSplit = safeJSON(storageGet(legacyV2Key('split')), null);

  if (Array.isArray(savedRot)) rotationMarkers = sanitizeRotationMarkers(savedRot);
  else rotationMarkers = migrateLegacyRotation(safeJSON(storageGet(`leitor-rotations:${fileKey}`), {}));
  if (Array.isArray(savedSplit)) splitMarkers = sanitizeSplitMarkers(savedSplit);
  else splitMarkers = migrateLegacySplit(safeJSON(storageGet(`leitor-split-rules:${fileKey}`), []));

  storageSet(key('rotation'), JSON.stringify(rotationMarkers));
  storageSet(key('split'), JSON.stringify(splitMarkers));

  const pos = safeJSON(storageGet(key('position')), null) || safeJSON(storageGet(legacyV2Key('position')), null);
  pageNum = pos?.pageNum ? Math.max(1, Math.min(pdf.numPages, Number(pos.pageNum) || 1)) : 1;
  half = pos?.half === 2 ? 2 : 0;
}
function savePosition() { if (fileKey) storageSet(key('position'), JSON.stringify({ pageNum, half })); }
function saveMarkers() {
  if (!fileKey) return;
  storageSet(key('rotation'), JSON.stringify(rotationMarkers));
  storageSet(key('split'), JSON.stringify(splitMarkers));
}
function rotationAt(page) { return normalizeRotation(valueAt(rotationMarkers, page, 0)); }
function splitAt(page) { return !!valueAt(splitMarkers, page, false); }

async function setRotationFromHere(delta) {
  rotationMarkers = setMarker(rotationMarkers, pageNum, normalizeRotation(rotationAt(pageNum) + delta), 0);
  saveMarkers();
  half = 0;
  await renderCurrent();
}
async function toggleSplitFromHere() {
  splitMarkers = setMarker(splitMarkers, pageNum, !splitAt(pageNum), false);
  saveMarkers();
  half = 0;
  await normalizeHalf();
  await renderCurrent();
}

function axisForViewport(viewport) { return viewport.width >= viewport.height ? 'vertical' : 'horizontal'; }
function getLayout(page) {
  const rotation = rotationAt(page.pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: ((page.rotate || 0) + rotation) % 360 });
  const split = splitAt(page.pageNumber);
  return { rotation, split, axis: split ? axisForViewport(viewport) : null, viewport };
}
async function normalizeHalf() {
  if (!pdf) return;
  if (splitAt(pageNum)) {
    if (half !== 1 && half !== 2) half = 1;
  } else half = 0;
}
function cropRect(source, layout) {
  let sx = 0, sy = 0, sw = source.width, sh = source.height;
  if (prefs.crop) {
    const crop = prefs.cropPct / 100, dx = sw * crop, dy = sh * crop;
    sx += dx; sy += dy; sw -= dx * 2; sh -= dy * 2;
  }
  if (!layout.split) return { sx, sy, sw, sh };
  if (layout.axis === 'vertical') {
    const cut = sw * prefs.splitAt / 100, gutter = sw * prefs.gutter / 100;
    const firstIsLeft = !prefs.rtl;
    const showLeft = (half === 1 && firstIsLeft) || (half === 2 && !firstIsLeft);
    if (showLeft) return { sx, sy, sw: Math.max(1, cut - gutter / 2), sh };
    const start = cut + gutter / 2;
    return { sx: sx + start, sy, sw: Math.max(1, sw - start), sh };
  }
  const cut = sh * prefs.splitAt / 100, gutter = sh * prefs.gutter / 100;
  if (half === 1) return { sx, sy, sw, sh: Math.max(1, cut - gutter / 2) };
  const start = cut + gutter / 2;
  return { sx, sy: sy + start, sw, sh: Math.max(1, sh - start) };
}

function applyZoomStyle() {
  if (!baseCssWidth || !baseCssHeight) return;
  ui.canvas.style.width = `${baseCssWidth * zoom}px`;
  ui.canvas.style.height = `${baseCssHeight * zoom}px`;
  const pct = Math.round(zoom * 100);
  ui.zoomLabel.textContent = `${pct}%`;
  ui.canvasWrap.classList.toggle('zoomed', zoom > 1.02);
  ui.zoomResetBtn.classList.toggle('hidden', zoom <= 1.02);
}
function stageCenter() {
  const rect = ui.stage.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
function setZoom(nextZoom, focal = null, fixedRatio = null) {
  const next = clampZoom(nextZoom);
  if (Math.abs(next - zoom) < .005) return;
  const beforeRect = ui.canvas.getBoundingClientRect();
  const point = focal || stageCenter();
  const ratio = fixedRatio || focalRatio(beforeRect, point.x, point.y);
  zoom = next;
  applyZoomStyle();
  requestAnimationFrame(() => {
    const afterRect = ui.canvas.getBoundingClientRect();
    const delta = focalDelta(afterRect, ratio, point.x, point.y);
    ui.stage.scrollLeft += delta.x;
    ui.stage.scrollTop += delta.y;
  });
}
function resetZoom() { setZoom(1, stageCenter()); }
function toggleDoubleTapZoom(clientX, clientY) {
  setZoom(zoom > 1.15 ? 1 : 2, { x: clientX, y: clientY });
}

async function renderCurrent(throwOnError = false) {
  if (!pdf) return false;
  const token = ++renderToken;
  ui.loading.classList.remove('hidden');
  try {
    await normalizeHalf();
    const page = await pdf.getPage(pageNum);
    const layout = getLayout(page);
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const renderScale = 2.1 * deviceScale;
    const viewport = page.getViewport({ scale: renderScale, rotation: ((page.rotate || 0) + layout.rotation) % 360 });
    const source = document.createElement('canvas');
    source.width = Math.max(1, Math.floor(viewport.width));
    source.height = Math.max(1, Math.floor(viewport.height));
    const sourceCtx = source.getContext('2d', { alpha: false });
    sourceCtx.fillStyle = '#fff'; sourceCtx.fillRect(0, 0, source.width, source.height);
    await page.render({ canvasContext: sourceCtx, viewport }).promise;
    if (token !== renderToken) return false;

    const rect = cropRect(source, layout);
    const available = Math.max(280, ui.stage.clientWidth - (isMobile() ? 14 : 34));
    const fit = Math.min(1, available / (rect.sw / deviceScale));
    baseCssWidth = rect.sw / deviceScale * fit;
    baseCssHeight = rect.sh / deviceScale * fit;
    ui.canvas.width = Math.max(1, Math.floor(rect.sw));
    ui.canvas.height = Math.max(1, Math.floor(rect.sh));
    const ctx = ui.canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
    ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    applyZoomStyle();
    updateUI(layout);
    savePosition();
    return true;
  } catch (error) {
    console.error('Falha ao renderizar página', error);
    if (throwOnError) throw error;
    showMessage('O PDF abriu, mas esta página não pôde ser exibida. Tente voltar ou avançar.');
    return false;
  } finally {
    if (token === renderToken) ui.loading.classList.add('hidden');
  }
}

function updateUI(layout) {
  const reading = readingPosition(pdf.numPages, pageNum, half, splitMarkers);
  ui.pageLabel.textContent = `${reading.current} / ${reading.total}`;
  let side = 'inteira';
  if (layout.split) {
    if (layout.axis === 'vertical') side = half === 1 ? (prefs.rtl ? 'direita · 1/2' : 'esquerda · 1/2') : (prefs.rtl ? 'esquerda · 2/2' : 'direita · 2/2');
    else side = half === 1 ? 'superior · 1/2' : 'inferior · 2/2';
  }
  ui.sideLabel.textContent = `PDF ${pageNum} · ${side}`;

  const splitState = activeMarker(splitMarkers, pageNum, false);
  const activeSplit = !!splitState.value;
  ui.splitQuickBtn.classList.toggle('active', activeSplit);
  ui.splitQuickLabel.textContent = activeSplit ? 'Parar aqui' : 'Dividir daqui';
  ui.splitQuickState.classList.toggle('hidden', !activeSplit);
  ui.splitQuickState.textContent = activeSplit ? `Dividindo desde ${splitState.start || pageNum}` : '';
  ui.splitSettingsBtn.classList.toggle('active', activeSplit);
  ui.splitSettingsBtn.textContent = activeSplit ? '▣ Parar divisão aqui' : '✂ Dividir daqui';

  const rotState = activeMarker(rotationMarkers, pageNum, 0);
  const rot = normalizeRotation(rotState.value);
  ui.rotationStatus.textContent = rot ? `${rot}° desde a folha ${rotState.start || pageNum}.` : 'Orientação original.';
  ui.pageSeek.max = String(pdf.numPages);
  ui.pageSeek.value = String(pageNum);
  ui.pageJump.max = String(pdf.numPages);
  ui.jumpHint.textContent = `PDF: folha ${pageNum} de ${pdf.numPages}.`;
  renderRulesSummary();
}
function renderRulesSummary() {
  ui.rulesSummary.replaceChildren();
  const rules = [];
  for (const m of rotationMarkers) rules.push({ page: m.page, text: `Giro ${normalizeRotation(m.value)}°` });
  for (const m of splitMarkers) rules.push({ page: m.page, text: m.value ? 'Inicia divisão' : 'Para divisão' });
  rules.sort((a, b) => a.page - b.page || a.text.localeCompare(b.text));
  if (!rules.length) {
    const div = document.createElement('div'); div.className = 'rule-chip'; div.textContent = 'Nenhuma alteração por trecho.'; ui.rulesSummary.append(div); return;
  }
  for (const rule of rules) {
    const div = document.createElement('div'); div.className = 'rule-chip'; div.textContent = `Folha ${rule.page} · ${rule.text}`; ui.rulesSummary.append(div);
  }
}

async function next() {
  if (!pdf || navigationBusy) return;
  navigationBusy = true;
  try {
    if (splitAt(pageNum) && half === 1) half = 2;
    else if (pageNum < pdf.numPages) { pageNum++; half = splitAt(pageNum) ? 1 : 0; }
    await renderCurrent();
    ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } finally { navigationBusy = false; }
}
async function prev() {
  if (!pdf || navigationBusy) return;
  navigationBusy = true;
  try {
    if (splitAt(pageNum) && half === 2) half = 1;
    else if (pageNum > 1) { pageNum--; half = splitAt(pageNum) ? 2 : 0; }
    await renderCurrent();
    ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } finally { navigationBusy = false; }
}
async function jumpToPage(value) {
  if (!pdf) return;
  const target = Math.max(1, Math.min(pdf.numPages, Math.round(Number(value))));
  if (!Number.isFinite(target)) return;
  pageNum = target;
  half = splitAt(pageNum) ? 1 : 0;
  await renderCurrent();
  ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  ui.jumpSheet.classList.remove('open');
}

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') { showMessage('Selecione um arquivo PDF.'); return; }
  if (!file.size) { showMessage('Este arquivo está vazio ou ainda não foi baixado para o aparelho.'); return; }
  ui.loading.classList.remove('hidden');
  let loaded = null;
  try {
    loaded = await loadPdfRobust(pdfjsLib, file);
    const oldPdf = pdf, oldUrl = sourceObjectUrl;
    pdf = loaded.doc; sourceObjectUrl = loaded.url; sourceFile = file;
    fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    ui.fileName.textContent = file.name;
    try { loadDocumentState(); } catch (stateError) {
      console.warn('Estado salvo inválido; abrindo com estado limpo.', stateError);
      rotationMarkers = []; splitMarkers = []; pageNum = 1; half = 0;
    }
    zoom = 1;
    rememberRecent(file);
    ui.emptyState.classList.add('hidden'); ui.reader.classList.remove('hidden'); ui.homeBackBtn.classList.remove('hidden'); ui.exportBtn.disabled = false;
    ui.exportName.value = `${file.name.replace(/\.pdf$/i, '')} - ajustado.pdf`;
    const rendered = await renderCurrent(true);
    if (!rendered) throw new Error('Primeira página não renderizada.');
    if (oldPdf && oldPdf !== pdf) oldPdf.destroy().catch?.(() => {});
    if (oldUrl && oldUrl !== sourceObjectUrl) URL.revokeObjectURL(oldUrl);
  } catch (error) {
    console.error('Falha ao abrir PDF', error, error?.firstAttempt || '');
    if (loaded?.doc && loaded.doc !== pdf) loaded.doc.destroy().catch?.(() => {});
    if (loaded?.url && loaded.url !== sourceObjectUrl) URL.revokeObjectURL(loaded.url);
    showMessage(friendlyOpenError(error));
  } finally { ui.loading.classList.add('hidden'); }
}

function rememberRecent(file) {
  const entries = safeJSON(storageGet(RECENT_KEY), safeJSON(storageGet('meuleitor:v2:recent'), []));
  const list = Array.isArray(entries) ? entries.filter(x => x.key !== fileKey) : [];
  list.unshift({ key: fileKey, name: file.name });
  storageSet(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  renderRecent();
}
function renderRecent() {
  const entries = safeJSON(storageGet(RECENT_KEY), safeJSON(storageGet('meuleitor:v2:recent'), []));
  ui.recentFiles.replaceChildren();
  if (!Array.isArray(entries) || !entries.length) return;
  const title = document.createElement('strong'); title.textContent = 'Lidos recentemente'; ui.recentFiles.append(title);
  for (const entry of entries) {
    const row = document.createElement('div'); row.className = 'recent-row';
    const name = document.createElement('span'); name.textContent = entry.name;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Selecionar'; button.addEventListener('click', () => ui.fileInputBig.click());
    row.append(name, button); ui.recentFiles.append(row);
  }
}

function bindSettings() {
  [[ui.splitSlider, 'splitAt'], [ui.gutterSlider, 'gutter'], [ui.cropSlider, 'cropPct']].forEach(([el, prop]) => el.addEventListener('input', async () => {
    prefs[prop] = Number(el.value); saveSettings(); updateSettingOutputs(); await renderCurrent();
  }));
  ui.cropToggle.addEventListener('change', async () => { prefs.crop = ui.cropToggle.checked; saveSettings(); updateSettingOutputs(); await renderCurrent(); });
  ui.rtlToggle.addEventListener('change', async () => { prefs.rtl = ui.rtlToggle.checked; saveSettings(); await renderCurrent(); });
  ui.themeToggle.addEventListener('change', () => {
    document.documentElement.classList.toggle('dark', ui.themeToggle.checked);
    storageSet('meuleitor:v3:theme', ui.themeToggle.checked ? 'dark' : 'light');
  });
}

async function exportPdf() {
  if (!pdf || !sourceFile) return;
  ui.exportStartBtn.disabled = true; ui.exportCancelBtn.disabled = true; ui.exportProgressWrap.classList.remove('hidden'); ui.exportNote.textContent = '';
  try {
    const result = await exportAdjustedPdf({
      pdf, sourceFile, outputName: ui.exportName.value, prefs,
      rotationAt, splitAt, axisForViewport,
      quality: document.querySelector('input[name="exportQuality"]:checked')?.value || 'standard',
      onProgress: (pct, text) => { ui.exportProgressBar.style.width = `${pct}%`; ui.exportProgressText.textContent = text; }
    });
    ui.exportNote.textContent = `PDF pronto: ${result}`;
  } catch (error) {
    console.error(error); ui.exportNote.textContent = 'Não foi possível gerar o PDF. Verifique sua conexão e tente novamente.';
  } finally { ui.exportStartBtn.disabled = false; ui.exportCancelBtn.disabled = false; }
}

[ui.fileInput, ui.fileInputBig].forEach(input => input.addEventListener('change', async e => {
  const file = e.target.files?.[0]; await openFile(file); e.target.value = '';
}));
ui.homeBackBtn.addEventListener('click', () => {
  savePosition(); ui.controls.classList.remove('open'); ui.jumpSheet.classList.remove('open'); ui.reader.classList.add('hidden'); ui.emptyState.classList.remove('hidden'); ui.homeBackBtn.classList.add('hidden');
});
ui.controlsToggle.addEventListener('click', () => { ui.jumpSheet.classList.remove('open'); ui.controls.classList.toggle('open'); });
ui.controlsClose.addEventListener('click', () => ui.controls.classList.remove('open'));
ui.rotateLeftBtn.addEventListener('click', () => setRotationFromHere(270));
ui.rotateRightBtn.addEventListener('click', () => setRotationFromHere(90));
ui.splitQuickBtn.addEventListener('click', toggleSplitFromHere);
ui.splitSettingsBtn.addEventListener('click', toggleSplitFromHere);
ui.zoomInBtn.addEventListener('click', () => setZoom(zoom * 1.25, stageCenter()));
ui.zoomOutBtn.addEventListener('click', () => setZoom(zoom / 1.25, stageCenter()));
ui.fitBtn.addEventListener('click', resetZoom);
ui.zoomResetBtn.addEventListener('click', resetZoom);
ui.prevBtn.addEventListener('click', prev);
ui.nextBtn.addEventListener('click', next);
ui.pageInfoBtn.addEventListener('click', () => { ui.controls.classList.remove('open'); ui.jumpSheet.classList.toggle('open'); });
ui.jumpClose.addEventListener('click', () => ui.jumpSheet.classList.remove('open'));
ui.pageJumpBtn.addEventListener('click', () => jumpToPage(ui.pageJump.value));
ui.pageJump.addEventListener('keydown', e => { if (e.key === 'Enter') jumpToPage(ui.pageJump.value); });
ui.pageSeek.addEventListener('input', () => { ui.jumpHint.textContent = `Ir para folha ${ui.pageSeek.value} de ${pdf?.numPages || 1}`; });
ui.pageSeek.addEventListener('change', () => jumpToPage(ui.pageSeek.value));
ui.exportBtn.addEventListener('click', () => ui.exportModal.classList.remove('hidden'));
ui.exportCancelBtn.addEventListener('click', () => ui.exportModal.classList.add('hidden'));
ui.exportStartBtn.addEventListener('click', exportPdf);
bindSettings();

document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
  if (e.key === 'Escape') { ui.controls.classList.remove('open'); ui.jumpSheet.classList.remove('open'); ui.exportModal.classList.add('hidden'); }
});

let touchStartX = null;
let touchStartY = null;
let touchStartTime = 0;
let pinchStartDistance = null;
let pinchStartZoom = 1;
let pinchRatio = null;
let pinchActive = false;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;
function distance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
function midpoint(touches) { return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 }; }

ui.stage.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    pinchActive = true;
    pinchStartDistance = distance(e.touches);
    pinchStartZoom = zoom;
    const point = midpoint(e.touches);
    pinchRatio = focalRatio(ui.canvas.getBoundingClientRect(), point.x, point.y);
    touchStartX = touchStartY = null;
  } else if (e.touches.length === 1 && !pinchActive) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = performance.now();
  }
}, { passive: true });

ui.stage.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinchStartDistance) {
    e.preventDefault();
    const point = midpoint(e.touches);
    setZoom(pinchStartZoom * distance(e.touches) / pinchStartDistance, point, pinchRatio);
  }
}, { passive: false });

ui.stage.addEventListener('touchend', e => {
  if (pinchActive) {
    if (e.touches.length < 2) {
      pinchActive = false; pinchStartDistance = null; pinchRatio = null;
    }
    touchStartX = touchStartY = null;
    return;
  }
  if (touchStartX == null || !e.changedTouches?.length) { touchStartX = touchStartY = null; return; }
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX, dy = touch.clientY - touchStartY;
  const duration = performance.now() - touchStartTime;
  const isTap = Math.abs(dx) < 12 && Math.abs(dy) < 12 && duration < 280;

  if (isTap) {
    const now = performance.now();
    const closeToLast = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY) < 42;
    if (now - lastTapTime < 320 && closeToLast) {
      toggleDoubleTapZoom(touch.clientX, touch.clientY);
      lastTapTime = 0;
    } else {
      lastTapTime = now; lastTapX = touch.clientX; lastTapY = touch.clientY;
    }
  } else if (zoom <= 1.05 && Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    dx < 0 ? next() : prev();
  }
  touchStartX = touchStartY = null;
}, { passive: true });

ui.stage.addEventListener('dblclick', e => {
  if (e.target === ui.canvas || ui.canvas.contains?.(e.target)) {
    e.preventDefault();
    toggleDoubleTapZoom(e.clientX, e.clientY);
  }
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (pdf) renderCurrent(); }, 120);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
loadSettings();
renderRecent();

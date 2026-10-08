import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import { migrateLegacyRotation, migrateLegacySplit, normalizeRotation, readingPosition, setMarker, valueAt } from './state.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const $ = id => document.getElementById(id);

const ui = {
  fileInput: $('fileInput'), fileInputBig: $('fileInputBig'), fileName: $('fileName'), homeBackBtn: $('homeBackBtn'),
  emptyState: $('emptyState'), reader: $('reader'), recentFiles: $('recentFiles'), stage: $('stage'), canvasWrap: $('canvasWrap'), canvas: $('pageCanvas'), loading: $('loading'),
  splitQuickBtn: $('splitQuickBtn'), splitQuickLabel: $('splitQuickLabel'), controlsToggle: $('controlsToggle'), controls: $('controls'), controlsClose: $('controlsClose'),
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
const SETTINGS_KEY = 'meuleitor:v2:settings';
const RECENT_KEY = 'meuleitor:v2:recent';

function key(kind) { return `meuleitor:v2:${kind}:${fileKey}`; }
function safeJSON(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }
function isMobile() { return window.innerWidth <= 760; }

function loadSettings() {
  Object.assign(prefs, safeJSON(localStorage.getItem(SETTINGS_KEY), {}));
  ui.splitSlider.value = prefs.splitAt;
  ui.gutterSlider.value = prefs.gutter;
  ui.cropToggle.checked = !!prefs.crop;
  ui.cropSlider.value = prefs.cropPct;
  ui.rtlToggle.checked = !!prefs.rtl;
  const dark = localStorage.getItem('meuleitor:v2:theme') === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  ui.themeToggle.checked = dark;
  updateSettingOutputs();
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs)); }
function updateSettingOutputs() {
  ui.splitOutput.value = `${Number(prefs.splitAt).toFixed(Number(prefs.splitAt) % 1 ? 1 : 0)}%`;
  ui.gutterOutput.value = `${Number(prefs.gutter).toFixed(1)}%`;
  ui.cropOutput.value = `${Number(prefs.cropPct).toFixed(Number(prefs.cropPct) % 1 ? 1 : 0)}%`;
  ui.cropSliderRow.classList.toggle('hidden', !prefs.crop);
}

function loadDocumentState() {
  const savedRot = safeJSON(localStorage.getItem(key('rotation')), null);
  const savedSplit = safeJSON(localStorage.getItem(key('split')), null);
  if (Array.isArray(savedRot)) rotationMarkers = savedRot;
  else {
    const legacy = safeJSON(localStorage.getItem(`leitor-rotations:${fileKey}`), {});
    rotationMarkers = migrateLegacyRotation(legacy);
    localStorage.setItem(key('rotation'), JSON.stringify(rotationMarkers));
  }
  if (Array.isArray(savedSplit)) splitMarkers = savedSplit;
  else {
    const legacy = safeJSON(localStorage.getItem(`leitor-split-rules:${fileKey}`), []);
    splitMarkers = migrateLegacySplit(legacy);
    localStorage.setItem(key('split'), JSON.stringify(splitMarkers));
  }
  const pos = safeJSON(localStorage.getItem(key('position')), null);
  pageNum = pos?.pageNum ? Math.max(1, Math.min(pdf.numPages, pos.pageNum)) : 1;
  half = pos?.half === 2 ? 2 : 0;
}
function savePosition() {
  if (!fileKey) return;
  localStorage.setItem(key('position'), JSON.stringify({ pageNum, half }));
}
function saveMarkers() {
  localStorage.setItem(key('rotation'), JSON.stringify(rotationMarkers));
  localStorage.setItem(key('split'), JSON.stringify(splitMarkers));
}
function rotationAt(page) { return normalizeRotation(valueAt(rotationMarkers, page, 0)); }
function splitAt(page) { return !!valueAt(splitMarkers, page, false); }

function setRotationFromHere(delta) {
  const next = normalizeRotation(rotationAt(pageNum) + delta);
  rotationMarkers = setMarker(rotationMarkers, pageNum, next, 0);
  saveMarkers();
  half = 0;
  renderCurrent();
}
function toggleSplitFromHere() {
  splitMarkers = setMarker(splitMarkers, pageNum, !splitAt(pageNum), false);
  saveMarkers();
  half = 0;
  normalizeHalf();
  renderCurrent();
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
    const crop = prefs.cropPct / 100;
    const dx = sw * crop, dy = sh * crop;
    sx += dx; sy += dy; sw -= dx * 2; sh -= dy * 2;
  }
  if (!layout.split) return { sx, sy, sw, sh };
  if (layout.axis === 'vertical') {
    const cut = sw * prefs.splitAt / 100;
    const gutter = sw * prefs.gutter / 100;
    const firstIsLeft = !prefs.rtl;
    const showLeft = (half === 1 && firstIsLeft) || (half === 2 && !firstIsLeft);
    if (showLeft) return { sx, sy, sw: Math.max(1, cut - gutter / 2), sh };
    const start = cut + gutter / 2;
    return { sx: sx + start, sy, sw: Math.max(1, sw - start), sh };
  }
  const cut = sh * prefs.splitAt / 100;
  const gutter = sh * prefs.gutter / 100;
  if (half === 1) return { sx, sy, sw, sh: Math.max(1, cut - gutter / 2) };
  const start = cut + gutter / 2;
  return { sx, sy: sy + start, sw, sh: Math.max(1, sh - start) };
}

function applyZoomStyle() {
  if (!baseCssWidth || !baseCssHeight) return;
  ui.canvas.style.width = `${baseCssWidth * zoom}px`;
  ui.canvas.style.height = `${baseCssHeight * zoom}px`;
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  ui.canvasWrap.classList.toggle('zoomed', zoom > 1.02);
}

async function renderCurrent() {
  if (!pdf) return;
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
    if (token !== renderToken) return;

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
  } catch (error) {
    console.error(error);
  } finally {
    if (token === renderToken) ui.loading.classList.add('hidden');
  }
}

function updateUI(layout) {
  const reading = readingPosition(pdf.numPages, pageNum, half, splitMarkers);
  ui.pageLabel.textContent = `Leitura ${reading.current} / ${reading.total}`;
  let side = layout.split ? (layout.axis === 'vertical' ? (half === 1 ? (prefs.rtl ? 'direita · 1ª metade' : 'esquerda · 1ª metade') : (prefs.rtl ? 'esquerda · 2ª metade' : 'direita · 2ª metade')) : (half === 1 ? 'superior · 1ª metade' : 'inferior · 2ª metade')) : 'página inteira';
  ui.sideLabel.textContent = `${side} · folha ${pageNum} / ${pdf.numPages}`;
  const activeSplit = splitAt(pageNum);
  ui.splitQuickBtn.classList.toggle('active', activeSplit);
  ui.splitQuickLabel.textContent = activeSplit ? 'Parar divisão daqui' : 'Dividir daqui';
  ui.splitSettingsBtn.classList.toggle('active', activeSplit);
  ui.splitSettingsBtn.textContent = activeSplit ? '▣ Parar divisão daqui' : '✂ Dividir daqui';
  const rot = rotationAt(pageNum);
  ui.rotationStatus.textContent = rot ? `Orientação atual: ${rot}° a partir desta folha.` : 'Orientação atual: original.';
  ui.pageSeek.max = String(pdf.numPages); ui.pageSeek.value = String(pageNum); ui.pageJump.max = String(pdf.numPages);
  ui.jumpHint.textContent = `Folha ${pageNum} de ${pdf.numPages} · toque no número da leitura para abrir este navegador.`;
  renderRulesSummary();
}

function renderRulesSummary() {
  ui.rulesSummary.replaceChildren();
  const rules = [];
  for (const m of rotationMarkers) rules.push({ page: m.page, text: `Girar para ${normalizeRotation(m.value)}°` });
  for (const m of splitMarkers) rules.push({ page: m.page, text: m.value ? 'Iniciar divisão' : 'Parar divisão' });
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
  pageNum = target; half = splitAt(pageNum) ? 1 : 0;
  await renderCurrent();
  ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

async function openFile(file) {
  if (!file) return;
  ui.loading.classList.remove('hidden');
  try {
    sourceFile = file;
    fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    ui.fileName.textContent = file.name;
    loadDocumentState();
    rememberRecent(file);
    ui.emptyState.classList.add('hidden');
    ui.reader.classList.remove('hidden');
    ui.homeBackBtn.classList.remove('hidden');
    ui.exportBtn.disabled = false;
    ui.exportName.value = `${file.name.replace(/\.pdf$/i, '')} - ajustado.pdf`;
    await renderCurrent();
  } catch (error) {
    console.error(error);
    alert('Não foi possível abrir este PDF.');
  } finally { ui.loading.classList.add('hidden'); }
}

function rememberRecent(file) {
  const entries = safeJSON(localStorage.getItem(RECENT_KEY), []).filter(x => x.key !== fileKey);
  entries.unshift({ key: fileKey, name: file.name });
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, 5)));
  renderRecent();
}
function renderRecent() {
  const entries = safeJSON(localStorage.getItem(RECENT_KEY), []);
  ui.recentFiles.replaceChildren();
  if (!entries.length) return;
  const title = document.createElement('strong'); title.textContent = 'Lidos recentemente'; ui.recentFiles.append(title);
  entries.forEach(entry => {
    const row = document.createElement('div'); row.className = 'recent-row';
    const name = document.createElement('span'); name.textContent = entry.name;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Selecionar'; button.addEventListener('click', () => ui.fileInputBig.click());
    row.append(name, button); ui.recentFiles.append(row);
  });
}

function bindSettings() {
  const ranged = [
    [ui.splitSlider, 'splitAt', Number], [ui.gutterSlider, 'gutter', Number], [ui.cropSlider, 'cropPct', Number]
  ];
  ranged.forEach(([el, prop, parse]) => el.addEventListener('input', async () => { prefs[prop] = parse(el.value); saveSettings(); updateSettingOutputs(); await renderCurrent(); }));
  ui.cropToggle.addEventListener('change', async () => { prefs.crop = ui.cropToggle.checked; saveSettings(); updateSettingOutputs(); await renderCurrent(); });
  ui.rtlToggle.addEventListener('change', async () => { prefs.rtl = ui.rtlToggle.checked; saveSettings(); await renderCurrent(); });
  ui.themeToggle.addEventListener('change', () => { document.documentElement.classList.toggle('dark', ui.themeToggle.checked); localStorage.setItem('meuleitor:v2:theme', ui.themeToggle.checked ? 'dark' : 'light'); });
}

function safeName(value) {
  let name = (value || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  if (!name) name = 'leitura-ajustada';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
function qualityConfig() {
  const value = document.querySelector('input[name="exportQuality"]:checked')?.value || 'standard';
  return value === 'high' ? { scale: 2.6, maxSide: 3400, jpeg: .93 } : { scale: 1.8, maxSide: 2200, jpeg: .86 };
}
function exportRects(canvas, split, axis) {
  let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
  if (prefs.crop) { const crop = prefs.cropPct / 100; const dx = sw * crop, dy = sh * crop; sx += dx; sy += dy; sw -= 2 * dx; sh -= 2 * dy; }
  if (!split) return [{ sx, sy, sw, sh }];
  if (axis === 'vertical') {
    const cut = sw * prefs.splitAt / 100, gutter = sw * prefs.gutter / 100;
    const left = { sx, sy, sw: Math.max(1, cut - gutter / 2), sh };
    const start = cut + gutter / 2;
    const right = { sx: sx + start, sy, sw: Math.max(1, sw - start), sh };
    return prefs.rtl ? [right, left] : [left, right];
  }
  const cut = sh * prefs.splitAt / 100, gutter = sh * prefs.gutter / 100;
  const top = { sx, sy, sw, sh: Math.max(1, cut - gutter / 2) };
  const start = cut + gutter / 2;
  const bottom = { sx, sy: sy + start, sw, sh: Math.max(1, sh - start) };
  return [top, bottom];
}
async function canvasBlob(canvas, quality) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao converter página.')), 'image/jpeg', quality)); }
async function appendPdfPage(out, source, rect, quality) {
  const factor = Math.min(1, quality.maxSide / Math.max(rect.sw, rect.sh));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(rect.sw * factor)); canvas.height = Math.max(1, Math.round(rect.sh * factor));
  const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
  const image = await out.embedJpg(await (await canvasBlob(canvas, quality.jpeg)).arrayBuffer());
  const ratio = canvas.width / canvas.height; const width = ratio <= 1 ? 842 * ratio : 842; const height = ratio <= 1 ? 842 : 842 / ratio;
  out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
}
async function saveGenerated(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' }); const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (error) { if (error?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function exportPdf() {
  if (!pdf || !sourceFile) return;
  ui.exportStartBtn.disabled = true; ui.exportCancelBtn.disabled = true; ui.exportProgressWrap.classList.remove('hidden'); ui.exportNote.textContent = '';
  try {
    const quality = qualityConfig(); const out = await PDFDocument.create();
    for (let n = 1; n <= pdf.numPages; n++) {
      ui.exportProgressBar.style.width = `${Math.round((n - 1) / pdf.numPages * 100)}%`; ui.exportProgressText.textContent = `Processando ${n} de ${pdf.numPages}`;
      await new Promise(requestAnimationFrame);
      const page = await pdf.getPage(n); const rotation = rotationAt(n); const viewport = page.getViewport({ scale: quality.scale, rotation: ((page.rotate || 0) + rotation) % 360 });
      const source = document.createElement('canvas'); source.width = Math.floor(viewport.width); source.height = Math.floor(viewport.height);
      const ctx = source.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, source.width, source.height); await page.render({ canvasContext: ctx, viewport }).promise;
      const split = splitAt(n); const axis = split ? axisForViewport(viewport) : null;
      for (const rect of exportRects(source, split, axis)) await appendPdfPage(out, source, rect, quality);
    }
    ui.exportProgressBar.style.width = '100%'; ui.exportProgressText.textContent = 'Finalizando…';
    const name = safeName(ui.exportName.value); await saveGenerated(await out.save({ useObjectStreams: true }), name); ui.exportNote.textContent = `PDF pronto: ${name}`;
  } catch (error) { console.error(error); ui.exportNote.textContent = 'Não foi possível gerar o PDF. Tente novamente.'; }
  finally { ui.exportStartBtn.disabled = false; ui.exportCancelBtn.disabled = false; }
}

[ui.fileInput, ui.fileInputBig].forEach(input => input.addEventListener('change', e => openFile(e.target.files?.[0])));
ui.homeBackBtn.addEventListener('click', () => { savePosition(); ui.controls.classList.remove('open'); ui.jumpSheet.classList.remove('open'); ui.reader.classList.add('hidden'); ui.emptyState.classList.remove('hidden'); ui.homeBackBtn.classList.add('hidden'); });
ui.controlsToggle.addEventListener('click', () => { ui.jumpSheet.classList.remove('open'); ui.controls.classList.toggle('open'); });
ui.controlsClose.addEventListener('click', () => ui.controls.classList.remove('open'));
ui.rotateLeftBtn.addEventListener('click', () => setRotationFromHere(270));
ui.rotateRightBtn.addEventListener('click', () => setRotationFromHere(90));
ui.splitQuickBtn.addEventListener('click', toggleSplitFromHere);
ui.splitSettingsBtn.addEventListener('click', toggleSplitFromHere);
ui.zoomInBtn.addEventListener('click', () => { zoom = Math.min(4, zoom * 1.15); applyZoomStyle(); });
ui.zoomOutBtn.addEventListener('click', () => { zoom = Math.max(.5, zoom / 1.15); applyZoomStyle(); });
ui.fitBtn.addEventListener('click', () => { zoom = 1; applyZoomStyle(); });
ui.prevBtn.addEventListener('click', prev); ui.nextBtn.addEventListener('click', next);
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
});

let touchStartX = null, touchStartY = null, pinchDistance = null, pinchZoom = 1, pinchActive = false;
function distance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
ui.stage.addEventListener('touchstart', e => {
  if (e.touches.length === 2) { pinchActive = true; pinchDistance = distance(e.touches); pinchZoom = zoom; touchStartX = touchStartY = null; }
  else if (e.touches.length === 1) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }
}, { passive: true });
ui.stage.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinchDistance) { e.preventDefault(); zoom = Math.max(.5, Math.min(4, pinchZoom * distance(e.touches) / pinchDistance)); applyZoomStyle(); }
}, { passive: false });
ui.stage.addEventListener('touchend', e => {
  if (pinchActive) { if (e.touches.length < 2) { pinchActive = false; pinchDistance = null; } touchStartX = touchStartY = null; return; }
  if (touchStartX == null || zoom > 1.05) { touchStartX = touchStartY = null; return; }
  const dx = e.changedTouches[0].clientX - touchStartX, dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) dx < 0 ? next() : prev();
  touchStartX = touchStartY = null;
}, { passive: true });

let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (pdf) renderCurrent(); }, 120); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
loadSettings(); renderRecent();

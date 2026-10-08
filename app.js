import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { compactMarkers, migrateLegacyRotation, migrateLegacySplit, normalizeRotation, readingPosition, setMarker, valueAt } from './state.mjs';

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
const SETTINGS_KEY = 'meuleitor:v2:settings';
const RECENT_KEY = 'meuleitor:v2:recent';

function key(kind) { return `meuleitor:v2:${kind}:${fileKey}`; }
function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function safeJSON(raw, fallback) { try { return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function isMobile() { return window.innerWidth <= 760; }

function showMessage(message) { alert(message); }

function loadSettings() {
  Object.assign(prefs, safeJSON(storageGet(SETTINGS_KEY), {}));
  ui.splitSlider.value = prefs.splitAt;
  ui.gutterSlider.value = prefs.gutter;
  ui.cropToggle.checked = !!prefs.crop;
  ui.cropSlider.value = prefs.cropPct;
  ui.rtlToggle.checked = !!prefs.rtl;
  const dark = storageGet('meuleitor:v2:theme') === 'dark';
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
  const savedRot = safeJSON(storageGet(key('rotation')), null);
  const savedSplit = safeJSON(storageGet(key('split')), null);
  if (Array.isArray(savedRot)) rotationMarkers = sanitizeRotationMarkers(savedRot);
  else {
    rotationMarkers = migrateLegacyRotation(safeJSON(storageGet(`leitor-rotations:${fileKey}`), {}));
    storageSet(key('rotation'), JSON.stringify(rotationMarkers));
  }
  if (Array.isArray(savedSplit)) splitMarkers = sanitizeSplitMarkers(savedSplit);
  else {
    splitMarkers = migrateLegacySplit(safeJSON(storageGet(`leitor-split-rules:${fileKey}`), []));
    storageSet(key('split'), JSON.stringify(splitMarkers));
  }
  const pos = safeJSON(storageGet(key('position')), null);
  pageNum = pos?.pageNum ? Math.max(1, Math.min(pdf.numPages, Number(pos.pageNum) || 1)) : 1;
  half = pos?.half === 2 ? 2 : 0;
}
function savePosition() {
  if (fileKey) storageSet(key('position'), JSON.stringify({ pageNum, half }));
}
function saveMarkers() {
  if (!fileKey) return;
  storageSet(key('rotation'), JSON.stringify(rotationMarkers));
  storageSet(key('split'), JSON.stringify(splitMarkers));
}
function rotationAt(page) { return normalizeRotation(valueAt(rotationMarkers, page, 0)); }
function splitAt(page) { return !!valueAt(splitMarkers, page, false); }

async function setRotationFromHere(delta) {
  const next = normalizeRotation(rotationAt(pageNum) + delta);
  rotationMarkers = setMarker(rotationMarkers, pageNum, next, 0);
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
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  ui.canvasWrap.classList.toggle('zoomed', zoom > 1.02);
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
  ui.pageLabel.textContent = `Leitura ${reading.current} / ${reading.total}`;
  let side = 'página inteira';
  if (layout.split) {
    if (layout.axis === 'vertical') side = half === 1 ? (prefs.rtl ? 'direita · 1ª metade' : 'esquerda · 1ª metade') : (prefs.rtl ? 'esquerda · 2ª metade' : 'direita · 2ª metade');
    else side = half === 1 ? 'superior · 1ª metade' : 'inferior · 2ª metade';
  }
  ui.sideLabel.textContent = `${side} · folha ${pageNum} / ${pdf.numPages}`;
  const activeSplit = splitAt(pageNum);
  ui.splitQuickBtn.classList.toggle('active', activeSplit);
  ui.splitQuickLabel.textContent = activeSplit ? 'Parar divisão daqui' : 'Dividir daqui';
  ui.splitSettingsBtn.classList.toggle('active', activeSplit);
  ui.splitSettingsBtn.textContent = activeSplit ? '▣ Parar divisão daqui' : '✂ Dividir daqui';
  const rot = rotationAt(pageNum);
  ui.rotationStatus.textContent = rot ? `Orientação atual: ${rot}° a partir desta folha.` : 'Orientação atual: original.';
  ui.pageSeek.max = String(pdf.numPages); ui.pageSeek.value = String(pageNum); ui.pageJump.max = String(pdf.numPages);
  ui.jumpHint.textContent = `Folha ${pageNum} de ${pdf.numPages}.`;
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
  for (const rule of rules) { const div = document.createElement('div'); div.className = 'rule-chip'; div.textContent = `Folha ${rule.page} · ${rule.text}`; ui.rulesSummary.append(div); }
}

async function next() {
  if (!pdf || navigationBusy) return;
  navigationBusy = true;
  try {
    if (splitAt(pageNum) && half === 1) half = 2;
    else if (pageNum < pdf.numPages) { pageNum++; half = splitAt(pageNum) ? 1 : 0; }
    await renderCurrent(); ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } finally { navigationBusy = false; }
}
async function prev() {
  if (!pdf || navigationBusy) return;
  navigationBusy = true;
  try {
    if (splitAt(pageNum) && half === 2) half = 1;
    else if (pageNum > 1) { pageNum--; half = splitAt(pageNum) ? 2 : 0; }
    await renderCurrent(); ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } finally { navigationBusy = false; }
}
async function jumpToPage(value) {
  if (!pdf) return;
  const target = Math.max(1, Math.min(pdf.numPages, Math.round(Number(value))));
  if (!Number.isFinite(target)) return;
  pageNum = target; half = splitAt(pageNum) ? 1 : 0;
  await renderCurrent(); ui.stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function attachPasswordHandler(task) {
  task.onPassword = (updatePassword, reason) => {
    const first = reason === pdfjsLib.PasswordResponses?.NEED_PASSWORD;
    const password = prompt(first ? 'Este PDF é protegido por senha. Digite a senha:' : 'Senha incorreta. Tente novamente:');
    if (password == null) task.destroy(); else updatePassword(password);
  };
}
function shouldSkipFallback(error) {
  return ['InvalidPDFException', 'PasswordException'].includes(error?.name);
}
async function readFileBytes(file) {
  if (typeof file.arrayBuffer === 'function') {
    try { return new Uint8Array(await file.arrayBuffer()); } catch (error) { console.warn('arrayBuffer falhou; tentando FileReader', error); }
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
async function loadPdfRobust(file) {
  let url = null;
  let firstError = null;
  try {
    url = URL.createObjectURL(file);
    const task = pdfjsLib.getDocument({ url, disableRange: true, disableStream: true });
    attachPasswordHandler(task);
    return { doc: await task.promise, url };
  } catch (error) {
    firstError = error;
    if (url) URL.revokeObjectURL(url);
    if (shouldSkipFallback(error)) throw error;
    console.warn('Abertura por URL local falhou; tentando leitura direta.', error);
  }
  try {
    const bytes = await readFileBytes(file);
    if (!bytes.length) throw new Error('Arquivo vazio.');
    const task = pdfjsLib.getDocument({ data: bytes });
    attachPasswordHandler(task);
    return { doc: await task.promise, url: null };
  } catch (error) {
    error.firstAttempt = firstError;
    throw error;
  }
}
function friendlyOpenError(error) {
  const name = error?.name || '';
  const message = String(error?.message || '').toLowerCase();
  if (name === 'PasswordException') return 'Este PDF é protegido por senha ou a senha informada não foi aceita.';
  if (name === 'InvalidPDFException' || message.includes('invalid pdf')) return 'O arquivo selecionado não parece ser um PDF válido ou está corrompido.';
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException' || message.includes('fetch') || message.includes('network') || message.includes('read')) return 'Não consegui ler esse PDF no aparelho. Se ele estiver no iCloud, Google Drive ou outro serviço, baixe o arquivo para o iPhone e tente novamente.';
  if (name === 'RangeError' || message.includes('memory')) return 'Este PDF é grande demais para a memória disponível no navegador. Feche outras abas e tente novamente.';
  return 'Não foi possível abrir este PDF. Tente selecioná-lo novamente. Se estiver no iCloud ou Drive, salve-o primeiro no aparelho.';
}

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') { showMessage('Selecione um arquivo PDF.'); return; }
  if (!file.size) { showMessage('Este arquivo está vazio ou ainda não foi baixado para o aparelho.'); return; }
  ui.loading.classList.remove('hidden');
  let loaded = null;
  try {
    loaded = await loadPdfRobust(file);
    const oldPdf = pdf, oldUrl = sourceObjectUrl;
    pdf = loaded.doc; sourceObjectUrl = loaded.url; sourceFile = file;
    fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    ui.fileName.textContent = file.name;
    try { loadDocumentState(); } catch (stateError) {
      console.warn('Estado salvo inválido; abrindo com estado limpo.', stateError);
      rotationMarkers = []; splitMarkers = []; pageNum = 1; half = 0;
    }
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
  } finally {
    ui.loading.classList.add('hidden');
  }
}

function rememberRecent(file) {
  const entries = safeJSON(storageGet(RECENT_KEY), []).filter(x => x.key !== fileKey);
  entries.unshift({ key: fileKey, name: file.name });
  storageSet(RECENT_KEY, JSON.stringify(entries.slice(0, 5)));
  renderRecent();
}
function renderRecent() {
  const entries = safeJSON(storageGet(RECENT_KEY), []);
  ui.recentFiles.replaceChildren();
  if (!Array.isArray(entries) || !entries.length) return;
  const title = document.createElement('strong'); title.textContent = 'Lidos recentemente'; ui.recentFiles.append(title);
  entries.forEach(entry => {
    const row = document.createElement('div'); row.className = 'recent-row';
    const name = document.createElement('span'); name.textContent = entry.name;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Selecionar'; button.addEventListener('click', () => ui.fileInputBig.click());
    row.append(name, button); ui.recentFiles.append(row);
  });
}

function bindSettings() {
  [[ui.splitSlider, 'splitAt'], [ui.gutterSlider, 'gutter'], [ui.cropSlider, 'cropPct']].forEach(([el, prop]) => el.addEventListener('input', async () => { prefs[prop] = Number(el.value); saveSettings(); updateSettingOutputs(); await renderCurrent(); }));
  ui.cropToggle.addEventListener('change', async () => { prefs.crop = ui.cropToggle.checked; saveSettings(); updateSettingOutputs(); await renderCurrent(); });
  ui.rtlToggle.addEventListener('change', async () => { prefs.rtl = ui.rtlToggle.checked; saveSettings(); await renderCurrent(); });
  ui.themeToggle.addEventListener('change', () => { document.documentElement.classList.toggle('dark', ui.themeToggle.checked); storageSet('meuleitor:v2:theme', ui.themeToggle.checked ? 'dark' : 'light'); });
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
  if (prefs.crop) { const crop = prefs.cropPct / 100, dx = sw * crop, dy = sh * crop; sx += dx; sy += dy; sw -= 2 * dx; sh -= 2 * dy; }
  if (!split) return [{ sx, sy, sw, sh }];
  if (axis === 'vertical') {
    const cut = sw * prefs.splitAt / 100, gutter = sw * prefs.gutter / 100;
    const left = { sx, sy, sw: Math.max(1, cut - gutter / 2), sh };
    const start = cut + gutter / 2, right = { sx: sx + start, sy, sw: Math.max(1, sw - start), sh };
    return prefs.rtl ? [right, left] : [left, right];
  }
  const cut = sh * prefs.splitAt / 100, gutter = sh * prefs.gutter / 100;
  const top = { sx, sy, sw, sh: Math.max(1, cut - gutter / 2) };
  const start = cut + gutter / 2, bottom = { sx, sy: sy + start, sw, sh: Math.max(1, sh - start) };
  return [top, bottom];
}
async function canvasBlob(canvas, quality) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao converter página.')), 'image/jpeg', quality)); }
async function appendPdfPage(out, source, rect, quality) {
  const factor = Math.min(1, quality.maxSide / Math.max(rect.sw, rect.sh));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(rect.sw * factor)); canvas.height = Math.max(1, Math.round(rect.sh * factor));
  const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
  const image = await out.embedJpg(await (await canvasBlob(canvas, quality.jpeg)).arrayBuffer());
  const ratio = canvas.width / canvas.height, width = ratio <= 1 ? 842 * ratio : 842, height = ratio <= 1 ? 842 : 842 / ratio;
  out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
}
async function saveGenerated(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' }), file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (error) { if (error?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function exportPdf() {
  if (!pdf || !sourceFile) return;
  ui.exportStartBtn.disabled = true; ui.exportCancelBtn.disabled = true; ui.exportProgressWrap.classList.remove('hidden'); ui.exportNote.textContent = '';
  try {
    const { PDFDocument } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
    const quality = qualityConfig(), out = await PDFDocument.create();
    for (let n = 1; n <= pdf.numPages; n++) {
      ui.exportProgressBar.style.width = `${Math.round((n - 1) / pdf.numPages * 100)}%`; ui.exportProgressText.textContent = `Processando ${n} de ${pdf.numPages}`;
      await new Promise(requestAnimationFrame);
      const page = await pdf.getPage(n), rotation = rotationAt(n), viewport = page.getViewport({ scale: quality.scale, rotation: ((page.rotate || 0) + rotation) % 360 });
      const source = document.createElement('canvas'); source.width = Math.floor(viewport.width); source.height = Math.floor(viewport.height);
      const ctx = source.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, source.width, source.height); await page.render({ canvasContext: ctx, viewport }).promise;
      const split = splitAt(n), axis = split ? axisForViewport(viewport) : null;
      for (const rect of exportRects(source, split, axis)) await appendPdfPage(out, source, rect, quality);
    }
    ui.exportProgressBar.style.width = '100%'; ui.exportProgressText.textContent = 'Finalizando…';
    const name = safeName(ui.exportName.value); await saveGenerated(await out.save({ useObjectStreams: true }), name); ui.exportNote.textContent = `PDF pronto: ${name}`;
  } catch (error) { console.error(error); ui.exportNote.textContent = 'Não foi possível gerar o PDF. Verifique sua conexão e tente novamente.'; }
  finally { ui.exportStartBtn.disabled = false; ui.exportCancelBtn.disabled = false; }
}

[ui.fileInput, ui.fileInputBig].forEach(input => input.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  await openFile(file);
  e.target.value = '';
}));
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
window.addEventListener('pagehide', () => { savePosition(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
loadSettings();
renderRecent();

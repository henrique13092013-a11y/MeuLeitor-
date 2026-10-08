import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'), fileInputBig: $('fileInputBig'), fileName: $('fileName'),
  emptyState: $('emptyState'), reader: $('reader'), canvas: $('pageCanvas'), canvasWrap: $('canvasWrap'), stage: $('stage'),
  loading: $('loading'), pageLabel: $('pageLabel'), sideLabel: $('sideLabel'), smartStatus: $('smartStatus'),
  prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), rotateLeftBtn: $('rotateLeftBtn'), rotateRightBtn: $('rotateRightBtn'),
  zoomOutBtn: $('zoomOutBtn'), zoomInBtn: $('zoomInBtn'), zoomLabel: $('zoomLabel'), fitBtn: $('fitBtn'),
  smartToggle: $('smartToggle'), splitToggle: $('splitToggle'), autoLandscape: $('autoLandscape'), splitSlider: $('splitSlider'), splitOutput: $('splitOutput'),
  gutterSlider: $('gutterSlider'), gutterOutput: $('gutterOutput'), cropToggle: $('cropToggle'), cropSlider: $('cropSlider'), cropOutput: $('cropOutput'),
  rtlToggle: $('rtlToggle'), themeBtn: $('themeBtn'), controls: $('controls'), controlsToggle: $('controlsToggle'), controlsClose: $('controlsClose'),
  splitQuickBtn: $('splitQuickBtn')
};

let pdf = null;
let fileKey = null;
let pageNum = 1;
let half = 0;
let rotation = 0;
let zoom = 1;
let baseCssWidth = 0;
let baseCssHeight = 0;
let lastViewportWidth = window.innerWidth;
let splitRules = [];
let renderToken = 0;
const analysisCache = new Map();
const visualAxisCache = new Map();

const prefs = {
  smart: true,
  split: false,
  autoLandscape: true,
  splitAt: 50,
  gutter: 1,
  crop: false,
  cropPct: 3,
  rtl: false,
};

function isMobile() { return window.innerWidth <= 760; }

function splitRulesKey() { return fileKey ? `leitor-split-rules:${fileKey}` : null; }

function loadSplitRules() {
  const key = splitRulesKey();
  if (!key) { splitRules = []; return; }
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    splitRules = Array.isArray(raw)
      ? raw.filter(r => Number.isInteger(r.page) && ['split','whole','auto'].includes(r.mode))
          .sort((a,b) => a.page - b.page)
      : [];
  } catch (_) { splitRules = []; }
}

function saveSplitRules() {
  const key = splitRulesKey();
  if (key) localStorage.setItem(key, JSON.stringify(splitRules));
}

function manualModeAt(page) {
  let mode = 'auto';
  for (const rule of splitRules) {
    if (rule.page > page) break;
    mode = rule.mode;
  }
  return mode;
}

function setManualModeFromHere(mode) {
  splitRules = splitRules.filter(r => r.page !== pageNum);
  splitRules.push({ page: pageNum, mode });
  splitRules.sort((a,b) => a.page - b.page);
  saveSplitRules();
}

function updateQuickSplitButton(layout = null) {
  if (!els.splitQuickBtn || !pdf) return;
  const isSplit = layout ? layout.split : manualModeAt(pageNum) === 'split';
  els.splitQuickBtn.textContent = isSplit ? '✂ Pausar daqui' : '✂ Dividir daqui';
  els.splitQuickBtn.classList.toggle('active', isSplit);
  els.splitQuickBtn.title = isSplit
    ? 'Exibir página inteira a partir desta página'
    : 'Forçar divisão a partir desta página';
}

function applyZoomStyle() {
  if (!baseCssWidth || !baseCssHeight) return;
  els.canvas.style.width = `${baseCssWidth * zoom}px`;
  els.canvas.style.height = `${baseCssHeight * zoom}px`;
  els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  els.canvasWrap.classList.toggle('zoomed', zoom > 1.02);
}

function loadGlobalPrefs() {
  const p = JSON.parse(localStorage.getItem('leitorAcademicoPrefs') || '{}');
  Object.assign(prefs, p);
  els.smartToggle.checked = prefs.smart;
  els.splitToggle.checked = prefs.split;
  els.autoLandscape.checked = prefs.autoLandscape;
  els.splitSlider.value = prefs.splitAt;
  els.gutterSlider.value = prefs.gutter;
  els.cropToggle.checked = prefs.crop;
  els.cropSlider.value = prefs.cropPct;
  els.rtlToggle.checked = prefs.rtl;
  updateOutputs();
  const dark = localStorage.getItem('leitorAcademicoTheme') === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}
function saveGlobalPrefs() { localStorage.setItem('leitorAcademicoPrefs', JSON.stringify(prefs)); }
function updateOutputs() {
  els.splitOutput.value = `${Number(prefs.splitAt).toFixed(prefs.splitAt % 1 ? 1 : 0)}%`;
  els.gutterOutput.value = `${Number(prefs.gutter).toFixed(1)}%`;
  els.cropOutput.value = `${Number(prefs.cropPct).toFixed(prefs.cropPct % 1 ? 1 : 0)}%`;
}
function savePosition() {
  if (!fileKey) return;
  localStorage.setItem(`leitor-pos:${fileKey}`, JSON.stringify({pageNum, half, rotation}));
}
function restorePosition() {
  const pos = JSON.parse(localStorage.getItem(`leitor-pos:${fileKey}`) || 'null');
  if (pos) {
    pageNum = Math.max(1, Math.min(pdf.numPages, pos.pageNum || 1));
    half = pos.half || 0;
    rotation = ((pos.rotation || 0) % 360 + 360) % 360;
  } else { pageNum = 1; half = 0; rotation = 0; }
}

function cardinalAngle(deg) {
  const v = ((deg % 360) + 360) % 360;
  const choices = [0, 90, 180, 270];
  return choices.reduce((best, x) => Math.abs(x - v) < Math.abs(best - v) ? x : best, 0);
}

async function analyzePage(page) {
  if (analysisCache.has(page.pageNumber)) return analysisCache.get(page.pageNumber);
  let text = null;
  let autoRotation = 0;
  let textChars = 0;
  try {
    text = await page.getTextContent();
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate || 0 });
    const weights = new Map([[0,0],[90,0],[180,0],[270,0]]);
    for (const item of text.items || []) {
      const chars = (item.str || '').trim().length;
      if (!chars || !item.transform) continue;
      const tx = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
      const angle = cardinalAngle(Math.atan2(tx[1], tx[0]) * 180 / Math.PI);
      weights.set(angle, weights.get(angle) + Math.min(chars, 80));
      textChars += chars;
    }
    if (textChars >= 24) {
      const dominant = [...weights.entries()].sort((a,b) => b[1] - a[1])[0][0];
      autoRotation = (360 - dominant) % 360;
    }
  } catch (_) {}
  const result = { text, textChars, autoRotation };
  analysisCache.set(page.pageNumber, result);
  return result;
}

function textSpreadAxis(page, analysis, effectiveRotation) {
  if (!analysis.text || analysis.textChars < 40) return null;
  const viewport = page.getViewport({ scale: 1, rotation: effectiveRotation });
  const w = viewport.width, h = viewport.height;
  let left = 0, centerX = 0, right = 0, top = 0, centerY = 0, bottom = 0;
  for (const item of analysis.text.items || []) {
    const chars = Math.min((item.str || '').trim().length, 80);
    if (!chars || !item.transform) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const x = tx[4], y = tx[5];
    if (x < w * .44) left += chars; else if (x > w * .56) right += chars; else centerX += chars;
    if (y < h * .44) top += chars; else if (y > h * .56) bottom += chars; else centerY += chars;
  }
  const ratio = w / h;
  const verticalGap = Math.min(left, right) >= 18 && centerX < Math.min(left, right) * .34;
  const horizontalGap = Math.min(top, bottom) >= 18 && centerY < Math.min(top, bottom) * .34;
  if ((ratio > 1.18 && verticalGap) || ratio > 1.62) return 'vertical';
  if ((ratio < .72 && horizontalGap) || ratio < .52) return 'horizontal';
  return null;
}

async function pageLayout(page) {
  const analysis = await analyzePage(page);
  const autoExtra = prefs.smart ? analysis.autoRotation : 0;
  const effectiveRotation = ((page.rotate || 0) + rotation + autoExtra) % 360;
  const viewport = page.getViewport({ scale: 1, rotation: effectiveRotation });
  const visualKey = `${page.pageNumber}:${effectiveRotation}`;
  const manualMode = manualModeAt(page.pageNumber);
  let axis = null;

  if (manualMode !== 'whole' && prefs.smart) {
    axis = textSpreadAxis(page, analysis, effectiveRotation) || visualAxisCache.get(visualKey) || null;
  }

  if (manualMode === 'split') {
    if (!axis) {
      if (!prefs.autoLandscape) axis = 'vertical';
      else if (viewport.width > viewport.height * 1.08) axis = 'vertical';
      else if (viewport.height > viewport.width * 1.28) axis = 'horizontal';
      else axis = 'vertical';
    }
  } else if (manualMode === 'whole') {
    axis = null;
  } else if (!axis && prefs.split) {
    if (!prefs.autoLandscape || viewport.width > viewport.height * 1.08) axis = 'vertical';
  }

  return { split: !!axis, axis, effectiveRotation, analysis, viewport, visualKey, manualMode };
}

function inkDensity(canvas, axis, pos, bandPct = .018) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const sampleStep = Math.max(2, Math.floor(Math.min(w, h) / 180));
  let dark = 0, total = 0;
  if (axis === 'vertical') {
    const halfBand = Math.max(1, Math.floor(w * bandPct / 2));
    const cx = Math.floor(w * pos);
    for (let x = Math.max(0, cx-halfBand); x < Math.min(w, cx+halfBand); x += sampleStep) {
      for (let y = 0; y < h; y += sampleStep) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const lum = .2126*d[0] + .7152*d[1] + .0722*d[2];
        if (lum < 205) dark++;
        total++;
      }
    }
  } else {
    const halfBand = Math.max(1, Math.floor(h * bandPct / 2));
    const cy = Math.floor(h * pos);
    for (let y = Math.max(0, cy-halfBand); y < Math.min(h, cy+halfBand); y += sampleStep) {
      for (let x = 0; x < w; x += sampleStep) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const lum = .2126*d[0] + .7152*d[1] + .0722*d[2];
        if (lum < 205) dark++;
        total++;
      }
    }
  }
  return total ? dark / total : 0;
}

function visualSpreadAxis(canvas) {
  const ratio = canvas.width / canvas.height;
  const baselineV = (inkDensity(canvas, 'vertical', .30) + inkDensity(canvas, 'vertical', .70)) / 2;
  const baselineH = (inkDensity(canvas, 'horizontal', .30) + inkDensity(canvas, 'horizontal', .70)) / 2;
  let vDev = 0, hDev = 0;
  for (const p of [.44,.47,.50,.53,.56]) {
    vDev = Math.max(vDev, Math.abs(inkDensity(canvas, 'vertical', p) - baselineV));
    hDev = Math.max(hDev, Math.abs(inkDensity(canvas, 'horizontal', p) - baselineH));
  }
  if (ratio > 1.58 || (ratio > 1.16 && vDev > .085)) return 'vertical';
  if (ratio < .56 || (ratio < .78 && hDev > .12)) return 'horizontal';
  return null;
}

function smartStatusText(layout) {
  if (!prefs.smart) return 'Automático desligado';
  const textOk = layout.analysis.textChars >= 24;
  const rot = layout.analysis.autoRotation ? ` · rotação ${layout.analysis.autoRotation}°` : '';
  const split = layout.split ? ` · dupla ${layout.axis === 'vertical' ? 'lado a lado' : 'acima/abaixo'}` : ' · página inteira';
  return `${textOk ? 'Texto detectado' : 'Scan analisado visualmente'}${rot}${split}`;
}

async function openFile(file) {
  if (!file) return;
  els.loading.classList.remove('hidden');
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    pdf = await pdfjsLib.getDocument({ data }).promise;
    fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    analysisCache.clear();
    visualAxisCache.clear();
    els.fileName.textContent = file.name;
    restorePosition();
    loadSplitRules();
    els.emptyState.classList.add('hidden');
    els.reader.classList.remove('hidden');
    await normalizeHalf();
    await renderCurrent();
  } catch (err) {
    console.error(err);
    alert('Não foi possível abrir este PDF. Tente outro arquivo.');
  } finally { els.loading.classList.add('hidden'); }
}

async function normalizeHalf() {
  if (!pdf) return;
  const page = await pdf.getPage(pageNum);
  const layout = await pageLayout(page);
  if (layout.split && half === 0) half = 1;
  if (!layout.split) half = 0;
}

async function renderCurrent() {
  if (!pdf) return;
  const token = ++renderToken;
  els.loading.classList.remove('hidden');
  try {
    const page = await pdf.getPage(pageNum);
    const layout = await pageLayout(page);
    if (layout.split && half === 0) half = 1;
    if (!layout.split) half = 0;

    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const renderScale = 2.2 * deviceScale;
    const viewport = page.getViewport({ scale: renderScale, rotation: layout.effectiveRotation });

    const source = document.createElement('canvas');
    source.width = Math.floor(viewport.width);
    source.height = Math.floor(viewport.height);
    const sctx = source.getContext('2d', { alpha: false });
    await page.render({ canvasContext: sctx, viewport }).promise;
    if (token !== renderToken) return;

    if (prefs.smart && layout.manualMode !== 'whole' && !layout.axis && layout.analysis.textChars < 40) {
      const visualAxis = visualSpreadAxis(source);
      if (visualAxis) {
        visualAxisCache.set(layout.visualKey, visualAxis);
        layout.axis = visualAxis;
        layout.split = true;
        if (half === 0) half = 1;
      }
    }

    let sx = 0, sy = 0, sw = source.width, sh = source.height;
    const crop = prefs.crop ? (prefs.cropPct / 100) : 0;
    const cropX = sw * crop, cropY = sh * crop;
    sx += cropX; sy += cropY; sw -= cropX * 2; sh -= cropY * 2;

    if (layout.split) {
      if (layout.axis === 'vertical') {
        const cut = sw * (prefs.splitAt / 100);
        const gutterPx = sw * (prefs.gutter / 100);
        const firstIsLeft = !prefs.rtl;
        const showLeft = (half === 1 && firstIsLeft) || (half === 2 && !firstIsLeft);
        if (showLeft) {
          sw = Math.max(1, cut - gutterPx / 2);
        } else {
          const rightStart = cut + gutterPx / 2;
          sx += rightStart;
          sw = Math.max(1, sw - rightStart);
        }
      } else {
        const cut = sh * (prefs.splitAt / 100);
        const gutterPx = sh * (prefs.gutter / 100);
        if (half === 1) {
          sh = Math.max(1, cut - gutterPx / 2);
        } else {
          const bottomStart = cut + gutterPx / 2;
          sy += bottomStart;
          sh = Math.max(1, sh - bottomStart);
        }
      }
    }

    const available = Math.max(280, els.stage.clientWidth - (isMobile() ? 16 : 36));
    const fitScale = Math.min(1, available / (sw / deviceScale));
    baseCssWidth = (sw / deviceScale) * fitScale;
    baseCssHeight = (sh / deviceScale) * fitScale;

    els.canvas.width = Math.max(1, Math.floor(sw));
    els.canvas.height = Math.max(1, Math.floor(sh));
    applyZoomStyle();
    const ctx = els.canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

    els.pageLabel.textContent = `PDF ${pageNum} / ${pdf.numPages}`;
    if (layout.split && layout.axis === 'vertical') {
      els.sideLabel.textContent = half === 1 ? (prefs.rtl ? 'direita · 1ª metade' : 'esquerda · 1ª metade') : (prefs.rtl ? 'esquerda · 2ª metade' : 'direita · 2ª metade');
    } else if (layout.split) {
      els.sideLabel.textContent = half === 1 ? 'superior · 1ª metade' : 'inferior · 2ª metade';
    } else els.sideLabel.textContent = 'página inteira';
    els.smartStatus.textContent = smartStatusText(layout);
    updateQuickSplitButton(layout);
    savePosition();
  } finally {
    if (token === renderToken) els.loading.classList.add('hidden');
  }
}

async function next() {
  if (!pdf) return;
  const p = await pdf.getPage(pageNum);
  const layout = await pageLayout(p);
  if (layout.split && half === 1) half = 2;
  else if (pageNum < pdf.numPages) { pageNum++; half = 0; await normalizeHalf(); }
  await renderCurrent();
  els.stage.scrollTo({top:0,left:0,behavior:'auto'});
}
async function prev() {
  if (!pdf) return;
  const p = await pdf.getPage(pageNum);
  const layout = await pageLayout(p);
  if (layout.split && half === 2) half = 1;
  else if (pageNum > 1) {
    pageNum--;
    const prevPage = await pdf.getPage(pageNum);
    half = (await pageLayout(prevPage)).split ? 2 : 0;
  }
  await renderCurrent();
  els.stage.scrollTo({top:0,left:0,behavior:'auto'});
}

function closeControlsAfterAdjustment(delay = 550) {
  if (!isMobile() || !els.controls.classList.contains('open')) return;
  clearTimeout(closeControlsAfterAdjustment.timer);
  closeControlsAfterAdjustment.timer = setTimeout(() => {
    els.controls.classList.add('closing');
    setTimeout(() => {
      els.controls.classList.remove('open', 'closing');
    }, 180);
  }, delay);
}

[els.fileInput, els.fileInputBig].forEach(input => input.addEventListener('change', e => openFile(e.target.files[0])));
els.prevBtn.addEventListener('click', prev);
els.nextBtn.addEventListener('click', next);
els.rotateLeftBtn.addEventListener('click', async () => { rotation = (rotation + 270) % 360; half = 0; await normalizeHalf(); await renderCurrent(); closeControlsAfterAdjustment(); });
els.rotateRightBtn.addEventListener('click', async () => { rotation = (rotation + 90) % 360; half = 0; await normalizeHalf(); await renderCurrent(); closeControlsAfterAdjustment(); });
els.zoomInBtn.addEventListener('click', () => { zoom = Math.min(4, zoom * 1.15); applyZoomStyle(); closeControlsAfterAdjustment(); });
els.zoomOutBtn.addEventListener('click', () => { zoom = Math.max(.5, zoom / 1.15); applyZoomStyle(); closeControlsAfterAdjustment(); });
els.fitBtn.addEventListener('click', () => { zoom = 1; applyZoomStyle(); closeControlsAfterAdjustment(); });

els.splitQuickBtn.addEventListener('click', async () => {
  if (!pdf) return;
  const page = await pdf.getPage(pageNum);
  const layout = await pageLayout(page);
  setManualModeFromHere(layout.split ? 'whole' : 'split');
  half = 0;
  await normalizeHalf();
  await renderCurrent();
  if (isMobile()) els.controls.classList.remove('open');
});

function bindPref(el, key, parser = v => v) {
  const event = el.type === 'range' ? 'input' : 'change';
  el.addEventListener(event, async () => {
    prefs[key] = el.type === 'checkbox' ? el.checked : parser(el.value);
    saveGlobalPrefs(); updateOutputs();
    if (['smart','split','autoLandscape'].includes(key)) { half = 0; await normalizeHalf(); }
    await renderCurrent();
    if (el.type !== 'range') closeControlsAfterAdjustment(500);
  });
  if (el.type === 'range') el.addEventListener('change', () => closeControlsAfterAdjustment(420));
}
bindPref(els.smartToggle, 'smart');
bindPref(els.splitToggle, 'split');
bindPref(els.autoLandscape, 'autoLandscape');
bindPref(els.splitSlider, 'splitAt', Number);
bindPref(els.gutterSlider, 'gutter', Number);
bindPref(els.cropToggle, 'crop');
bindPref(els.cropSlider, 'cropPct', Number);
bindPref(els.rtlToggle, 'rtl');

els.themeBtn.addEventListener('click', () => {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('leitorAcademicoTheme', dark ? 'dark' : 'light');
});
els.controlsToggle.addEventListener('click', () => els.controls.classList.toggle('open'));
els.controlsClose.addEventListener('click', () => els.controls.classList.remove('open'));
els.stage.addEventListener('click', () => { if (isMobile()) els.controls.classList.remove('open'); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
});
let touchStartX = null, touchStartY = null;
let pinchStartDistance = null, pinchStartZoom = 1, pinchActive = false;

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

els.stage.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    pinchActive = true;
    pinchStartDistance = touchDistance(e.touches);
    pinchStartZoom = zoom;
    touchStartX = touchStartY = null;
  } else if (e.touches.length === 1 && !pinchActive) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, {passive:true});

els.stage.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinchStartDistance) {
    e.preventDefault();
    const factor = touchDistance(e.touches) / pinchStartDistance;
    zoom = Math.max(.5, Math.min(4, pinchStartZoom * factor));
    applyZoomStyle();
  }
}, {passive:false});

els.stage.addEventListener('touchend', (e) => {
  if (pinchActive) {
    if (e.touches.length < 2) {
      pinchActive = false;
      pinchStartDistance = null;
    }
    touchStartX = touchStartY = null;
    return;
  }
  if (touchStartX == null || zoom > 1.05) {
    touchStartX = touchStartY = null;
    return;
  }
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) dx < 0 ? next() : prev();
  touchStartX = touchStartY = null;
}, {passive:true});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  if (!pdf || Math.abs(w - lastViewportWidth) < 24) return;
  lastViewportWidth = w;
  renderCurrent();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
loadGlobalPrefs();
// Retorno seguro à tela inicial: mantém as preferências e a posição salvas.
const homeBackBtn = document.getElementById('homeBackBtn');
function updateHomeBack() { homeBackBtn.classList.toggle('hidden', els.reader.classList.contains('hidden')); }
homeBackBtn.addEventListener('click', () => {
  savePosition();
  els.controls.classList.remove('open');
  document.getElementById('exportModal').classList.add('hidden');
  els.reader.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
  updateHomeBack();
});
const backObserver = new MutationObserver(updateHomeBack);
backObserver.observe(els.reader, { attributes: true, attributeFilter: ['class'] });
updateHomeBack();

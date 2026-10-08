import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'), fileInputBig: $('fileInputBig'), fileName: $('fileName'),
  emptyState: $('emptyState'), reader: $('reader'), canvas: $('pageCanvas'), stage: $('stage'),
  loading: $('loading'), pageLabel: $('pageLabel'), sideLabel: $('sideLabel'),
  prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), rotateLeftBtn: $('rotateLeftBtn'), rotateRightBtn: $('rotateRightBtn'),
  zoomOutBtn: $('zoomOutBtn'), zoomInBtn: $('zoomInBtn'), zoomLabel: $('zoomLabel'), fitBtn: $('fitBtn'),
  splitToggle: $('splitToggle'), autoLandscape: $('autoLandscape'), splitSlider: $('splitSlider'), splitOutput: $('splitOutput'),
  gutterSlider: $('gutterSlider'), gutterOutput: $('gutterOutput'), cropToggle: $('cropToggle'), cropSlider: $('cropSlider'), cropOutput: $('cropOutput'),
  rtlToggle: $('rtlToggle'), themeBtn: $('themeBtn'), controls: $('controls'), controlsToggle: $('controlsToggle')
};

let pdf = null;
let fileKey = null;
let pageNum = 1;
let half = 0; // 0 = página inteira; 1 = primeira metade; 2 = segunda metade
let rotation = 0;
let zoom = 1;
let fitWidth = true;
let renderToken = 0;

const prefs = {
  split: false,
  autoLandscape: true,
  splitAt: 50,
  gutter: 1,
  crop: false,
  cropPct: 3,
  rtl: false,
};

function loadGlobalPrefs() {
  const p = JSON.parse(localStorage.getItem('leitorAcademicoPrefs') || '{}');
  Object.assign(prefs, p);
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

async function openFile(file) {
  if (!file) return;
  els.loading.classList.remove('hidden');
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    pdf = await pdfjsLib.getDocument({ data }).promise;
    fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    els.fileName.textContent = file.name;
    restorePosition();
    els.emptyState.classList.add('hidden');
    els.reader.classList.remove('hidden');
    await normalizeHalf();
    await renderCurrent();
  } catch (err) {
    console.error(err);
    alert('Não foi possível abrir este PDF. Tente outro arquivo.');
  } finally { els.loading.classList.add('hidden'); }
}

async function splitStatus(page) {
  if (!prefs.split) return false;
  const viewport = page.getViewport({ scale: 1, rotation });
  if (!prefs.autoLandscape) return true;
  return viewport.width > viewport.height * 1.08;
}

async function normalizeHalf() {
  if (!pdf) return;
  const page = await pdf.getPage(pageNum);
  const split = await splitStatus(page);
  if (split && half === 0) half = 1;
  if (!split) half = 0;
}

async function renderCurrent() {
  if (!pdf) return;
  const token = ++renderToken;
  els.loading.classList.remove('hidden');
  try {
    const page = await pdf.getPage(pageNum);
    const split = await splitStatus(page);
    if (split && half === 0) half = 1;
    if (!split) half = 0;

    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const renderScale = 2.2 * deviceScale;
    const viewport = page.getViewport({ scale: renderScale, rotation });

    const source = document.createElement('canvas');
    source.width = Math.floor(viewport.width);
    source.height = Math.floor(viewport.height);
    const sctx = source.getContext('2d', { alpha: false });
    await page.render({ canvasContext: sctx, viewport }).promise;
    if (token !== renderToken) return;

    let sx = 0, sy = 0, sw = source.width, sh = source.height;
    const crop = prefs.crop ? (prefs.cropPct / 100) : 0;
    const cropX = sw * crop, cropY = sh * crop;
    sx += cropX; sy += cropY; sw -= cropX * 2; sh -= cropY * 2;

    if (split) {
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
    }

    const available = Math.max(280, els.stage.clientWidth - (window.innerWidth <= 760 ? 16 : 36));
    const logicalScale = fitWidth ? Math.min(1, available / (sw / deviceScale)) : 1;
    const cssWidth = (sw / deviceScale) * logicalScale * zoom;
    const cssHeight = (sh / deviceScale) * logicalScale * zoom;

    els.canvas.width = Math.max(1, Math.floor(sw));
    els.canvas.height = Math.max(1, Math.floor(sh));
    els.canvas.style.width = `${cssWidth}px`;
    els.canvas.style.height = `${cssHeight}px`;
    const ctx = els.canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

    els.pageLabel.textContent = `PDF ${pageNum} / ${pdf.numPages}`;
    if (split) els.sideLabel.textContent = half === 1 ? (prefs.rtl ? 'direita · 1ª metade' : 'esquerda · 1ª metade') : (prefs.rtl ? 'esquerda · 2ª metade' : 'direita · 2ª metade');
    else els.sideLabel.textContent = 'página inteira';
    els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    savePosition();
  } finally {
    if (token === renderToken) els.loading.classList.add('hidden');
  }
}

async function next() {
  if (!pdf) return;
  const p = await pdf.getPage(pageNum);
  const split = await splitStatus(p);
  if (split && half === 1) half = 2;
  else if (pageNum < pdf.numPages) { pageNum++; half = 0; await normalizeHalf(); }
  await renderCurrent();
  els.stage.scrollTo({top:0,left:0,behavior:'auto'});
}
async function prev() {
  if (!pdf) return;
  const p = await pdf.getPage(pageNum);
  const split = await splitStatus(p);
  if (split && half === 2) half = 1;
  else if (pageNum > 1) {
    pageNum--;
    const prevPage = await pdf.getPage(pageNum);
    half = (await splitStatus(prevPage)) ? 2 : 0;
  }
  await renderCurrent();
  els.stage.scrollTo({top:0,left:0,behavior:'auto'});
}

[els.fileInput, els.fileInputBig].forEach(input => input.addEventListener('change', e => openFile(e.target.files[0])));
els.prevBtn.addEventListener('click', prev);
els.nextBtn.addEventListener('click', next);
els.rotateLeftBtn.addEventListener('click', async () => { rotation = (rotation + 270) % 360; half = 0; await normalizeHalf(); renderCurrent(); });
els.rotateRightBtn.addEventListener('click', async () => { rotation = (rotation + 90) % 360; half = 0; await normalizeHalf(); renderCurrent(); });
els.zoomInBtn.addEventListener('click', () => { fitWidth = false; zoom = Math.min(3, zoom + .15); renderCurrent(); });
els.zoomOutBtn.addEventListener('click', () => { fitWidth = false; zoom = Math.max(.35, zoom - .15); renderCurrent(); });
els.fitBtn.addEventListener('click', () => { fitWidth = true; zoom = 1; renderCurrent(); });

function bindPref(el, key, parser = v => v) {
  const event = el.type === 'range' ? 'input' : 'change';
  el.addEventListener(event, async () => {
    prefs[key] = el.type === 'checkbox' ? el.checked : parser(el.value);
    saveGlobalPrefs(); updateOutputs();
    if (key === 'split' || key === 'autoLandscape') { half = 0; await normalizeHalf(); }
    renderCurrent();
  });
}
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
els.stage.addEventListener('click', () => { if (window.innerWidth <= 760) els.controls.classList.remove('open'); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
});
let touchStartX = null, touchStartY = null;
els.stage.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; } }, {passive:true});
els.stage.addEventListener('touchend', (e) => {
  if (touchStartX == null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) dx < 0 ? next() : prev();
  touchStartX = touchStartY = null;
}, {passive:true});

window.addEventListener('resize', () => { if (pdf && fitWidth) renderCurrent(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
loadGlobalPrefs();

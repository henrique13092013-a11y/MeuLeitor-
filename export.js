import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const $ = id => document.getElementById(id);
const ui = {
  inputs: [$('fileInput'), $('fileInputBig')],
  btn: $('exportBtn'),
  modal: $('exportModal'),
  name: $('exportName'),
  cancel: $('exportCancelBtn'),
  start: $('exportStartBtn'),
  wrap: $('exportProgressWrap'),
  bar: $('exportProgressBar'),
  text: $('exportProgressText'),
  note: $('exportNote')
};

let file = null;
let pdf = null;
let fileKey = null;

function safeName(value) {
  let name = (value || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  if (!name) name = 'leitura-ajustada';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function baseName(name) {
  return (name || 'arquivo').replace(/\.pdf$/i, '');
}

function prefs() {
  const defaults = { split:false, autoLandscape:true, splitAt:50, gutter:1, crop:false, cropPct:3, rtl:false };
  try {
    return Object.assign(defaults, JSON.parse(localStorage.getItem('leitorAcademicoPrefs') || '{}'));
  } catch (_) {
    return defaults;
  }
}

function rotation() {
  try {
    const saved = JSON.parse(localStorage.getItem(`leitor-pos:${fileKey}`) || '{}');
    return ((saved.rotation || 0) % 360 + 360) % 360;
  } catch (_) {
    return 0;
  }
}

function rules() {
  try {
    const list = JSON.parse(localStorage.getItem(`leitor-split-rules:${fileKey}`) || '[]');
    return Array.isArray(list) ? list.sort((a,b) => a.page - b.page) : [];
  } catch (_) {
    return [];
  }
}

function modeAt(page, list) {
  let mode = 'auto';
  for (const rule of list) {
    if (rule.page > page) break;
    if (['split','whole','auto'].includes(rule.mode)) mode = rule.mode;
  }
  return mode;
}

function qualityConfig() {
  const value = document.querySelector('input[name="exportQuality"]:checked')?.value || 'standard';
  if (value === 'high') return { renderScale: 2.6, maxSide: 3400, jpeg: .93, label: 'alta qualidade' };
  return { renderScale: 1.8, maxSide: 2200, jpeg: .86, label: 'qualidade padrão' };
}

async function prepare(selectedFile) {
  if (!selectedFile) return;
  try {
    file = selectedFile;
    fileKey = `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`;
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await selectedFile.arrayBuffer()) }).promise;
    ui.btn.disabled = false;
    ui.name.value = `${baseName(selectedFile.name)} - leitura.pdf`;
  } catch (error) {
    console.error(error);
    pdf = null;
    ui.btn.disabled = true;
  }
}

ui.inputs.forEach(input => input?.addEventListener('change', event => prepare(event.target.files?.[0])));

function rects(canvas, split, axis, settings) {
  let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
  const crop = settings.crop ? settings.cropPct / 100 : 0;
  const cropX = sw * crop, cropY = sh * crop;
  sx += cropX; sy += cropY; sw -= cropX * 2; sh -= cropY * 2;

  if (!split) return [{ sx, sy, sw, sh }];

  if (axis === 'vertical') {
    const cut = sw * settings.splitAt / 100;
    const gutter = sw * settings.gutter / 100;
    const left = { sx, sy, sw: Math.max(1, cut - gutter / 2), sh };
    const rightStart = cut + gutter / 2;
    const right = { sx: sx + rightStart, sy, sw: Math.max(1, sw - rightStart), sh };
    return settings.rtl ? [right, left] : [left, right];
  }

  const cut = sh * settings.splitAt / 100;
  const gutter = sh * settings.gutter / 100;
  const top = { sx, sy, sw, sh: Math.max(1, cut - gutter / 2) };
  const bottomStart = cut + gutter / 2;
  const bottom = { sx, sy: sy + bottomStart, sw, sh: Math.max(1, sh - bottomStart) };
  return [top, bottom];
}

function blobOf(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível converter a página em imagem.')), 'image/jpeg', quality);
  });
}

async function addPage(out, source, rect, quality) {
  const factor = Math.min(1, quality.maxSide / Math.max(rect.sw, rect.sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.sw * factor));
  canvas.height = Math.max(1, Math.round(rect.sh * factor));

  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);

  const jpg = await blobOf(canvas, quality.jpeg);
  const image = await out.embedJpg(await jpg.arrayBuffer());
  const ratio = canvas.width / canvas.height;
  const width = ratio <= 1 ? 842 * ratio : 842;
  const height = ratio <= 1 ? 842 : 842 / ratio;
  out.addPage([width, height]).drawImage(image, { x:0, y:0, width, height });
}

function progress(done, total, label) {
  ui.bar.style.width = `${Math.round(done / total * 100)}%`;
  ui.text.textContent = label;
}

async function saveResult(bytes, name) {
  const blob = new Blob([bytes], { type:'application/pdf' });
  const generatedFile = new File([blob], name, { type:'application/pdf' });

  if (navigator.share && navigator.canShare?.({ files:[generatedFile] })) {
    try {
      await navigator.share({ files:[generatedFile], title:name });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      console.warn('Compartilhamento indisponível; usando download.', error);
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return 'downloaded';
}

async function exportPdf() {
  if (!pdf || !file) return;

  ui.start.disabled = true;
  ui.cancel.disabled = true;
  ui.wrap.classList.remove('hidden');
  ui.note.textContent = 'Gerando o novo PDF no seu aparelho…';

  try {
    const settings = prefs();
    const splitRules = rules();
    const rotate = rotation();
    const quality = qualityConfig();
    const out = await PDFDocument.create();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      progress(pageNumber - 1, pdf.numPages, `Processando ${pageNumber} de ${pdf.numPages} · ${quality.label}`);
      await new Promise(requestAnimationFrame);

      const page = await pdf.getPage(pageNumber);
      const mode = modeAt(pageNumber, splitRules);
      const initialViewport = page.getViewport({ scale:1, rotation:(page.rotate + rotate) % 360 });

      let split = mode === 'split' || (mode === 'auto' && settings.split && (!settings.autoLandscape || initialViewport.width > initialViewport.height * 1.08));
      if (mode === 'whole') split = false;

      const axis = initialViewport.width > initialViewport.height * 1.08
        ? 'vertical'
        : (initialViewport.height > initialViewport.width * 1.28 ? 'horizontal' : 'vertical');

      const viewport = page.getViewport({ scale:quality.renderScale, rotation:(page.rotate + rotate) % 360 });
      const source = document.createElement('canvas');
      source.width = Math.floor(viewport.width);
      source.height = Math.floor(viewport.height);
      const context = source.getContext('2d', { alpha:false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, source.width, source.height);
      await page.render({ canvasContext:context, viewport }).promise;

      for (const rect of rects(source, split, axis, settings)) {
        await addPage(out, source, rect, quality);
      }
    }

    progress(pdf.numPages, pdf.numPages, 'Finalizando o arquivo…');
    const bytes = await out.save({ useObjectStreams:true });
    const name = safeName(ui.name.value);
    const result = await saveResult(bytes, name);

    if (result === 'cancelled') {
      ui.note.textContent = 'O PDF foi gerado, mas o salvamento foi cancelado. Toque em “Gerar e salvar” para tentar novamente.';
      progress(pdf.numPages, pdf.numPages, 'PDF pronto');
    } else {
      progress(pdf.numPages, pdf.numPages, 'Pronto');
      ui.note.textContent = `Arquivo pronto: ${name}`;
      setTimeout(close, 900);
    }
  } catch (error) {
    console.error(error);
    ui.note.textContent = 'Não foi possível gerar o PDF. Em arquivos muito grandes, feche outros apps e tente novamente com a qualidade padrão.';
  } finally {
    ui.start.disabled = false;
    ui.cancel.disabled = false;
  }
}

function open() {
  if (!pdf) return;
  ui.name.value = safeName(ui.name.value || `${baseName(file.name)} - leitura.pdf`);
  ui.wrap.classList.add('hidden');
  ui.bar.style.width = '0%';
  ui.text.textContent = '';
  ui.note.textContent = 'O novo PDF aplicará seus pontos de divisão, corte de lombada, margens e rotação. Como a exportação é visual, uma camada OCR do original pode não ser preservada.';
  ui.modal.classList.remove('hidden');
  setTimeout(() => ui.name.select(), 80);
}

function close() {
  ui.modal.classList.add('hidden');
}

ui.btn.disabled = true;
ui.btn.addEventListener('click', open);
ui.cancel.addEventListener('click', close);
ui.start.addEventListener('click', exportPdf);
ui.modal.addEventListener('click', event => {
  if (event.target === ui.modal && !ui.start.disabled) close();
});
ui.name.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !ui.start.disabled) exportPdf();
});

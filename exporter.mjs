function safeName(value) {
  let name = (value || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  if (!name) name = 'leitura-ajustada';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
function qualityConfig(value) {
  return value === 'high' ? { scale: 2.6, maxSide: 3400, jpeg: .93 } : { scale: 1.8, maxSide: 2200, jpeg: .86 };
}
function exportRects(canvas, split, axis, prefs) {
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
async function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao converter página.')), 'image/jpeg', quality));
}
async function appendPdfPage(out, source, rect, quality) {
  const factor = Math.min(1, quality.maxSide / Math.max(rect.sw, rect.sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.sw * factor)); canvas.height = Math.max(1, Math.round(rect.sh * factor));
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
export async function exportAdjustedPdf({ pdf, outputName, prefs, rotationAt, splitAt, axisForViewport, quality = 'standard', onProgress = () => {} }) {
  const { PDFDocument } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
  const config = qualityConfig(quality), out = await PDFDocument.create();
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(Math.round((n - 1) / pdf.numPages * 100), `Processando ${n} de ${pdf.numPages}`);
    await new Promise(requestAnimationFrame);
    const page = await pdf.getPage(n), rotation = rotationAt(n), viewport = page.getViewport({ scale: config.scale, rotation: ((page.rotate || 0) + rotation) % 360 });
    const source = document.createElement('canvas'); source.width = Math.floor(viewport.width); source.height = Math.floor(viewport.height);
    const ctx = source.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, source.width, source.height); await page.render({ canvasContext: ctx, viewport }).promise;
    const split = splitAt(n), axis = split ? axisForViewport(viewport) : null;
    for (const rect of exportRects(source, split, axis, prefs)) await appendPdfPage(out, source, rect, config);
  }
  onProgress(100, 'Finalizando…');
  const name = safeName(outputName);
  await saveGenerated(await out.save({ useObjectStreams: true }), name);
  return name;
}

import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const $ = id => document.getElementById(id);
const ui = { inputs: [$('fileInput'), $('fileInputBig')], btn: $('exportBtn'), modal: $('exportModal'), name: $('exportName'), cancel: $('exportCancelBtn'), start: $('exportStartBtn'), wrap: $('exportProgressWrap'), bar: $('exportProgressBar'), text: $('exportProgressText'), note: $('exportNote') };
let file = null, pdf = null, fileKey = null;

function safeName(v) {
  let n = (v || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  if (!n) n = 'leitura-ajustada';
  return /\.pdf$/i.test(n) ? n : n + '.pdf';
}
function baseName(n) { return (n || 'arquivo').replace(/\.pdf$/i, ''); }
function prefs() {
  const d = { split:false, autoLandscape:true, splitAt:50, gutter:1, crop:false, cropPct:3, rtl:false };
  try { return Object.assign(d, JSON.parse(localStorage.getItem('leitorAcademicoPrefs') || '{}')); } catch (_) { return d; }
}
function rotation() {
  try { return ((JSON.parse(localStorage.getItem(`leitor-pos:${fileKey}`) || '{}').rotation || 0) % 360 + 360) % 360; } catch (_) { return 0; }
}
function rules() {
  try {
    const a = JSON.parse(localStorage.getItem(`leitor-split-rules:${fileKey}`) || '[]');
    return Array.isArray(a) ? a.sort((x,y) => x.page-y.page) : [];
  } catch (_) { return []; }
}
function modeAt(page, rs) {
  let mode = 'auto';
  for (const r of rs) { if (r.page > page) break; if (['split','whole','auto'].includes(r.mode)) mode = r.mode; }
  return mode;
}
async function prepare(f) {
  if (!f) return;
  try {
    file = f; fileKey = `${f.name}:${f.size}:${f.lastModified}`;
    pdf = await pdfjsLib.getDocument({ data:new Uint8Array(await f.arrayBuffer()) }).promise;
    ui.btn.disabled = false;
    ui.name.value = `${baseName(f.name)} - leitura.pdf`;
  } catch (e) { console.error(e); pdf = null; ui.btn.disabled = true; }
}
ui.inputs.forEach(i => i?.addEventListener('change', e => prepare(e.target.files?.[0])));

function rects(canvas, split, axis, p) {
  let sx=0, sy=0, sw=canvas.width, sh=canvas.height;
  const c = p.crop ? p.cropPct/100 : 0, cx=sw*c, cy=sh*c;
  sx += cx; sy += cy; sw -= cx*2; sh -= cy*2;
  if (!split) return [{sx,sy,sw,sh}];
  if (axis === 'vertical') {
    const cut=sw*p.splitAt/100, g=sw*p.gutter/100;
    const left={sx,sy,sw:Math.max(1,cut-g/2),sh};
    const rs=cut+g/2, right={sx:sx+rs,sy,sw:Math.max(1,sw-rs),sh};
    return p.rtl ? [right,left] : [left,right];
  }
  const cut=sh*p.splitAt/100, g=sh*p.gutter/100;
  const top={sx,sy,sw,sh:Math.max(1,cut-g/2)};
  const bs=cut+g/2, bottom={sx,sy:sy+bs,sw,sh:Math.max(1,sh-bs)};
  return [top,bottom];
}
function blobOf(canvas) { return new Promise((res,rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Imagem')), 'image/jpeg', .88)); }
async function addPage(out, source, r) {
  const max=2400, f=Math.min(1,max/Math.max(r.sw,r.sh));
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(r.sw*f)); c.height=Math.max(1,Math.round(r.sh*f));
  const x=c.getContext('2d',{alpha:false}); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(source,r.sx,r.sy,r.sw,r.sh,0,0,c.width,c.height);
  const img=await out.embedJpg(await (await blobOf(c)).arrayBuffer()), ratio=c.width/c.height;
  const w=ratio<=1 ? 842*ratio : 842, h=ratio<=1 ? 842 : 842/ratio;
  out.addPage([w,h]).drawImage(img,{x:0,y:0,width:w,height:h});
}
function progress(done,total,label) { ui.bar.style.width=`${Math.round(done/total*100)}%`; ui.text.textContent=label; }

async function exportPdf() {
  if (!pdf || !file) return;
  ui.start.disabled=true; ui.cancel.disabled=true; ui.wrap.classList.remove('hidden'); ui.note.textContent='Gerando o novo PDF no seu aparelho…';
  try {
    const p=prefs(), rs=rules(), rot=rotation(), out=await PDFDocument.create();
    for (let n=1;n<=pdf.numPages;n++) {
      progress(n-1,pdf.numPages,`Processando ${n} de ${pdf.numPages}…`); await new Promise(requestAnimationFrame);
      const page=await pdf.getPage(n), mode=modeAt(n,rs), vp0=page.getViewport({scale:1,rotation:(page.rotate+rot)%360});
      let split = mode==='split' || (mode==='auto' && p.split && (!p.autoLandscape || vp0.width>vp0.height*1.08));
      if (mode==='whole') split=false;
      let axis=vp0.width>vp0.height*1.08 ? 'vertical' : (vp0.height>vp0.width*1.28 ? 'horizontal' : 'vertical');
      const vp=page.getViewport({scale:1.8,rotation:(page.rotate+rot)%360}), source=document.createElement('canvas');
      source.width=Math.floor(vp.width); source.height=Math.floor(vp.height);
      const ctx=source.getContext('2d',{alpha:false}); ctx.fillStyle='#fff'; ctx.fillRect(0,0,source.width,source.height); await page.render({canvasContext:ctx,viewport:vp}).promise;
      for (const r of rects(source,split,axis,p)) await addPage(out,source,r);
    }
    const bytes=await out.save({useObjectStreams:true}), name=safeName(ui.name.value), url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),120000);
    progress(pdf.numPages,pdf.numPages,'Pronto'); ui.note.textContent=`Arquivo gerado: ${name}`; setTimeout(close,900);
  } catch(e) { console.error(e); ui.note.textContent='Não foi possível gerar o PDF. Em arquivo muito grande, feche outros apps e tente novamente.'; }
  finally { ui.start.disabled=false; ui.cancel.disabled=false; }
}
function open() {
  if (!pdf) return; ui.name.value=safeName(ui.name.value || `${baseName(file.name)} - leitura.pdf`); ui.wrap.classList.add('hidden'); ui.bar.style.width='0%'; ui.text.textContent='';
  ui.note.textContent='O novo PDF aplicará seus pontos de divisão, corte de lombada, margens e rotação. A exportação visual pode não preservar a camada OCR do original.'; ui.modal.classList.remove('hidden'); setTimeout(()=>ui.name.select(),50);
}
function close() { ui.modal.classList.add('hidden'); }
ui.btn.disabled=true; ui.btn.addEventListener('click',open); ui.cancel.addEventListener('click',close); ui.start.addEventListener('click',exportPdf); ui.modal.addEventListener('click',e=>{if(e.target===ui.modal&&!ui.start.disabled)close();}); ui.name.addEventListener('keydown',e=>{if(e.key==='Enter'&&!ui.start.disabled)exportPdf();});

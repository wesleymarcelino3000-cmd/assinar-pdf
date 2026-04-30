pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const pdfInput = $('pdfInput'), pdfInfo = $('pdfInfo'), docTitle = $('docTitle'), pageStatus = $('pageStatus');
const pdfCanvas = $('pdfCanvas'), viewer = $('viewer'), signatureLayer = $('signatureLayer');
const sigPad = $('signaturePad'), sigName = $('signatureName'), savedBox = $('savedSignatures');
const ctx = sigPad.getContext('2d'), toast = $('toast');

let pdfBytes = null, pdfDoc = null, currentPage = 1, scale = 1.35;
let selectedSignature = null, placed = [], drawing = false, last = null, deferredPrompt = null;

function showToast(msg){ toast.textContent = msg; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 2600); }
function storage(){ return JSON.parse(localStorage.getItem('pdfSignaturesPro') || '[]'); }
function saveStorage(items){ localStorage.setItem('pdfSignaturesPro', JSON.stringify(items)); }
function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random(); }

function setupPad(){
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,sigPad.width,sigPad.height);
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}
function padPoint(e){
  const r = sigPad.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e;
  return { x:(p.clientX-r.left)*(sigPad.width/r.width), y:(p.clientY-r.top)*(sigPad.height/r.height) };
}
function startDraw(e){ e.preventDefault(); drawing=true; last=padPoint(e); }
function moveDraw(e){ if(!drawing) return; e.preventDefault(); const p=padPoint(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; }
function endDraw(){ drawing=false; last=null; }

sigPad.addEventListener('mousedown', startDraw); sigPad.addEventListener('mousemove', moveDraw); window.addEventListener('mouseup', endDraw);
sigPad.addEventListener('touchstart', startDraw, {passive:false}); sigPad.addEventListener('touchmove', moveDraw, {passive:false}); sigPad.addEventListener('touchend', endDraw);
$('clearSignature').onclick = () => { setupPad(); showToast('Assinatura limpa.'); };
$('saveSignature').onclick = () => {
  const dataUrl = sigPad.toDataURL('image/png');
  const items = storage(); const name = sigName.value.trim() || `Assinatura ${items.length + 1}`;
  items.unshift({ id: uuid(), name, dataUrl, createdAt: new Date().toISOString() }); saveStorage(items);
  sigName.value = ''; setupPad(); renderSignatures(); showToast('Assinatura salva.');
};

function renderSignatures(){
  const items = storage(); savedBox.innerHTML = '';
  if(!items.length){ savedBox.innerHTML = '<p class="hint">Nenhuma assinatura salva ainda.</p>'; return; }
  items.forEach(item => {
    const el = document.createElement('div'); el.className = 'sig-item' + (selectedSignature?.id === item.id ? ' active' : '');
    el.innerHTML = `<div><div class="sig-name">${item.name}</div><img src="${item.dataUrl}" alt="${item.name}"></div><button class="btn small danger">Excluir</button>`;
    el.querySelector('img').onclick = () => { selectedSignature = item; renderSignatures(); showToast('Clique no PDF para posicionar.'); };
    el.querySelector('button').onclick = () => { saveStorage(items.filter(s=>s.id!==item.id)); if(selectedSignature?.id===item.id) selectedSignature=null; renderSignatures(); };
    savedBox.appendChild(el);
  });
}

pdfInput.onchange = async (e) => {
  const file = e.target.files[0]; if(!file) return;
  pdfBytes = await file.arrayBuffer(); pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  currentPage = 1; placed = []; docTitle.textContent = file.name; pdfInfo.textContent = `${file.name} • ${pdfDoc.numPages} página(s)`;
  await renderPage(); showToast('PDF carregado.');
};

async function renderPage(){
  if(!pdfDoc) return; const page = await pdfDoc.getPage(currentPage); const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1; pdfCanvas.width = viewport.width * dpr; pdfCanvas.height = viewport.height * dpr;
  pdfCanvas.style.width = viewport.width + 'px'; pdfCanvas.style.height = viewport.height + 'px';
  const c = pdfCanvas.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0);
  await page.render({ canvasContext:c, viewport }).promise;
  pdfCanvas.style.display = 'block'; document.querySelector('.empty-state')?.remove();
  signatureLayer.style.width = viewport.width + 'px'; signatureLayer.style.height = viewport.height + 'px';
  pageStatus.textContent = `Página ${currentPage} de ${pdfDoc.numPages}`; redrawPlaced();
}
$('prevPage').onclick = async()=>{ if(pdfDoc && currentPage>1){ currentPage--; await renderPage(); } };
$('nextPage').onclick = async()=>{ if(pdfDoc && currentPage<pdfDoc.numPages){ currentPage++; await renderPage(); } };

viewer.addEventListener('click', e => {
  if(!pdfDoc || !selectedSignature || e.target.closest('.placed-signature')) return;
  const r = signatureLayer.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top;
  placed.push({ id:uuid(), page:currentPage, dataUrl:selectedSignature.dataUrl, x, y, w:180, h:70 }); redrawPlaced();
});
function redrawPlaced(){
  signatureLayer.innerHTML = '';
  placed.filter(p=>p.page===currentPage).forEach(p=>{
    const el = document.createElement('div'); el.className='placed-signature'; el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=p.w+'px'; el.style.height=p.h+'px';
    el.innerHTML = `<img src="${p.dataUrl}"><button class="remove">×</button>`;
    el.querySelector('.remove').onclick = ev => { ev.stopPropagation(); placed = placed.filter(x=>x.id!==p.id); redrawPlaced(); };
    makeDraggable(el,p); signatureLayer.appendChild(el);
  });
}
function makeDraggable(el,p){
  let active=false, ox=0, oy=0;
  el.addEventListener('pointerdown', e=>{ if(e.target.className==='remove') return; active=true; ox=e.clientX-p.x; oy=e.clientY-p.y; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e=>{ if(!active) return; const r=signatureLayer.getBoundingClientRect(); p.x=Math.max(0,Math.min(e.clientX-ox,r.width-el.offsetWidth)); p.y=Math.max(0,Math.min(e.clientY-oy,r.height-el.offsetHeight)); p.w=el.offsetWidth; p.h=el.offsetHeight; el.style.left=p.x+'px'; el.style.top=p.y+'px'; });
  el.addEventListener('pointerup', ()=>{ active=false; p.w=el.offsetWidth; p.h=el.offsetHeight; });
}

$('downloadPdf').onclick = async () => {
  if(!pdfBytes) return showToast('Importe um PDF primeiro.');
  if(!placed.length) return showToast('Posicione pelo menos uma assinatura.');
  const pdf = await PDFLib.PDFDocument.load(pdfBytes.slice(0)); const pages = pdf.getPages();
  for(const p of placed){
    const png = await pdf.embedPng(p.dataUrl); const page = pages[p.page-1]; const { width, height } = page.getSize();
    const canvasW = parseFloat(pdfCanvas.style.width), canvasH = parseFloat(pdfCanvas.style.height);
    const x = (p.x / canvasW) * width; const y = height - ((p.y + p.h) / canvasH) * height;
    page.drawImage(png, { x, y, width:(p.w/canvasW)*width, height:(p.h/canvasH)*height });
  }
  const out = await pdf.save(); const blob = new Blob([out], {type:'application/pdf'}); const a=document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'pdf-assinado.pdf'; a.click(); URL.revokeObjectURL(a.href); showToast('PDF assinado baixado.');
};
$('resetAll').onclick = () => { pdfBytes=null; pdfDoc=null; placed=[]; currentPage=1; location.reload(); };

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('installBtn').classList.remove('hidden'); });
$('installBtn').onclick = async () => { if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('installBtn').classList.add('hidden'); };
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js')); }

setupPad(); renderSignatures();

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const pdfInput = $('pdfInput');
const pdfInfo = $('pdfInfo');
const docTitle = $('docTitle');
const pageStatus = $('pageStatus');
const pdfCanvas = $('pdfCanvas');
const drawCanvas = $('drawCanvas');
const stampLayer = $('stampLayer');
const pdfStage = $('pdfStage');
const toast = $('toast');
const penTool = $('penTool');
const eraserTool = $('eraserTool');
const guideTool = $('guideTool');
const guideBox = $('guideBox');
const brushSize = $('brushSize');
const stampText = $('stampText');
const stampImageInput = $('stampImageInput');
const stampPreview = $('stampPreview');
const createStampBtn = $('createStamp');
const insertStampBtn = $('insertStamp');
const stampList = $('stampList');

let pdfBytes = null;
let pdfDoc = null;
let currentPage = 1;
let scale = window.innerWidth <= 760 ? 1.12 : 1.35;
let tool = 'none';
let guidedMode = false;
let drawing = false;
let activeStroke = null;
let deferredPrompt = null;
let originalFileName = 'pdf-assinado.pdf';
let movingGuide = false;
let resizingGuide = false;
let guideStart = null;
let guideRect = { x: .12, y: .72, w: .76, h: .14 };
let currentStampImage = '';
let selectedStampId = null;
let movingStamp = null;
let resizingStamp = null;
let stampStart = null;

const strokesByPage = {};
const stamps = loadSavedStamps();
const placedStampsByPage = {};
const pageViewports = new Map();

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('show'), 2600);
}

function safeId() { return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function loadSavedStamps() {
  try { return JSON.parse(localStorage.getItem('pdfSignProStamps') || '[]'); }
  catch { return []; }
}
function saveStamps() { localStorage.setItem('pdfSignProStamps', JSON.stringify(stamps)); }

function setTool(nextTool) {
  tool = tool === nextTool ? 'none' : nextTool;
  penTool.classList.toggle('active-tool', tool === 'pen');
  eraserTool.classList.toggle('active-tool', tool === 'eraser');
  drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
  drawCanvas.classList.toggle('pen-enabled', tool !== 'none');
  showToast(tool === 'none' ? 'Caneta desativada. O PDF está protegido contra toque acidental.' : (tool === 'pen' ? 'Caneta ativada.' : 'Borracha ativada.'));
}

function setGuidedMode(force) {
  guidedMode = typeof force === 'boolean' ? force : !guidedMode;
  guideTool.classList.toggle('active-tool', guidedMode);
  guideBox.classList.toggle('hidden', !guidedMode || !pdfDoc);
  positionGuideBox();
  showToast(guidedMode ? 'Assinatura guiada ativada. Arraste a caixa para o local certo.' : 'Assinatura guiada desativada.');
}

penTool.onclick = () => setTool('pen');
eraserTool.onclick = () => setTool('eraser');
guideTool.onclick = () => {
  if (!pdfDoc) return showToast('Importe um PDF primeiro.');
  setGuidedMode();
};

pdfInput.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pdfBytes = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  currentPage = 1;
  originalFileName = file.name.replace(/\.pdf$/i, '') + '-assinado.pdf';
  Object.keys(strokesByPage).forEach((key) => delete strokesByPage[key]);
  Object.keys(placedStampsByPage).forEach((key) => delete placedStampsByPage[key]);
  pageViewports.clear();
  docTitle.textContent = file.name;
  pdfInfo.textContent = `${file.name} • ${pdfDoc.numPages} página(s)`;
  await renderPage();
  showToast('PDF carregado. Ative a caneta antes de assinar.');
};

async function renderPage() {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale });
  pageViewports.set(currentPage, { width: viewport.width, height: viewport.height });

  const dpr = window.devicePixelRatio || 1;
  pdfCanvas.width = Math.round(viewport.width * dpr);
  pdfCanvas.height = Math.round(viewport.height * dpr);
  pdfCanvas.style.width = viewport.width + 'px';
  pdfCanvas.style.height = viewport.height + 'px';

  drawCanvas.width = Math.round(viewport.width * dpr);
  drawCanvas.height = Math.round(viewport.height * dpr);
  drawCanvas.style.width = viewport.width + 'px';
  drawCanvas.style.height = viewport.height + 'px';

  pdfStage.style.width = viewport.width + 'px';
  pdfStage.style.height = viewport.height + 'px';
  pdfStage.style.display = 'block';
  pdfCanvas.style.display = 'block';
  drawCanvas.style.display = 'block';
  stampLayer.style.display = 'block';

  const ctx = pdfCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  document.querySelector('.empty-state')?.remove();
  pageStatus.textContent = `Página ${currentPage} de ${pdfDoc.numPages}`;
  guideBox.classList.toggle('hidden', !guidedMode);
  positionGuideBox();
  redrawCurrentPage();
  renderPlacedStamps();
}

function getCanvasRect() { return drawCanvas.getBoundingClientRect(); }
function getPoint(e) {
  const r = getCanvasRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}
function inGuide(p) {
  return !guidedMode || (p.x >= guideRect.x && p.x <= guideRect.x + guideRect.w && p.y >= guideRect.y && p.y <= guideRect.y + guideRect.h);
}
function getCurrentBrushWidthNorm() {
  const r = getCanvasRect();
  const px = Number(brushSize.value || 2);
  return px / Math.max(1, r.width);
}

function startStroke(e) {
  if (!pdfDoc) return;
  if (tool === 'none') return;
  const p = getPoint(e);
  if (!inGuide(p)) return showToast('Assine dentro da área guiada.');
  e.preventDefault();
  drawCanvas.setPointerCapture?.(e.pointerId);
  drawing = true;
  activeStroke = { tool, widthNorm: tool === 'eraser' ? getCurrentBrushWidthNorm() * 3.1 : getCurrentBrushWidthNorm(), points: [p] };
  if (!strokesByPage[currentPage]) strokesByPage[currentPage] = [];
  strokesByPage[currentPage].push(activeStroke);
  redrawCurrentPage();
}
function moveStroke(e) {
  if (!drawing || !activeStroke) return;
  e.preventDefault();
  const p = getPoint(e);
  if (guidedMode && !inGuide(p)) return;
  activeStroke.points.push(p);
  redrawCurrentPage();
}
function endStroke(e) {
  if (!drawing) return;
  e?.preventDefault?.();
  drawing = false;
  activeStroke = null;
}

drawCanvas.addEventListener('pointerdown', startStroke, { passive: false });
drawCanvas.addEventListener('pointermove', moveStroke, { passive: false });
drawCanvas.addEventListener('pointerup', endStroke, { passive: false });
drawCanvas.addEventListener('pointercancel', endStroke, { passive: false });
drawCanvas.addEventListener('pointerleave', endStroke, { passive: false });

function positionGuideBox() {
  if (!pdfDoc || !guideBox) return;
  const r = getCanvasRect();
  guideBox.style.left = (guideRect.x * r.width) + 'px';
  guideBox.style.top = (guideRect.y * r.height) + 'px';
  guideBox.style.width = (guideRect.w * r.width) + 'px';
  guideBox.style.height = (guideRect.h * r.height) + 'px';
}

guideBox.addEventListener('pointerdown', (e) => {
  if (!guidedMode) return;
  e.preventDefault();
  guideBox.setPointerCapture?.(e.pointerId);
  resizingGuide = e.target.tagName === 'B';
  movingGuide = !resizingGuide;
  guideStart = { x: e.clientX, y: e.clientY, ...guideRect };
}, { passive: false });
window.addEventListener('pointermove', (e) => {
  if (movingStamp || resizingStamp) return moveOrResizeStamp(e);
  if (!movingGuide && !resizingGuide) return;
  e.preventDefault();
  const r = getCanvasRect();
  const dx = (e.clientX - guideStart.x) / r.width;
  const dy = (e.clientY - guideStart.y) / r.height;
  if (movingGuide) {
    guideRect.x = Math.max(0, Math.min(1 - guideStart.w, guideStart.x + dx));
    guideRect.y = Math.max(0, Math.min(1 - guideStart.h, guideStart.y + dy));
  } else {
    guideRect.w = Math.max(.22, Math.min(1 - guideStart.x, guideStart.w + dx));
    guideRect.h = Math.max(.07, Math.min(1 - guideStart.y, guideStart.h + dy));
  }
  positionGuideBox();
}, { passive: false });
window.addEventListener('pointerup', () => { movingGuide = false; resizingGuide = false; guideStart = null; movingStamp = null; resizingStamp = null; stampStart = null; renderPlacedStamps(); });
window.addEventListener('pointercancel', () => { movingStamp = null; resizingStamp = null; stampStart = null; });

function drawStrokeOnCanvas(ctx, stroke, width, height) {
  const pts = stroke.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, stroke.widthNorm * width);
  if (stroke.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#020617'; }
  ctx.beginPath();
  ctx.moveTo(pts[0].x * width, pts[0].y * height);
  if (pts.length === 1) ctx.lineTo(pts[0].x * width + 0.1, pts[0].y * height + 0.1);
  else {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]; const cur = pts[i];
      ctx.quadraticCurveTo(prev.x * width, prev.y * height, ((prev.x + cur.x) / 2) * width, ((prev.y + cur.y) / 2) * height);
    }
    const last = pts[pts.length - 1]; ctx.lineTo(last.x * width, last.y * height);
  }
  ctx.stroke(); ctx.restore();
}
function redrawCurrentPage() {
  const dpr = window.devicePixelRatio || 1;
  const w = drawCanvas.width, h = drawCanvas.height;
  const ctx = drawCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  for (const stroke of (strokesByPage[currentPage] || [])) drawStrokeOnCanvas(ctx, stroke, w, h);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function buildStampHtml(stamp, mini = false) {
  const img = stamp.image ? `<img src="${stamp.image}" alt="Imagem do carimbo">` : '';
  const text = stamp.text ? `<span class="stamp-text">${escapeHtml(stamp.text)}</span>` : '';
  return `<div class="stamp-card ${mini ? 'stamp-mini' : ''}">${img}${text}</div>`;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}
function updateStampPreview() {
  const text = stampText.value.trim();
  if (!text && !currentStampImage) {
    stampPreview.className = 'stamp-preview empty';
    stampPreview.textContent = 'Prévia do carimbo';
    return;
  }
  stampPreview.className = 'stamp-preview';
  stampPreview.innerHTML = buildStampHtml({ text, image: currentStampImage });
}
function renderStampList() {
  stampList.innerHTML = '';
  if (!stamps.length) {
    stampList.innerHTML = '<p class="hint">Nenhum carimbo criado ainda.</p>';
    return;
  }
  stamps.forEach((stamp) => {
    const item = document.createElement('div');
    item.className = 'stamp-list-item' + (stamp.id === selectedStampId ? ' active' : '');
    item.innerHTML = `<div>${buildStampHtml(stamp, true)}</div><button class="btn small ghost" data-use="${stamp.id}">Usar</button><button class="btn small danger" data-del="${stamp.id}">Excluir</button>`;
    stampList.appendChild(item);
  });
  stampList.querySelectorAll('[data-use]').forEach((btn) => btn.onclick = () => { selectedStampId = btn.dataset.use; renderStampList(); showToast('Carimbo selecionado. Clique em Adicionar no PDF.'); });
  stampList.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => {
    const idx = stamps.findIndex((s) => s.id === btn.dataset.del);
    if (idx >= 0) stamps.splice(idx, 1);
    if (selectedStampId === btn.dataset.del) selectedStampId = stamps[0]?.id || null;
    saveStamps(); renderStampList(); showToast('Carimbo excluído.');
  });
}

stampText.addEventListener('input', updateStampPreview);
stampImageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { currentStampImage = reader.result; updateStampPreview(); showToast('Imagem adicionada ao carimbo.'); };
  reader.readAsDataURL(file);
});
createStampBtn.onclick = () => {
  const text = stampText.value.trim();
  if (!text && !currentStampImage) return showToast('Digite um texto ou adicione uma imagem no carimbo.');
  const stamp = { id: safeId(), text, image: currentStampImage, createdAt: Date.now() };
  stamps.unshift(stamp);
  selectedStampId = stamp.id;
  saveStamps(); renderStampList();
  stampText.value = ''; currentStampImage = ''; stampImageInput.value = ''; updateStampPreview();
  showToast('Carimbo criado e salvo.');
};
insertStampBtn.onclick = () => {
  if (!pdfDoc) return showToast('Importe um PDF primeiro.');
  const stamp = stamps.find((s) => s.id === selectedStampId) || stamps[0];
  if (!stamp) return showToast('Crie um carimbo primeiro.');
  if (!placedStampsByPage[currentPage]) placedStampsByPage[currentPage] = [];
  placedStampsByPage[currentPage].push({ id: safeId(), stampId: stamp.id, x: .18, y: .72, w: .34, h: .10 });
  renderPlacedStamps();
  showToast('Carimbo adicionado. Arraste e redimensione livremente.');
};

function getPlacedStamp(pageNum, id) { return (placedStampsByPage[pageNum] || []).find((s) => s.id === id); }
function renderPlacedStamps() {
  stampLayer.innerHTML = '';
  if (!pdfDoc) return;
  const r = getCanvasRect();
  (placedStampsByPage[currentPage] || []).forEach((placed) => {
    const stamp = stamps.find((s) => s.id === placed.stampId);
    if (!stamp) return;
    const el = document.createElement('div');
    el.className = 'placed-stamp';
    el.dataset.id = placed.id;
    el.style.left = (placed.x * r.width) + 'px';
    el.style.top = (placed.y * r.height) + 'px';
    el.style.width = (placed.w * r.width) + 'px';
    el.style.height = (placed.h * r.height) + 'px';
    el.innerHTML = buildStampHtml(stamp) + '<button class="remove" title="Remover">×</button><i class="resize-handle"></i>';
    stampLayer.appendChild(el);
  });
  stampLayer.querySelectorAll('.placed-stamp').forEach((el) => {
    el.addEventListener('pointerdown', startMoveStamp, { passive: false });
    el.querySelector('.remove').onclick = (ev) => { ev.stopPropagation(); removePlacedStamp(el.dataset.id); };
  });
}
function removePlacedStamp(id) {
  const list = placedStampsByPage[currentPage] || [];
  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0) list.splice(idx, 1);
  renderPlacedStamps(); showToast('Carimbo removido.');
}
function startMoveStamp(e) {
  if (!pdfDoc) return;
  const box = e.currentTarget;
  if (e.target.classList.contains('remove')) return;
  e.preventDefault();
  box.setPointerCapture?.(e.pointerId);
  const placed = getPlacedStamp(currentPage, box.dataset.id);
  if (!placed) return;
  resizingStamp = e.target.classList.contains('resize-handle') ? placed.id : null;
  movingStamp = resizingStamp ? null : placed.id;
  stampStart = { x: e.clientX, y: e.clientY, ...placed };
  box.classList.add('editing');
}
function moveOrResizeStamp(e) {
  if (!stampStart) return;
  e.preventDefault();
  const r = getCanvasRect();
  const id = movingStamp || resizingStamp;
  const placed = getPlacedStamp(currentPage, id);
  if (!placed) return;
  const dx = (e.clientX - stampStart.x) / r.width;
  const dy = (e.clientY - stampStart.y) / r.height;
  if (movingStamp) {
    placed.x = Math.max(0, Math.min(1 - stampStart.w, stampStart.x + dx));
    placed.y = Math.max(0, Math.min(1 - stampStart.h, stampStart.y + dy));
  } else {
    placed.w = Math.max(.14, Math.min(1 - stampStart.x, stampStart.w + dx));
    placed.h = Math.max(.055, Math.min(1 - stampStart.y, stampStart.h + dy));
  }
  const el = stampLayer.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.style.left = (placed.x * r.width) + 'px';
    el.style.top = (placed.y * r.height) + 'px';
    el.style.width = (placed.w * r.width) + 'px';
    el.style.height = (placed.h * r.height) + 'px';
    el.classList.add('editing');
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
async function drawStampOnCanvas(ctx, stamp, placed, width, height) {
  const x = placed.x * width, y = placed.y * height, w = placed.w * width, h = placed.h * height;
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.max(8, w * .035));
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fill();
  ctx.lineWidth = Math.max(2, w * .012);
  ctx.strokeStyle = '#0f172a';
  ctx.stroke();
  const pad = Math.max(6, w * .045);
  let textX = x + pad;
  if (stamp.image) {
    try {
      const img = await loadImage(stamp.image);
      if (img) {
        const imgMaxW = stamp.text ? w * .34 : w - pad * 2;
        const imgMaxH = h - pad * 2;
        const ratio = Math.min(imgMaxW / img.width, imgMaxH / img.height);
        const iw = img.width * ratio, ih = img.height * ratio;
        ctx.drawImage(img, x + pad, y + (h - ih) / 2, iw, ih);
        textX = x + pad + iw + pad;
      }
    } catch {}
  }
  if (stamp.text) {
    ctx.fillStyle = '#0f172a';
    ctx.textBaseline = 'middle';
    ctx.textAlign = stamp.image ? 'left' : 'center';
    ctx.font = `900 ${Math.max(9, Math.min(h * .36, w * .09))}px Arial, sans-serif`;
    const text = stamp.text.toUpperCase();
    const maxW = stamp.image ? Math.max(20, x + w - pad - textX) : w - pad * 2;
    const tx = stamp.image ? textX : x + w / 2;
    ctx.fillText(text, tx, y + h / 2, maxW);
  }
  ctx.restore();
}

$('undoStroke').onclick = () => { const strokes = strokesByPage[currentPage] || []; if (!strokes.length) return showToast('Nada para desfazer nesta página.'); strokes.pop(); redrawCurrentPage(); showToast('Último traço desfeito.'); };
$('clearPage').onclick = () => { if (!pdfDoc) return showToast('Importe um PDF primeiro.'); strokesByPage[currentPage] = []; placedStampsByPage[currentPage] = []; redrawCurrentPage(); renderPlacedStamps(); showToast('Assinaturas e carimbos desta página apagados.'); };
$('prevPage').onclick = async () => { if (pdfDoc && currentPage > 1) { currentPage--; await renderPage(); } };
$('nextPage').onclick = async () => { if (pdfDoc && currentPage < pdfDoc.numPages) { currentPage++; await renderPage(); } };
$('lastPage').onclick = async () => { if (!pdfDoc) return showToast('Importe um PDF primeiro.'); if (currentPage === pdfDoc.numPages) return showToast('Você já está na última página.'); currentPage = pdfDoc.numPages; await renderPage(); showToast('Última página aberta.'); };

function pageHasContent() {
  const hasStrokes = Object.values(strokesByPage).some((strokes) => strokes && strokes.length);
  const hasStamps = Object.values(placedStampsByPage).some((items) => items && items.length);
  return hasStrokes || hasStamps;
}
async function renderOverlayForPage(pageNumber, width, height) {
  const canvas = document.createElement('canvas');
  const multiplier = 2;
  canvas.width = Math.round(width * multiplier);
  canvas.height = Math.round(height * multiplier);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of (strokesByPage[pageNumber] || [])) drawStrokeOnCanvas(ctx, stroke, canvas.width, canvas.height);
  for (const placed of (placedStampsByPage[pageNumber] || [])) {
    const stamp = stamps.find((s) => s.id === placed.stampId);
    if (stamp) await drawStampOnCanvas(ctx, stamp, placed, canvas.width, canvas.height);
  }
  return canvas;
}
$('downloadPdf').onclick = async () => {
  if (!pdfBytes) return showToast('Importe um PDF primeiro.');
  if (!pageHasContent()) return showToast('Assine ou adicione um carimbo antes de baixar.');
  const pdf = await PDFLib.PDFDocument.load(pdfBytes.slice(0));
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const strokes = strokesByPage[pageNumber] || [];
    const pageStamps = placedStampsByPage[pageNumber] || [];
    if (!strokes.length && !pageStamps.length) continue;
    const page = pages[i];
    const { width, height } = page.getSize();
    const overlayCanvas = await renderOverlayForPage(pageNumber, width, height);
    const pngDataUrl = overlayCanvas.toDataURL('image/png');
    const png = await pdf.embedPng(pngDataUrl);
    page.drawImage(png, { x: 0, y: 0, width, height });
  }
  const out = await pdf.save();
  const blob = new Blob([out], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = originalFileName;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('PDF assinado baixado.');
};
$('resetAll').onclick = () => location.reload();

window.addEventListener('resize', () => { positionGuideBox(); renderPlacedStamps(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('installBtn').classList.remove('hidden'); });
$('installBtn').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('installBtn').classList.add('hidden'); };
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));

updateStampPreview();
renderStampList();

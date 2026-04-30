pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const pdfInput = $('pdfInput');
const pdfInfo = $('pdfInfo');
const docTitle = $('docTitle');
const pageStatus = $('pageStatus');
const pdfCanvas = $('pdfCanvas');
const drawCanvas = $('drawCanvas');
const pdfStage = $('pdfStage');
const toast = $('toast');
const penTool = $('penTool');
const eraserTool = $('eraserTool');
const guideTool = $('guideTool');
const guideBox = $('guideBox');
const brushSize = $('brushSize');

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

const strokesByPage = {};
const pageViewports = new Map();

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('show'), 2600);
}

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

  const ctx = pdfCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  document.querySelector('.empty-state')?.remove();
  pageStatus.textContent = `Página ${currentPage} de ${pdfDoc.numPages}`;
  guideBox.classList.toggle('hidden', !guidedMode);
  positionGuideBox();
  redrawCurrentPage();
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
window.addEventListener('pointerup', () => { movingGuide = false; resizingGuide = false; guideStart = null; });

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

$('undoStroke').onclick = () => { const strokes = strokesByPage[currentPage] || []; if (!strokes.length) return showToast('Nada para desfazer nesta página.'); strokes.pop(); redrawCurrentPage(); showToast('Último traço desfeito.'); };
$('clearPage').onclick = () => { if (!pdfDoc) return showToast('Importe um PDF primeiro.'); strokesByPage[currentPage] = []; redrawCurrentPage(); showToast('Assinaturas desta página apagadas.'); };
$('prevPage').onclick = async () => { if (pdfDoc && currentPage > 1) { currentPage--; await renderPage(); } };
$('nextPage').onclick = async () => { if (pdfDoc && currentPage < pdfDoc.numPages) { currentPage++; await renderPage(); } };
$('lastPage').onclick = async () => { if (!pdfDoc) return showToast('Importe um PDF primeiro.'); if (currentPage === pdfDoc.numPages) return showToast('Você já está na última página.'); currentPage = pdfDoc.numPages; await renderPage(); showToast('Última página aberta.'); };

function pageHasStrokes() { return Object.values(strokesByPage).some((strokes) => strokes && strokes.length); }
function renderOverlayForPage(pageNumber, width, height) {
  const canvas = document.createElement('canvas');
  const multiplier = 2;
  canvas.width = Math.round(width * multiplier);
  canvas.height = Math.round(height * multiplier);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of (strokesByPage[pageNumber] || [])) drawStrokeOnCanvas(ctx, stroke, canvas.width, canvas.height);
  return canvas;
}
$('downloadPdf').onclick = async () => {
  if (!pdfBytes) return showToast('Importe um PDF primeiro.');
  if (!pageHasStrokes()) return showToast('Assine diretamente no PDF antes de baixar.');
  const pdf = await PDFLib.PDFDocument.load(pdfBytes.slice(0));
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const strokes = strokesByPage[pageNumber] || [];
    if (!strokes.length) continue;
    const page = pages[i];
    const { width, height } = page.getSize();
    const overlayCanvas = renderOverlayForPage(pageNumber, width, height);
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

window.addEventListener('resize', () => positionGuideBox());
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('installBtn').classList.remove('hidden'); });
$('installBtn').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('installBtn').classList.add('hidden'); };
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));

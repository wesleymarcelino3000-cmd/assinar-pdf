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
const brushSize = $('brushSize');

let pdfBytes = null;
let pdfDoc = null;
let currentPage = 1;
let scale = 1.35;
let tool = 'pen';
let drawing = false;
let activeStroke = null;
let deferredPrompt = null;
let originalFileName = 'pdf-assinado.pdf';

// Estrutura: { [pageNumber]: [ { tool, widthNorm, points:[{x,y}] } ] }
const strokesByPage = {};
const pageViewports = new Map();

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function setTool(nextTool) {
  tool = nextTool;
  penTool.classList.toggle('active-tool', tool === 'pen');
  eraserTool.classList.toggle('active-tool', tool === 'eraser');
  drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
  showToast(tool === 'pen' ? 'Caneta ativada.' : 'Borracha ativada.');
}

penTool.onclick = () => setTool('pen');
eraserTool.onclick = () => setTool('eraser');

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
  showToast('PDF carregado. Assine diretamente em cima do documento.');
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
  redrawCurrentPage();
}

function getPoint(e) {
  const r = drawCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}

function getCurrentBrushWidthNorm() {
  const r = drawCanvas.getBoundingClientRect();
  const px = Number(brushSize.value || 5);
  return px / Math.max(1, r.width);
}

function startStroke(e) {
  if (!pdfDoc) return;
  e.preventDefault();
  drawCanvas.setPointerCapture?.(e.pointerId);
  drawing = true;
  const p = getPoint(e);
  activeStroke = {
    tool,
    widthNorm: tool === 'eraser' ? getCurrentBrushWidthNorm() * 3.1 : getCurrentBrushWidthNorm(),
    points: [p],
  };
  if (!strokesByPage[currentPage]) strokesByPage[currentPage] = [];
  strokesByPage[currentPage].push(activeStroke);
  redrawCurrentPage();
}

function moveStroke(e) {
  if (!drawing || !activeStroke) return;
  e.preventDefault();
  activeStroke.points.push(getPoint(e));
  redrawCurrentPage();
}

function endStroke(e) {
  if (!drawing) return;
  e?.preventDefault?.();
  drawing = false;
  activeStroke = null;
}

drawCanvas.addEventListener('pointerdown', startStroke);
drawCanvas.addEventListener('pointermove', moveStroke);
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);
drawCanvas.addEventListener('pointerleave', endStroke);

function drawStrokeOnCanvas(ctx, stroke, width, height) {
  const pts = stroke.points;
  if (!pts || !pts.length) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, stroke.widthNorm * width);

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#020617';
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x * width, pts[0].y * height);
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x * width + 0.1, pts[0].y * height + 0.1);
  } else {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const midX = ((prev.x + cur.x) / 2) * width;
      const midY = ((prev.y + cur.y) / 2) * height;
      ctx.quadraticCurveTo(prev.x * width, prev.y * height, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x * width, last.y * height);
  }
  ctx.stroke();
  ctx.restore();
}

function redrawCurrentPage() {
  const dpr = window.devicePixelRatio || 1;
  const w = drawCanvas.width;
  const h = drawCanvas.height;
  const ctx = drawCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const strokes = strokesByPage[currentPage] || [];
  for (const stroke of strokes) {
    drawStrokeOnCanvas(ctx, stroke, w, h);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

$('undoStroke').onclick = () => {
  const strokes = strokesByPage[currentPage] || [];
  if (!strokes.length) return showToast('Nada para desfazer nesta página.');
  strokes.pop();
  redrawCurrentPage();
  showToast('Último traço desfeito.');
};

$('clearPage').onclick = () => {
  if (!pdfDoc) return showToast('Importe um PDF primeiro.');
  strokesByPage[currentPage] = [];
  redrawCurrentPage();
  showToast('Assinaturas desta página apagadas.');
};

$('prevPage').onclick = async () => {
  if (pdfDoc && currentPage > 1) {
    currentPage--;
    await renderPage();
  }
};

$('nextPage').onclick = async () => {
  if (pdfDoc && currentPage < pdfDoc.numPages) {
    currentPage++;
    await renderPage();
  }
};

$('lastPage').onclick = async () => {
  if (!pdfDoc) return showToast('Importe um PDF primeiro.');
  if (currentPage === pdfDoc.numPages) return showToast('Você já está na última página.');
  currentPage = pdfDoc.numPages;
  await renderPage();
  showToast('Última página aberta.');
};

function pageHasStrokes() {
  return Object.values(strokesByPage).some((strokes) => strokes && strokes.length);
}

function renderOverlayForPage(pageNumber, width, height) {
  const canvas = document.createElement('canvas');
  const multiplier = 2;
  canvas.width = Math.round(width * multiplier);
  canvas.height = Math.round(height * multiplier);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const strokes = strokesByPage[pageNumber] || [];
  for (const stroke of strokes) {
    drawStrokeOnCanvas(ctx, stroke, canvas.width, canvas.height);
  }
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

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBtn').classList.remove('hidden');
});

$('installBtn').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('installBtn').classList.add('hidden');
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

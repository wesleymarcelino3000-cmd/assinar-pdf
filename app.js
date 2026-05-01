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
const stampTool = $('stampTool');
const guideTool = $('guideTool');
const guideBox = $('guideBox');
const brushSize = $('brushSize');
const stampText = $('stampText');
const stampLine1 = $('stampLine1');
const stampLine2 = $('stampLine2');
const stampLine3 = $('stampLine3');
const stampFont = $('stampFont');
const stampCase = $('stampCase');
const stampImgSize = $('stampImgSize');
const stampImgX = $('stampImgX');
const stampImgY = $('stampImgY');
const stampTextSize = $('stampTextSize');
const stampLine1X = $('stampLine1X');
const stampLine1Y = $('stampLine1Y');
const stampLine2X = $('stampLine2X');
const stampLine2Y = $('stampLine2Y');
const stampLine3X = $('stampLine3X');
const stampLine3Y = $('stampLine3Y');
const stampImageInput = $('stampImageInput');
const stampPreview = $('stampPreview');
const stampShape = $('stampShape');
const stampTheme = $('stampTheme');
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
  if (stampTool) stampTool.classList.toggle('active-tool', tool === 'stamp');
  drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
  drawCanvas.classList.toggle('stamp-enabled', tool === 'stamp');
  drawCanvas.classList.toggle('pen-enabled', tool !== 'none');
  const msg = tool === 'none' ? 'Ferramentas desativadas. O PDF está protegido contra toque acidental.' : (tool === 'pen' ? 'Caneta ativada.' : (tool === 'eraser' ? 'Borracha ativada.' : 'Carimbo ativado. Toque no PDF para aplicar.'));
  showToast(msg);
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
if (stampTool) stampTool.onclick = () => {
  if (!pdfDoc) return showToast('Importe um PDF primeiro.');
  const stamp = stamps.find((s) => s.id === selectedStampId) || stamps[0];
  if (!stamp) return showToast('Crie ou selecione um carimbo primeiro.');
  setTool('stamp');
};
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

function addStampAtPoint(p) {
  const stamp = stamps.find((s) => s.id === selectedStampId) || stamps[0];
  if (!stamp) { showToast('Crie ou selecione um carimbo primeiro.'); return; }
  if (!placedStampsByPage[currentPage]) placedStampsByPage[currentPage] = [];
  const w = 0.34, h = 0.10;
  placedStampsByPage[currentPage].push({ id: safeId(), stampId: stamp.id, x: Math.max(0, Math.min(1 - w, p.x - w / 2)), y: Math.max(0, Math.min(1 - h, p.y - h / 2)), w, h });
  renderPlacedStamps();
  showToast('Carimbo aplicado. Arraste ou redimensione se precisar.');
}

function startStroke(e) {
  if (!pdfDoc) return;
  if (tool === 'none') return;
  const p = getPoint(e);
  if (tool === 'stamp') { e.preventDefault(); addStampAtPoint(p); return; }
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
window.addEventListener('pointerup', () => {
  const hadStampAction = !!(movingStamp || resizingStamp);
  movingGuide = false; resizingGuide = false; guideStart = null;
  movingStamp = null; resizingStamp = null; stampStart = null;
  if (hadStampAction) renderPlacedStamps();
});
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

function getStampColors(theme = 'dark') {
  const themes = {
    dark: { ink: '#0f172a', bg: 'rgba(255,255,255,.94)', border: '#0f172a' },
    blue: { ink: '#1e3a8a', bg: 'rgba(239,246,255,.96)', border: '#1d4ed8' },
    green: { ink: '#166534', bg: 'rgba(240,253,244,.96)', border: '#16a34a' },
    red: { ink: '#991b1b', bg: 'rgba(254,242,242,.96)', border: '#dc2626' }
  };
  return themes[theme] || themes.dark;
}
function normalizeStampLine(text, mode) {
  const value = String(text || '').trim();
  if (mode === 'upper') return value.toUpperCase();
  if (mode === 'lower') return value.toLowerCase();
  return value;
}
function getStampConfigFromForm() {
  const legacy = stampText?.value?.trim() || '';
  const mode = stampCase?.value || 'upper';
  const lines = [
    { text: stampLine1?.value?.trim() || legacy, x: Number(stampLine1X?.value || 50), y: Number(stampLine1Y?.value || 56) },
    { text: stampLine2?.value?.trim() || '', x: Number(stampLine2X?.value || 50), y: Number(stampLine2Y?.value || 69) },
    { text: stampLine3?.value?.trim() || '', x: Number(stampLine3X?.value || 50), y: Number(stampLine3Y?.value || 82) }
  ].filter(l => l.text).map(l => ({ ...l, text: normalizeStampLine(l.text, mode) }));
  return {
    id: safeId(),
    text: lines.map(l => l.text).join('\n'),
    lines,
    image: currentStampImage,
    shape: stampShape?.value || 'real',
    theme: stampTheme?.value || 'dark',
    font: stampFont?.value || 'Arial',
    textCase: mode,
    textSize: Number(stampTextSize?.value || 10),
    imageSize: Number(stampImgSize?.value || 38),
    imageX: Number(stampImgX?.value || 50),
    imageY: Number(stampImgY?.value || 24),
    createdAt: Date.now()
  };
}
function getStampLines(stamp) {
  if (Array.isArray(stamp.lines) && stamp.lines.length) return stamp.lines;
  const mode = stamp.textCase || 'upper';
  return String(stamp.text || '').split(/\n|\s{2,}/).filter(Boolean).slice(0, 3).map((t, i) => ({
    text: normalizeStampLine(t, mode), x: 50, y: [56, 69, 82][i] || 82
  }));
}
function buildStampHtml(stamp, mini = false) {
  const colors = getStampColors(stamp.theme);
  const shape = stamp.shape || 'real';
  const bg = shape === 'outline' ? 'rgba(255,255,255,.72)' : colors.bg;
  const font = escapeHtml(stamp.font || 'Arial');
  const size = Number(stamp.textSize ?? 10);
  const imageSize = Number(stamp.imageSize ?? 38);
  const stampStyle = [
    '--stamp-ink:' + colors.ink,
    '--stamp-bg:' + bg,
    '--stamp-border:' + colors.border,
    '--stamp-text-size:' + size + 'px',
    '--stamp-image-size:' + imageSize + '%',
    '--stamp-font:' + font
  ].join(';') + ';';

  const imgStyle = [
    'left:' + Number(stamp.imageX ?? 50) + '%',
    'top:' + Number(stamp.imageY ?? 24) + '%',
    'width:' + imageSize + '%'
  ].join(';') + ';';
  const img = stamp.image ? '<img class="stamp-logo-free" src="' + stamp.image + '" alt="Imagem do carimbo" style="' + imgStyle + '">' : '';

  const lines = getStampLines(stamp).map((line, idx) => {
    const x = Number(line.x ?? 50);
    const y = Number(line.y ?? (56 + idx * 13));
    const lineStyle = [
      'left:' + x + '%',
      'top:' + y + '%',
      'font-family:"' + font + '", Arial, sans-serif',
      'font-size:' + size + 'px !important'
    ].join(';') + ';';
    return '<span class="stamp-line" style="' + lineStyle + '">' + escapeHtml(line.text) + '</span>';
  }).join('');

  return '<div class="stamp-card custom-stamp-layout ' + (mini ? 'stamp-mini' : '') + ' stamp-' + shape + '" style="' + stampStyle + '">' + img + lines + '</div>';
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function updateStampPreview() {
  const stamp = getStampConfigFromForm();
  if (!stamp.lines.length && !currentStampImage) {
    stampPreview.className = 'stamp-preview empty';
    stampPreview.textContent = 'Prévia do carimbo';
    return;
  }
  stampPreview.className = 'stamp-preview';
  stampPreview.innerHTML = buildStampHtml(stamp);
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
  stampList.querySelectorAll('[data-use]').forEach((btn) => btn.onclick = () => { selectedStampId = btn.dataset.use; renderStampList(); showToast('Carimbo selecionado. Ative o botão Carimbo para aplicar no PDF.'); });
  stampList.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => {
    const idx = stamps.findIndex((s) => s.id === btn.dataset.del);
    if (idx >= 0) stamps.splice(idx, 1);
    if (selectedStampId === btn.dataset.del) selectedStampId = stamps[0]?.id || null;
    saveStamps(); renderStampList(); showToast('Carimbo excluído.');
  });
}

[stampText, stampLine1, stampLine2, stampLine3, stampFont, stampCase, stampImgSize, stampImgX, stampImgY, stampTextSize, stampLine1X, stampLine1Y, stampLine2X, stampLine2Y, stampLine3X, stampLine3Y, stampShape, stampTheme].forEach((el) => {
  if (!el) return;
  el.addEventListener('input', updateStampPreview);
  el.addEventListener('change', updateStampPreview);
});
stampImageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { currentStampImage = reader.result; updateStampPreview(); showToast('Imagem adicionada ao carimbo.'); };
  reader.readAsDataURL(file);
});
createStampBtn.onclick = () => {
  const stamp = getStampConfigFromForm();
  if (!stamp.lines.length && !currentStampImage) return showToast('Digite um texto ou adicione uma imagem no carimbo.');
  stamps.unshift(stamp);
  selectedStampId = stamp.id;
  saveStamps(); renderStampList();
  if (stampText) stampText.value = '';
  [stampLine1, stampLine2, stampLine3].forEach(el => { if (el) el.value = ''; });
  currentStampImage = ''; stampImageInput.value = ''; updateStampPreview();
  showToast('Carimbo criado e salvo.');
};
insertStampBtn.onclick = () => {
  if (!pdfDoc) return showToast('Importe um PDF primeiro.');
  const stamp = stamps.find((s) => s.id === selectedStampId) || stamps[0];
  if (!stamp) return showToast('Crie um carimbo primeiro.');
  setTool('stamp');
  showToast('Carimbo ativado. Toque ou clique no PDF no local onde deseja aplicar.');
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
    const removeBtn = el.querySelector('.remove');
    const resizeHandle = el.querySelector('.resize-handle');

    el.addEventListener('pointerdown', startMoveStamp, { passive: false });

    if (removeBtn) {
      const removeNow = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        movingStamp = null;
        resizingStamp = null;
        stampStart = null;
        removePlacedStamp(el.dataset.id);
      };
      removeBtn.addEventListener('pointerdown', removeNow, { passive: false });
      removeBtn.addEventListener('click', removeNow, { passive: false });
    }

    if (resizeHandle) {
      resizeHandle.addEventListener('pointerdown', startMoveStamp, { passive: false });
    }
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
  const box = e.currentTarget.closest ? e.currentTarget.closest('.placed-stamp') : e.currentTarget;
  if (!box || e.target.closest?.('.remove')) return;
  e.preventDefault();
  e.stopPropagation();
  box.setPointerCapture?.(e.pointerId);
  const placed = getPlacedStamp(currentPage, box.dataset.id);
  if (!placed) return;
  resizingStamp = e.target.closest?.('.resize-handle') ? placed.id : null;
  movingStamp = resizingStamp ? null : placed.id;
  stampStart = { x: e.clientX, y: e.clientY, ...placed };
  stampLayer.querySelectorAll('.placed-stamp.editing').forEach((item) => item.classList.remove('editing'));
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
  const shape = stamp.shape || 'real';
  const colors = getStampColors(stamp.theme);
  const isReal = shape === 'real';
  ctx.save();

  const cx = x + w / 2, cy = y + h / 2;
  if (isReal) {
    ctx.translate(cx, cy);
    ctx.rotate(-0.007);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = .78;
    ctx.globalCompositeOperation = 'multiply';
  }

  const radius = shape === 'pill' ? h / 2 : Math.max(8, w * .035);
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = isReal ? 'rgba(255,255,255,0.02)' : (shape === 'outline' ? 'rgba(255,255,255,.70)' : colors.bg);
  ctx.fill();
  ctx.lineWidth = isReal ? Math.max(1.2, w * .010) : Math.max(2, w * .012);
  ctx.strokeStyle = colors.border;
  ctx.stroke();

  if (isReal || shape !== 'outline') {
    ctx.save();
    ctx.globalAlpha = isReal ? .62 : .10;
    roundRect(ctx, x + w * .04, y + h * .13, w * .92, h * .74, Math.max(5, radius * .68));
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = isReal ? Math.max(0.8, w * .005) : ctx.lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  const pad = Math.max(6, w * .055);

  if (stamp.image) {
    try {
      const img = await loadImage(stamp.image);
      if (img) {
        const targetW = w * ((stamp.imageSize ?? 38) / 100);
        const ratio = targetW / img.width;
        const iw = targetW;
        const ih = img.height * ratio;
        const ix = x + w * ((stamp.imageX ?? 50) / 100) - iw / 2;
        const iy = y + h * ((stamp.imageY ?? 24) / 100) - ih / 2;
        ctx.save();
        if (isReal) {
          ctx.globalAlpha = .64;
          ctx.filter = 'grayscale(1) contrast(1.35)';
        }
        ctx.drawImage(img, ix, iy, iw, ih);
        ctx.restore();
      }
    } catch {}
  }

  const lines = getStampLines(stamp);
  if (lines.length) {
    ctx.fillStyle = colors.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const fontSize = Math.max(5, Math.min(h * .34, w * .13, (stamp.textSize ?? 10) * (w / 180)));
    const fontFamily = stamp.font || 'Arial';
    ctx.font = (isReal ? '500 ' : '600 ') + fontSize + 'px "' + fontFamily + '", Arial, sans-serif';
    for (const line of lines) {
      const tx = x + w * ((line.x ?? 50) / 100);
      const ty = y + h * ((line.y ?? 65) / 100);
      ctx.fillText(String(line.text || ''), tx, ty, Math.max(10, w - pad * 2));
    }
  }

  if (isReal) {
    ctx.globalCompositeOperation = 'destination-out';
    const seed = Math.floor((placed.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    for (let i = 0; i < 42; i++) {
      const px = x + ((i * 37 + seed * 13) % 100) / 100 * w;
      const py = y + ((i * 53 + seed * 7) % 100) / 100 * h;
      const rw = Math.max(1, w * (.006 + ((i % 5) * .002)));
      const rh = Math.max(1, h * (.012 + ((i % 4) * .004)));
      ctx.globalAlpha = .09 + (i % 3) * .035;
      ctx.fillRect(px, py, rw, rh);
    }
    ctx.globalAlpha = .10;
    for (let i = 0; i < 9; i++) {
      const yy = y + ((i + 1) / 10) * h;
      ctx.fillRect(x + w * .05, yy, w * .90, Math.max(1, h * .006));
    }
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

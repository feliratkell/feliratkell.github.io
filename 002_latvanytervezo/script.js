/*****************************************************************
 * FELIRAT LÁTVÁNYTERVEZŐ – v1
 * - Fal háttér választó (assets/backgrounds/*)
 * - Anyag radio (birch / hdf) → textúra + gravír szín
 * - Felirat: input + sablon dropdown, drag, középre
 * - Ikonok: kattintással behúz, drag, kijelöl, töröl
 * - Nincs resize/rotate/flip
 * - PNG export + CSV export (valós cm arányból)
 *****************************************************************/

const CANVAS_CM_WIDTH = 31.0;   // tartjuk a bevált 310 mm arányt
const CANVAS_CM_HEIGHT = 22.5;  // 225 mm

// Anyag beállítások
const MATERIALS = {
  birch: {
    textureUrl: 'assets/textures/birch.png',
    engrave: '#8A6A3B' // barnás, csiszolt gravír
  },
  hdf: {
    textureUrl: 'assets/textures/hdf-white.png',
    engrave: '#2B2B2B' // sötétszürke/feketébb gravír
  }
};

// Fal hátterek (fix)
const WALLS = {
  white: 'assets/backgrounds/white.png',
  beige: 'assets/backgrounds/beige.png',
  gray:  'assets/backgrounds/gray.png',
  green: 'assets/backgrounds/green.png',
  pink:  'assets/backgrounds/pink.png'
};

// Állapot
let selectedItem = null;
let dragState = null;
let clipboard = null;

document.addEventListener('DOMContentLoaded', () => {
  initWall();
  initMaterial();
  initTitle();
  initIconPanel();
  initCategories();
  initSelectionAndShortcuts();
  initExport();
  initCsvExport();

  // induló
  applyWall('white');
  applyMaterial('birch');
  centerTitle();
  updateTitleSizeLabel();
});

/*****************************************************************
 * Segédek
 *****************************************************************/
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function getPointer(e) {
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function canvasRect() {
  return document.getElementById('canvas').getBoundingClientRect();
}

function pxPerCmY() {
  const r = canvasRect();
  return r.height / CANVAS_CM_HEIGHT;
}

function setSelected(el) {
  if (selectedItem) selectedItem.classList.remove('selected');
  selectedItem = el;
  if (selectedItem) selectedItem.classList.add('selected');
}

/*****************************************************************
 * Fal
 *****************************************************************/
function initWall() {
  const sel = document.getElementById('wall-select');
  sel.addEventListener('change', () => applyWall(sel.value));
}

function applyWall(key) {
  const wallLayer = document.getElementById('wall-layer');
  const url = WALLS[key] || WALLS.white;
  wallLayer.style.backgroundImage = `url("${url}")`;
}

/*****************************************************************
 * Anyag
 *****************************************************************/
function initMaterial() {
  document.querySelectorAll('input[name="material"]').forEach(r => {
    r.addEventListener('change', () => applyMaterial(r.value));
  });
}

function applyMaterial(matKey) {
  const canvas = document.getElementById('canvas');
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  canvas.style.setProperty('--mat-texture', `url("${mat.textureUrl}")`);
  canvas.style.setProperty('--engrave', mat.engrave);

  // SVG ikonok gravír szín frissítése
  document.querySelectorAll('#items-layer .icon-item').forEach(el => {
    applySvgEngraveColor(el, mat.engrave);
    el.dataset.material = matKey;
    el.dataset.engrave = mat.engrave;
  });

  // Felirat meta
  const title = document.getElementById('title-item');
  title.dataset.material = matKey;
  title.dataset.engrave = mat.engrave;
}

/*****************************************************************
 * Felirat
 *****************************************************************/
function initTitle() {
  const input = document.getElementById('title-input');
  const tpl = document.getElementById('template-select');
  const titleItem = document.getElementById('title-item');
  const titleText = document.getElementById('title-text');
  const centerBtn = document.getElementById('center-title-btn');

  // alap
  input.value = input.value || 'Felirat';
  titleText.textContent = input.value;

  tpl.addEventListener('change', () => {
    if (!tpl.value) return;
    input.value = tpl.value;
    titleText.textContent = tpl.value;
    updateTitleSizeLabel();
    // sablon után ne maradjon kiválasztva
    tpl.value = '';
  });

  input.addEventListener('input', () => {
    titleText.textContent = input.value || 'Felirat';
    updateTitleSizeLabel();
  });

  centerBtn.addEventListener('click', () => {
    centerTitle();
    updateTitleSizeLabel();
  });

  // drag
  makeDraggable(titleItem);

  // induló méret kb. 4 cm magasságra állítva
  requestAnimationFrame(() => fitTitleToCmHeight(4));
}

function centerTitle() {
  const canvas = document.getElementById('canvas');
  const title = document.getElementById('title-item');
  const rC = canvas.getBoundingClientRect();
  const rT = title.getBoundingClientRect();

  const left = (rC.width - rT.width) / 2;
  const top = (rC.height - rT.height) / 2;

  title.style.left = `${left}px`;
  title.style.top = `${top}px`;
  title.style.transform = 'none';
}

function fitTitleToCmHeight(cm) {
  const titleText = document.getElementById('title-text');
  const titleItem = document.getElementById('title-item');
  const ppcm = pxPerCmY();
  const targetPx = cm * ppcm;

  // kalibráció 100px fonton
  const prev = titleText.style.fontSize;
  titleText.style.fontSize = '100px';

  // mérés
  const h100 = titleItem.getBoundingClientRect().height || 100;
  const alpha = h100 / 100; // px magasság per 1px font

  const needed = targetPx / alpha;
  titleText.style.fontSize = `${clamp(needed, 14, 220)}px`;

  if (prev == null) titleText.style.fontSize = `${clamp(needed, 14, 220)}px`;

  updateTitleSizeLabel();
}

function updateTitleSizeLabel() {
  const canvas = document.getElementById('canvas');
  const title = document.getElementById('title-item');
  const out = document.getElementById('title-size');
  const rC = canvas.getBoundingClientRect();
  const rT = title.getBoundingClientRect();
  const cm = (rT.height / rC.height) * CANVAS_CM_HEIGHT;
  out.textContent = cm.toFixed(1);
}

/*****************************************************************
 * Ikon panel (kattintás → új ikon)
 *****************************************************************/
function initIconPanel() {
  document.querySelectorAll('.pattern-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const src = btn.dataset.src;
      const alt = btn.dataset.alt || 'Ikon';

      try {
        const svgText = await fetchSvg(src);
        addIcon(svgText, { src, alt });
      } catch (e) {
        console.error(e);
        alert('Nem sikerült betölteni az SVG-t: ' + src);
      }
    });
  });

  document.getElementById('delete-btn').addEventListener('click', () => {
    if (!selectedItem) return;
    // feliratot ne töröljük
    if (selectedItem.id === 'title-item') return;
    selectedItem.remove();
    setSelected(null);
  });
}

async function fetchSvg(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Fetch hiba: ' + url);
  return await res.text();
}

/**
 * Ikon hozzáadás:
 * - méret: SVG width/height alapján (mm/cm/px), ha nincs → 4 cm magas fallback
 * - nincs resize a usernek
 */
function addIcon(svgText, meta) {
  const itemsLayer = document.getElementById('items-layer');
  const canvas = document.getElementById('canvas');
  const matKey = document.querySelector('input[name="material"]:checked')?.value || 'birch';
  const engrave = (MATERIALS[matKey] || MATERIALS.birch).engrave;

  const el = document.createElement('div');
  el.className = 'item icon-item';
  el.innerHTML = svgText;

  el.dataset.src = meta.src || '';
  el.dataset.alt = meta.alt || '';
  el.dataset.material = matKey;
  el.dataset.engrave = engrave;

  // méret meghatározás
  const svg = el.querySelector('svg');
  const ppcm = pxPerCmY();

  const size = computeSvgSizePx(svg, ppcm);
  el.style.width = `${size.w}px`;
  el.style.height = `${size.h}px`;

  // középre
  const rC = canvas.getBoundingClientRect();
  const left = (rC.width - size.w) / 2;
  const top = (rC.height - size.h) / 2;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  // szín (gravír)
  applySvgEngraveColor(el, engrave);

  itemsLayer.appendChild(el);

  makeDraggable(el);
  setSelected(el);
}

function computeSvgSizePx(svg, pxPerCm) {
  // fallback: 4 cm magas, viewBox arányból szélesség
  const fallbackH = 4 * pxPerCm;
  let aspect = 1;

  const vb = svg?.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[3] > 0) aspect = parts[2] / parts[3];
  }

  // ha van width/height attribútum, próbáljuk értelmezni
  const wAttr = svg?.getAttribute('width') || '';
  const hAttr = svg?.getAttribute('height') || '';

  const w = parseSvgLenToPx(wAttr, pxPerCm);
  const h = parseSvgLenToPx(hAttr, pxPerCm);

  if (w > 0 && h > 0) return { w, h };

  if (h > 0) return { w: h * aspect, h };
  if (w > 0) return { w, h: w / aspect };

  return { w: fallbackH * aspect, h: fallbackH };
}

function parseSvgLenToPx(val, pxPerCm) {
  if (!val) return 0;
  const s = String(val).trim().toLowerCase();

  // px
  if (s.endsWith('px')) {
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  // mm / cm
  if (s.endsWith('mm')) {
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    const cm = n / 10;
    return cm * pxPerCm;
  }
  if (s.endsWith('cm')) {
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return n * pxPerCm;
  }

  // unit nélküli számot px-nek vesszük
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function applySvgEngraveColor(containerEl, color) {
  const svg = containerEl.querySelector('svg');
  if (!svg) return;

  // gyors és stabil: minden alakzat fill/stroke színét felülírjuk, kivéve fill="none"
  const targets = svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line');
  targets.forEach(n => {
    const fill = n.getAttribute('fill');
    if (fill !== 'none') {
      n.setAttribute('fill', color);
      n.style.fill = color;
    }
    const stroke = n.getAttribute('stroke');
    if (stroke && stroke !== 'none') {
      n.setAttribute('stroke', color);
      n.style.stroke = color;
    }
  });

  // ha valahol style tagban van hardcode fill, minimálisan korrigáljuk
  const styleTag = svg.querySelector('style');
  if (styleTag && styleTag.textContent) {
    styleTag.textContent = styleTag.textContent.replace(
      /fill:\s*#[0-9a-fA-F]{3,8}/g,
      `fill:${color}`
    );
    styleTag.textContent = styleTag.textContent.replace(
      /stroke:\s*#[0-9a-fA-F]{3,8}/g,
      `stroke:${color}`
    );
  }
}

/*****************************************************************
 * Drag (touch + mouse)
 *****************************************************************/
function makeDraggable(el) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSelected(el);
    startDrag(e, el);
  });

  el.addEventListener('touchstart', (e) => {
    e.preventDefault();
    setSelected(el);
    startDrag(e, el);
  }, { passive: false });
}

function startDrag(e, el) {
  const p = getPointer(e);
  const cR = canvasRect();
  const r = el.getBoundingClientRect();

  // fixáljuk a transformot (feliratnál is)
  const left = r.left - cR.left;
  const top = r.top - cR.top;
  el.style.transform = 'none';
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  dragState = {
    el,
    cR,
    offsetX: p.x - r.left,
    offsetY: p.y - r.top
  };
}

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  onDragMove(e);
});

document.addEventListener('touchmove', (e) => {
  if (!dragState) return;
  onDragMove(e);
  e.preventDefault();
}, { passive: false });

document.addEventListener('mouseup', () => { dragState = null; });
document.addEventListener('touchend', () => { dragState = null; });

function onDragMove(e) {
  const p = getPointer(e);
  const { el, cR, offsetX, offsetY } = dragState;

  const w = el.offsetWidth;
  const h = el.offsetHeight;

  let left = p.x - cR.left - offsetX;
  let top = p.y - cR.top - offsetY;

  left = clamp(left, 0, cR.width - w);
  top = clamp(top, 0, cR.height - h);

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  if (el.id === 'title-item') updateTitleSizeLabel();
}

/*****************************************************************
 * Kategóriák (összecsukás)
 *****************************************************************/
function initCategories() {
  document.querySelectorAll('.pattern-category').forEach(cat => {
    cat.classList.add('collapsed');
    const header = cat.querySelector('.pattern-category-header');
    if (!header) return;
    header.addEventListener('click', () => cat.classList.toggle('collapsed'));
  });
}

/*****************************************************************
 * Kijelölés, törlés, copy/paste
 *****************************************************************/
function initSelectionAndShortcuts() {
  // üres területre kattintva kijelölés le
  document.getElementById('canvas').addEventListener('mousedown', (e) => {
    const hit = e.target.closest('.item');
    if (!hit) setSelected(null);
  });

  document.getElementById('canvas').addEventListener('touchstart', (e) => {
    const hit = e.target.closest?.('.item');
    if (!hit) setSelected(null);
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItem) {
      if (selectedItem.id !== 'title-item') {
        e.preventDefault();
        selectedItem.remove();
        setSelected(null);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedItem) {
      e.preventDefault();
      clipboard = serializeItem(selectedItem);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard) {
      e.preventDefault();
      pasteItem(clipboard);
      return;
    }
  });
}

function serializeItem(el) {
  const canvas = document.getElementById('canvas');
  const cR = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();

  const base = {
    type: el.id === 'title-item' ? 'title' : 'icon',
    left: (r.left - cR.left) + 20,
    top: (r.top - cR.top) + 20,
    w: el.offsetWidth,
    h: el.offsetHeight,
    material: el.dataset.material || 'birch',
    engrave: el.dataset.engrave || MATERIALS.birch.engrave
  };

  if (base.type === 'title') {
    base.text = document.getElementById('title-input').value || 'Felirat';
    base.fontSize = parseFloat(getComputedStyle(document.getElementById('title-text')).fontSize) || 96;
  } else {
    base.svg = el.querySelector('svg')?.outerHTML || '';
    base.src = el.dataset.src || '';
    base.alt = el.dataset.alt || 'Ikon';
  }

  return base;
}

function pasteItem(data) {
  if (data.type === 'title') {
    // felirat duplikálást nem erőltetjük, inkább csak kijelöljük és középre nem rakjuk
    setSelected(document.getElementById('title-item'));
    return;
  }

  const itemsLayer = document.getElementById('items-layer');
  const el = document.createElement('div');
  el.className = 'item icon-item';
  el.innerHTML = data.svg;

  el.style.width = `${data.w}px`;
  el.style.height = `${data.h}px`;
  el.style.left = `${clamp(data.left, 0, canvasRect().width - data.w)}px`;
  el.style.top = `${clamp(data.top, 0, canvasRect().height - data.h)}px`;

  el.dataset.src = data.src || '';
  el.dataset.alt = data.alt || 'Ikon';
  el.dataset.material = data.material || 'birch';
  el.dataset.engrave = data.engrave || MATERIALS.birch.engrave;

  // aktuális anyag gravír színével egységesítünk (globális!)
  const matKey = document.querySelector('input[name="material"]:checked')?.value || 'birch';
  const engrave = (MATERIALS[matKey] || MATERIALS.birch).engrave;
  applySvgEngraveColor(el, engrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);
}

/*****************************************************************
 * PNG export
 *****************************************************************/
function initExport() {
  const btn = document.getElementById('export-btn');
  const canvasEl = document.getElementById('canvas');

  btn.addEventListener('click', async () => {
    const prev = selectedItem;
    if (prev) prev.classList.remove('selected');

    document.body.classList.add('exporting');

    try {
      const shot = await html2canvas(canvasEl, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false
      });

      const a = document.createElement('a');
      a.href = shot.toDataURL('image/png');
      a.download = 'felirat_latvanyterv.png';
      a.click();
    } catch (e) {
      console.error(e);
      alert('Hiba történt a PNG export során.');
    } finally {
      document.body.classList.remove('exporting');
      if (prev) prev.classList.add('selected');
    }
  });
}

/*****************************************************************
 * CSV export
 *****************************************************************/
function initCsvExport() {
  const btn = document.getElementById('export-csv-btn');
  btn.addEventListener('click', () => exportCsv());
}

function exportCsv() {
  const canvas = document.getElementById('canvas');
  const cR = canvas.getBoundingClientRect();

  const pxToCmX = CANVAS_CM_WIDTH / cR.width;
  const pxToCmY = CANVAS_CM_HEIGHT / cR.height;

  const matKey = document.querySelector('input[name="material"]:checked')?.value || 'birch';
  const engrave = (MATERIALS[matKey] || MATERIALS.birch).engrave;

  const rows = [];
  rows.push('Típus;Név;Szélesség (cm);Magasság (cm);Anyag;Gravír szín');

  // Felirat
  const titleItem = document.getElementById('title-item');
  const tR = titleItem.getBoundingClientRect();
  const titleText = document.getElementById('title-input').value || 'Felirat';
  rows.push([
    'Felirat',
    csvEsc(titleText),
    ((tR.width * pxToCmX).toFixed(2)).replace('.', ','),
    ((tR.height * pxToCmY).toFixed(2)).replace('.', ','),
    matKey,
    engrave
  ].join(';'));

  // Ikonok
  const icons = document.querySelectorAll('#items-layer .icon-item');
  icons.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const name = el.dataset.alt || `Ikon ${idx + 1}`;
    rows.push([
      'Ikon',
      csvEsc(name),
      ((r.width * pxToCmX).toFixed(2)).replace('.', ','),
      ((r.height * pxToCmY).toFixed(2)).replace('.', ','),
      matKey,
      engrave
    ].join(';'));
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'felirat_meretek.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEsc(t) {
  const s = String(t ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

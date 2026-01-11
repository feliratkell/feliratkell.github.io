/*****************************************************************
 * FELIRAT LÁTVÁNYTERVEZŐ – DOM háttér + SVG felirat + SVG ikon
 * - Referencia: KOMÓD magasság = 70 cm (falanként mentve)
 * - Háttér: fix PNG (div background-image), nincs canvas, nincs maszkolás
 * - Zoom: 1×–3× (slider), Pan csak zoom>1, clamp a viewporton belül
 * - Felirat: SVG text + texture/solid (anyag), Enter engedett
 * - Ikonok: fetch SVG, gravír színezés anyagtól függően
 * - Export: html2canvas, kalibráció/kijelölés rejtve, exportnál zoom/pan reset
 *****************************************************************/

const CABINET_HEIGHT_CM = 70;

// Felirat betűmagasság (cm) – UI slider 3–11
let titleLetterCm = 11.0;

// Ikon alap magasság (cm)
const ICON_BASE_CM = 12.0;

// Anyag preset
const MATERIALS = {
  birch: {
    titleMode: "texture",
    titleTextureUrl: "assets/textures/birch.png",
    engrave: "#7A4A1E",      // nyír gravír: barnás, nem szürke
    iconOpacity: 0.85,
    iconShadow: "rgba(0,0,0,0.20)"
  },
  hdf: {
    titleMode: "solid",
    titleSolid: "#ffffff",   // fehér HDF felirat anyag
    titleTextureUrl: "assets/textures/hdf-white.png",
    engrave: "#2B2B2B",      // HDF gravír: sötétszürke, nem fekete
    iconOpacity: 0.90,
    iconShadow: "rgba(0,0,0,0.22)"
  }
};

// Falak
const WALLS = {
  white: "assets/backgrounds/white.png",
  beige: "assets/backgrounds/beige.png",
  gray:  "assets/backgrounds/gray.png",
  green: "assets/backgrounds/green.png",
  pink:  "assets/backgrounds/pink.png"
};

let selectedItem = null;
let dragState = null;
let clipboard = null;

let activeWallKey = "white";
let calibrating = false;
let calibDrag = null;

let zoom = 1;
let pan = { x: 0, y: 0 };
let panDrag = null;

document.addEventListener("DOMContentLoaded", async () => {
  initWall();
  initZoom();
  initMaterial();
  initTitle();
  initTitleSizeRange();
  initIconPanel();
  initCategories();
  initSelectionAndShortcuts();
  initExport();
  initCsvExport();
  initCalibration();
  initPanOnEmptyWall();

  applyWall("white");
  applyMaterial(getMaterialKey());

  // Font betöltés megvárása → stabil bbox/size
  await safeLoadFont("AlwaysInMyHeart");

  syncScaleUi();
  syncTitleLetterUi();
  applyTitleLetterSize();
  syncTitleSvgPaint();
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

function viewportEl() { return document.getElementById("canvas-viewport"); }
function canvasEl() { return document.getElementById("canvas"); }

function setSelected(el) {
  if (selectedItem) selectedItem.classList.remove("selected");
  selectedItem = el;
  if (selectedItem) selectedItem.classList.add("selected");
}

function getTitleTextRaw() {
  const el = document.getElementById("title-input");
  return (el?.value ?? "").replace(/\r\n/g, "\n");
}

function getMaterialKey() {
  return document.querySelector('input[name="material"]:checked')?.value || "birch";
}

async function safeLoadFont(fontFamily) {
  try {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.race([
      document.fonts.load(`16px "${fontFamily}"`),
      new Promise(resolve => setTimeout(resolve, 1200))
    ]);
  } catch (_) {}
}

/*****************************************************************
 * Skála (px/cm) – háttérképenként mentve
 *****************************************************************/
function storageKeyForWall(wallKey) {
  return `felirat_scale_ppcm__${wallKey}`;
}

function getPxPerCm() {
  const raw = localStorage.getItem(storageKeyForWall(activeWallKey));
  const n = raw ? Number(raw) : NaN;
  if (!isFinite(n) || n <= 0) {
    // óvatos default, hogy ne legyen óriás
    const vp = viewportEl();
    const h = vp ? vp.clientHeight : 600;
    return h / 220;
  }
  return n;
}

function setPxPerCm(ppcm) {
  localStorage.setItem(storageKeyForWall(activeWallKey), String(ppcm));
}

function syncScaleUi() {
  const out = document.getElementById("scale-out");
  if (!out) return;
  out.textContent = getPxPerCm().toFixed(2);
}

/*****************************************************************
 * Fal
 *****************************************************************/
function initWall() {
  const sel = document.getElementById("wall-select");
  if (!sel) return;
  sel.addEventListener("change", () => applyWall(sel.value));
}

function applyWall(key) {
  activeWallKey = key || "white";

  const wallLayer = document.getElementById("wall-layer");
  if (!wallLayer) return;

  wallLayer.style.backgroundImage = `url("${WALLS[activeWallKey] || WALLS.white}")`;

  syncScaleUi();
  applyTitleLetterSize();
  syncTitleSvgPaint();
  updateTitleSizeLabel();

  clampPanToBounds();
  applyZoomTransform();
}

/*****************************************************************
 * Zoom + Pan
 *****************************************************************/
function initZoom() {
  const range = document.getElementById("zoom-range");
  const out = document.getElementById("zoom-out");
  const resetBtn = document.getElementById("zoom-reset-btn");

  function setZoom(z) {
    zoom = clamp(Number(z) || 1, 1, 3);
    if (range) range.value = String(zoom);
    if (out) out.textContent = zoom.toFixed(1);

    if (zoom <= 1.01) pan = { x: 0, y: 0 }; // zoom=1 → nincs pan
    clampPanToBounds();
    applyZoomTransform();
  }

  if (range) range.addEventListener("input", () => setZoom(range.value));
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      pan = { x: 0, y: 0 };
      setZoom(1);
    });
  }

  setZoom(1);
}

function applyZoomTransform() {
  const c = canvasEl();
  if (!c) return;
  c.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
}

function clampPanToBounds() {
  const vp = viewportEl();
  if (!vp) return;

  const vpW = vp.clientWidth;
  const vpH = vp.clientHeight;

  // A canvas alapmérete = vp méret (inset:0)
  // zoomnál a “túllógás” mértéke: vp*(zoom-1)
  const scaledW = vpW * zoom;
  const scaledH = vpH * zoom;

  const minX = Math.min(0, vpW - scaledW);
  const minY = Math.min(0, vpH - scaledH);
  const maxX = 0;
  const maxY = 0;

  pan.x = clamp(pan.x, minX, maxX);
  pan.y = clamp(pan.y, minY, maxY);
}

function initPanOnEmptyWall() {
  const vp = viewportEl();
  if (!vp) return;

  vp.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;

    // csak ha üres falon fogod meg (ne itemen)
    const hit = e.target.closest?.(".item");
    if (hit) return;
    if (calibrating) return;
    if (zoom <= 1.01) return;

    e.preventDefault();
    const p = getPointer(e);
    panDrag = { startX: p.x, startY: p.y, baseX: pan.x, baseY: pan.y };
  });

  vp.addEventListener("mousemove", (e) => {
    if (!panDrag) return;
    const p = getPointer(e);
    pan.x = panDrag.baseX + (p.x - panDrag.startX);
    pan.y = panDrag.baseY + (p.y - panDrag.startY);
    clampPanToBounds();
    applyZoomTransform();
  });

  window.addEventListener("mouseup", () => { panDrag = null; });

  vp.addEventListener("touchstart", (e) => {
    const hit = e.target.closest?.(".item");
    if (hit) return;
    if (calibrating) return;
    if (zoom <= 1.01) return;

    const p = getPointer(e);
    panDrag = { startX: p.x, startY: p.y, baseX: pan.x, baseY: pan.y };
  }, { passive: true });

  vp.addEventListener("touchmove", (e) => {
    if (!panDrag) return;
    const p = getPointer(e);
    pan.x = panDrag.baseX + (p.x - panDrag.startX);
    pan.y = panDrag.baseY + (p.y - panDrag.startY);
    clampPanToBounds();
    applyZoomTransform();
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("touchend", () => { panDrag = null; });
}

/*****************************************************************
 * Anyag
 *****************************************************************/
function initMaterial() {
  document.querySelectorAll('input[name="material"]').forEach(r => {
    r.addEventListener("change", () => applyMaterial(r.value));
  });
}

function applyMaterial(matKey) {
  const c = canvasEl();
  if (!c) return;

  const mat = MATERIALS[matKey] || MATERIALS.birch;

  // ikon gravír
  c.style.setProperty("--engrave", mat.engrave);
  c.style.setProperty("--engrave-opacity", String(mat.iconOpacity));
  c.style.setProperty("--engrave-shadow", mat.iconShadow);

  // felirat (SVG paint)
  syncTitleSvgPaint();

  // ikonok átszínezése
  document.querySelectorAll("#items-layer .icon-item").forEach(el => {
    applySvgEngraveColor(el, mat.engrave);
    el.dataset.material = matKey;
    el.dataset.engrave = mat.engrave;
  });

  const title = document.getElementById("title-item");
  if (title) title.dataset.material = matKey;
}

/*****************************************************************
 * Felirat betűmagasság (3–11 cm)
 *****************************************************************/
function initTitleSizeRange() {
  const range = document.getElementById("title-size-range");
  if (!range) return;

  const v = Number(range.value);
  if (isFinite(v)) titleLetterCm = clamp(v, 3, 11);

  range.addEventListener("input", () => {
    const n = clamp(Number(range.value) || 11, 3, 11);
    titleLetterCm = n;
    syncTitleLetterUi();
    applyTitleLetterSize();
    syncTitleSvgPaint();
    updateTitleSizeLabel();
  });
}

function syncTitleLetterUi() {
  const out = document.getElementById("title-letter-cm-out");
  const range = document.getElementById("title-size-range");
  if (range) range.value = String(titleLetterCm);
  if (out) out.textContent = titleLetterCm.toFixed(1);
}

/*****************************************************************
 * Felirat (SVG TEXT + ENTER)
 *****************************************************************/
function initTitle() {
  const input = document.getElementById("title-input");
  const tpl = document.getElementById("template-select");
  const titleItem = document.getElementById("title-item");
  const centerBtn = document.getElementById("center-title-btn");

  if (!input || !titleItem) return;

  if (!input.value) input.value = "Felirat";
  setTitleSvgText(normalizeEllipsisSpacing(input.value));

  if (tpl) {
    tpl.addEventListener("change", () => {
      if (!tpl.value) return;
      input.value = tpl.value;
      setTitleSvgText(normalizeEllipsisSpacing(tpl.value));
      tpl.value = "";
      applyTitleLetterSize();
      syncTitleSvgPaint();
      updateTitleSizeLabel();
    });
  }

  input.addEventListener("input", () => {
    setTitleSvgText(normalizeEllipsisSpacing(getTitleTextRaw() || "Felirat"));
    applyTitleLetterSize();
    syncTitleSvgPaint();
    updateTitleSizeLabel();
  });

  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      centerTitle();
      updateTitleSizeLabel();
    });
  }

  makeDraggable(titleItem);

  requestAnimationFrame(() => {
    applyTitleLetterSize();
    syncTitleSvgPaint();
    updateTitleSizeLabel();
  });
}

// „.../… ” előtti szóköz szépítése
function normalizeEllipsisSpacing(text) {
  const s = String(text || "");
  return s
    .replace(/(\S)(\.\.\.|…)/g, "$1 $2")
    .replace(/\s+(…)/g, " $1")
    .replace(/\s+(\.\.\.)/g, " $1");
}

function setTitleSvgText(text) {
  const t = document.getElementById("title-svg-text");
  if (!t) return;

  const lines = String(text || "Felirat").replace(/\r\n/g, "\n").split("\n");
  while (t.firstChild) t.removeChild(t.firstChild);

  lines.forEach((line, i) => {
    const tsp = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tsp.setAttribute("x", "50%");
    tsp.setAttribute("dy", i === 0 ? "0" : "1.05em");
    tsp.textContent = line.length ? line : " ";
    t.appendChild(tsp);
  });
}

function applyTitleLetterSize() {
  const text = document.getElementById("title-svg-text");
  if (!text) return;

  const ppcm = getPxPerCm();
  const fontPx = titleLetterCm * ppcm;

  text.style.fontFamily = `"AlwaysInMyHeart", system-ui, -apple-system, "Segoe UI", sans-serif`;
  text.style.fontSize = `${clamp(fontPx, 10, 600)}px`;

  requestAnimationFrame(() => fitTitleSvgToText());
}

function fitTitleSvgToText() {
  const svg = document.getElementById("title-svg");
  const text = document.getElementById("title-svg-text");
  if (!svg || !text) return;

  let bb;
  try {
    bb = text.getBBox();
  } catch (_) {
    requestAnimationFrame(() => fitTitleSvgToText());
    return;
  }

  const pad = 6;
  const w = Math.max(10, bb.width + pad * 2);
  const h = Math.max(10, bb.height + pad * 2);

  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  text.setAttribute("x", String(w / 2));
  text.setAttribute("y", String(pad));
}

function syncTitleSvgPaint() {
  const matKey = getMaterialKey();
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const text = document.getElementById("title-svg-text");
  const img = document.getElementById("title-pattern-image");
  const svg = document.getElementById("title-svg");
  const pat = document.getElementById("title-pattern");
  if (!text || !svg || !pat) return;

  // finom “fa felirat” mélység (nem áttetsző, nem mix-blend)
  text.style.paintOrder = "stroke";
  text.style.stroke = "rgba(0,0,0,0.12)";
  text.style.strokeWidth = "1";
  text.style.strokeLinejoin = "round";

  if (mat.titleMode === "solid") {
    text.setAttribute("fill", mat.titleSolid || "#ffffff");
    if (img) img.setAttribute("href", "");
  } else {
    if (img) img.setAttribute("href", mat.titleTextureUrl);
    text.setAttribute("fill", "url(#title-pattern)");
  }

  // pattern image igazítása a bbox-hoz
  requestAnimationFrame(() => {
    const bb = safeBBox(text);
    if (!bb) return;

    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("x", "0");
    pat.setAttribute("y", "0");
    pat.setAttribute("width", String(Math.max(10, bb.width)));
    pat.setAttribute("height", String(Math.max(10, bb.height)));

    if (img) {
      img.setAttribute("width", String(Math.max(10, bb.width)));
      img.setAttribute("height", String(Math.max(10, bb.height)));
      img.setAttribute("preserveAspectRatio", "none");
    }
  });
}

function safeBBox(textEl) {
  try { return textEl.getBBox(); } catch (_) { return null; }
}

/*****************************************************************
 * Pozicionálás + kijelzett cm
 *****************************************************************/
function centerTitle() {
  const c = canvasEl();
  const title = document.getElementById("title-item");
  if (!c || !title) return;

  // canvas koordinátában középre tesszük
  const vp = viewportEl();
  if (!vp) return;

  const rT = title.getBoundingClientRect();
  const left = (vp.clientWidth - rT.width) / 2;
  const top  = (vp.clientHeight - rT.height) / 2;

  title.style.left = `${left}px`;
  title.style.top  = `${top}px`;
  title.style.transform = "none";
}

function updateTitleSizeLabel() {
  const out = document.getElementById("title-size");
  const title = document.getElementById("title-item");
  if (!out || !title) return;

  const ppcm = getPxPerCm();
  const hPx = title.getBoundingClientRect().height || 0;
  const cm = hPx / (ppcm || 1);

  out.textContent = cm.toFixed(1);
}

/*****************************************************************
 * Ikon panel
 *****************************************************************/
function initIconPanel() {
  document.querySelectorAll(".pattern-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const src = btn.dataset.src;
      const alt = btn.dataset.alt || "Ikon";

      try {
        const svgText = await fetchSvg(src);
        addIcon(svgText, { src, alt });
      } catch (e) {
        console.error(e);
        alert("Nem sikerült betölteni az SVG-t: " + src);
      }
    });
  });

  const del = document.getElementById("delete-btn");
  if (del) {
    del.addEventListener("click", () => {
      if (!selectedItem) return;
      if (selectedItem.id === "title-item") return;
      selectedItem.remove();
      setSelected(null);
    });
  }
}

async function fetchSvg(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Fetch hiba: " + url);
  return await res.text();
}

function addIcon(svgText, meta) {
  const itemsLayer = document.getElementById("items-layer");
  const vp = viewportEl();
  if (!itemsLayer || !vp) return;

  const matKey = getMaterialKey();
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = svgText;

  el.dataset.src = meta.src || "";
  el.dataset.alt = meta.alt || "";
  el.dataset.material = matKey;
  el.dataset.engrave = mat.engrave;

  const svg = el.querySelector("svg");

  // Ikon valós cm -> px
  const ppcm = getPxPerCm();
  const size = computeSvgSizePx(svg, ppcm, ICON_BASE_CM);

  el.style.width  = `${size.w}px`;
  el.style.height = `${size.h}px`;

  el.style.left = `${(vp.clientWidth - size.w) / 2}px`;
  el.style.top  = `${(vp.clientHeight - size.h) / 2}px`;

  applySvgEngraveColor(el, mat.engrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);
}

function computeSvgSizePx(svg, pxPerCm, targetHeightCm) {
  const fallbackH = targetHeightCm * pxPerCm;
  let aspect = 1;

  const vb = svg?.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[3] > 0) aspect = parts[2] / parts[3];
  }

  const wAttr = svg?.getAttribute("width")  || "";
  const hAttr = svg?.getAttribute("height") || "";

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

  if (s.endsWith("px")) {
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  if (s.endsWith("mm")) {
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return (n / 10) * pxPerCm;
  }
  if (s.endsWith("cm")) {
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return n * pxPerCm;
  }

  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function applySvgEngraveColor(containerEl, color) {
  const svg = containerEl.querySelector("svg");
  if (!svg) return;

  const targets = svg.querySelectorAll("path, rect, circle, ellipse, polygon, polyline, line");
  targets.forEach(n => {
    const fill = n.getAttribute("fill");
    if (fill !== "none") {
      n.setAttribute("fill", color);
      n.style.fill = color;
    }
    const stroke = n.getAttribute("stroke");
    if (stroke && stroke !== "none") {
      n.setAttribute("stroke", color);
      n.style.stroke = color;
    }
  });

  const styleTag = svg.querySelector("style");
  if (styleTag && styleTag.textContent) {
    styleTag.textContent = styleTag.textContent
      .replace(/fill:\s*#[0-9a-fA-F]{3,8}/g, `fill:${color}`)
      .replace(/stroke:\s*#[0-9a-fA-F]{3,8}/g, `stroke:${color}`);
  }
}

/*****************************************************************
 * Drag (touch + mouse) – zoom/pan mellett: canvas koordinátában
 *****************************************************************/
function makeDraggable(el) {
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSelected(el);
    startDrag(e, el);
  });

  el.addEventListener("touchstart", (e) => {
    e.preventDefault();
    setSelected(el);
    startDrag(e, el);
  }, { passive: false });
}

function startDrag(e, el) {
  const p = getPointer(e);

  const r = el.getBoundingClientRect();
  const local = screenToCanvas(p.x, p.y);
  const localEl = screenToCanvas(r.left, r.top);

  el.style.transform = "none";
  el.style.left = `${localEl.x}px`;
  el.style.top  = `${localEl.y}px`;

  dragState = {
    el,
    offsetX: local.x - localEl.x,
    offsetY: local.y - localEl.y
  };
}

document.addEventListener("mousemove", (e) => { if (dragState) onDragMove(e); });
document.addEventListener("touchmove", (e) => {
  if (!dragState) return;
  onDragMove(e);
  e.preventDefault();
}, { passive: false });

document.addEventListener("mouseup",   () => { dragState = null; });
document.addEventListener("touchend",  () => { dragState = null; });

function onDragMove(e) {
  const p = getPointer(e);
  const { el, offsetX, offsetY } = dragState;

  const cSize = getCanvasSize();
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  const local = screenToCanvas(p.x, p.y);

  let left = local.x - offsetX;
  let top  = local.y - offsetY;

  left = clamp(left, 0, cSize.w - w);
  top  = clamp(top,  0, cSize.h - h);

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;

  if (el.id === "title-item") updateTitleSizeLabel();
}

function getCanvasSize() {
  const vp = viewportEl();
  return vp ? { w: vp.clientWidth, h: vp.clientHeight } : { w: 1, h: 1 };
}

function screenToCanvas(screenX, screenY) {
  const c = canvasEl();
  const rect = c.getBoundingClientRect();
  const x = (screenX - rect.left) / zoom;
  const y = (screenY - rect.top) / zoom;
  return { x, y };
}

/*****************************************************************
 * Kategóriák
 *****************************************************************/
function initCategories() {
  document.querySelectorAll(".pattern-category").forEach(cat => {
    cat.classList.add("collapsed");
    const header = cat.querySelector(".pattern-category-header");
    if (!header) return;
    header.addEventListener("click", () => cat.classList.toggle("collapsed"));
  });
}

/*****************************************************************
 * Kijelölés, törlés, copy/paste
 *****************************************************************/
function initSelectionAndShortcuts() {
  const vp = viewportEl();
  if (!vp) return;

  vp.addEventListener("mousedown", (e) => {
    const hit = e.target.closest(".item");
    if (!hit) setSelected(null);
  });

  vp.addEventListener("touchstart", (e) => {
    const hit = e.target.closest?.(".item");
    if (!hit) setSelected(null);
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if ((e.key === "Delete" || e.key === "Backspace") && selectedItem) {
      if (selectedItem.id !== "title-item") {
        e.preventDefault();
        selectedItem.remove();
        setSelected(null);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedItem) {
      e.preventDefault();
      clipboard = serializeItem(selectedItem);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && clipboard) {
      e.preventDefault();
      pasteItem(clipboard);
      return;
    }
  });
}

function serializeItem(el) {
  const r  = el.getBoundingClientRect();
  const p0 = screenToCanvas(r.left, r.top);

  const base = {
    type: el.id === "title-item" ? "title" : "icon",
    left: p0.x + 20,
    top:  p0.y + 20,
    w: el.offsetWidth,
    h: el.offsetHeight
  };

  if (base.type === "icon") {
    base.svg = el.querySelector("svg")?.outerHTML || "";
    base.src = el.dataset.src || "";
    base.alt = el.dataset.alt || "Ikon";
  }

  return base;
}

function pasteItem(data) {
  if (data.type === "title") {
    setSelected(document.getElementById("title-item"));
    return;
  }

  const itemsLayer = document.getElementById("items-layer");
  if (!itemsLayer) return;

  const matKey  = getMaterialKey();
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const cSize = getCanvasSize();

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = data.svg;

  el.style.width  = `${data.w}px`;
  el.style.height = `${data.h}px`;
  el.style.left   = `${clamp(data.left, 0, cSize.w - data.w)}px`;
  el.style.top    = `${clamp(data.top,  0, cSize.h - data.h)}px`;

  el.dataset.src = data.src || "";
  el.dataset.alt = data.alt || "Ikon";
  el.dataset.material = matKey;
  el.dataset.engrave  = mat.engrave;

  applySvgEngraveColor(el, mat.engrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);
}

/*****************************************************************
 * Kalibráció (komód = 70 cm)
 *****************************************************************/
function initCalibration() {
  const toggleBtn = document.getElementById("calib-toggle-btn");
  const saveBtn = document.getElementById("calib-save-btn");
  const cancelBtn = document.getElementById("calib-cancel-btn");
  const layer = document.getElementById("calibration-layer");
  const topH = document.getElementById("calib-top");
  const botH = document.getElementById("calib-bottom");

  if (!toggleBtn || !saveBtn || !cancelBtn || !layer || !topH || !botH) return;

  function placeDefaultHandles() {
    const cSize = getCanvasSize();
    const y1 = cSize.h * 0.55;
    const y2 = cSize.h * 0.78;
    topH.style.top = `${y1}px`;
    botH.style.top = `${y2}px`;
  }

  placeDefaultHandles();

  toggleBtn.addEventListener("click", () => {
    calibrating = !calibrating;

    if (calibrating) {
      layer.classList.add("active");
      saveBtn.style.display = "";
      cancelBtn.style.display = "";
      toggleBtn.textContent = "Kalibrálás: aktív";
      placeDefaultHandles();
    } else {
      layer.classList.remove("active");
      saveBtn.style.display = "none";
      cancelBtn.style.display = "none";
      toggleBtn.textContent = "Kalibrálás indítása";
      calibDrag = null;
    }
  });

  cancelBtn.addEventListener("click", () => {
    calibrating = false;
    layer.classList.remove("active");
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    toggleBtn.textContent = "Kalibrálás indítása";
    calibDrag = null;
  });

  saveBtn.addEventListener("click", () => {
    const cSize = getCanvasSize();

    const yTop = parsePx(topH.style.top);
    const yBot = parsePx(botH.style.top);

    const topY = clamp(Math.min(yTop, yBot), 0, cSize.h);
    const botY = clamp(Math.max(yTop, yBot), 0, cSize.h);

    const cabinetPx = botY - topY;
    if (cabinetPx < 10) {
      alert("Túl kicsi a távolság. Állítsd a jelölőket a komód tetejére és aljára.");
      return;
    }

    const ppcm = cabinetPx / CABINET_HEIGHT_CM;
    setPxPerCm(ppcm);
    syncScaleUi();

    applyTitleLetterSize();
    syncTitleSvgPaint();
    updateTitleSizeLabel();

    calibrating = false;
    layer.classList.remove("active");
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    toggleBtn.textContent = "Kalibrálás indítása";
    calibDrag = null;
  });

  function hookHandle(handleEl) {
    handleEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!calibrating) return;
      calibDrag = { el: handleEl };
    });

    handleEl.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (!calibrating) return;
      calibDrag = { el: handleEl };
    }, { passive: false });
  }

  hookHandle(topH);
  hookHandle(botH);

  document.addEventListener("mousemove", (e) => {
    if (!calibDrag) return;
    onCalibMove(e);
  });
  document.addEventListener("touchmove", (e) => {
    if (!calibDrag) return;
    onCalibMove(e);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("mouseup", () => { calibDrag = null; });
  document.addEventListener("touchend", () => { calibDrag = null; });

  function onCalibMove(e) {
    const cSize = getCanvasSize();
    const p = getPointer(e);

    const local = screenToCanvas(p.x, p.y);
    let y = clamp(local.y, 0, cSize.h);

    calibDrag.el.style.top = `${y}px`;
  }
}

function parsePx(s) {
  const n = parseFloat(String(s || "0").replace("px",""));
  return isFinite(n) ? n : 0;
}

/*****************************************************************
 * PNG export – nagy felbontás, zoom/pan nem rontja a képet
 *****************************************************************/
function initExport() {
  const btn = document.getElementById("export-btn");
  const node = viewportEl();
  if (!btn || !node) return;

  btn.addEventListener("click", async () => {
    const prev = selectedItem;
    if (prev) prev.classList.remove("selected");

    document.body.classList.add("exporting");

    // exportnál mindig 1× zoom/pan
    const oldZoom = zoom;
    const oldPan = { ...pan };
    zoom = 1; pan = { x: 0, y: 0 };
    applyZoomTransform();

    try {
      const shot = await html2canvas(node, {
        scale: 3,
        useCORS: true,
        backgroundColor: null,
        logging: false
      });

      const a = document.createElement("a");
      a.href = shot.toDataURL("image/png");
      a.download = "felirat_latvanyterv.png";
      a.click();
    } catch (e) {
      console.error(e);
      alert("Hiba történt a PNG export során.");
    } finally {
      zoom = oldZoom;
      pan = oldPan;
      applyZoomTransform();

      document.body.classList.remove("exporting");
      if (prev) prev.classList.add("selected");
    }
  });
}

/*****************************************************************
 * CSV export (valós cm)
 *****************************************************************/
function initCsvExport() {
  const btn = document.getElementById("export-csv-btn");
  if (!btn) return;
  btn.addEventListener("click", () => exportCsv());
}

function exportCsv() {
  const ppcm = getPxPerCm();
  const matKey = getMaterialKey();

  const rows = [];
  rows.push("Típus;Név;Szélesség (cm);Magasság (cm);Anyag;Megjegyzés;Forrás");

  const titleItem = document.getElementById("title-item");
  const tR = titleItem?.getBoundingClientRect?.() || { width: 0, height: 0 };

  const titleName = getTitleTextRaw() || "Felirat";

  rows.push([
    "Felirat",
    csvEsc(titleName),
    ((tR.width  / ppcm).toFixed(2)).replace(".", ","),
    ((tR.height / ppcm).toFixed(2)).replace(".", ","),
    matKey,
    csvEsc("Ékezetek/betűrészek gyártáskor egybe (forrasztás)."),
    csvEsc("font:AlwaysInMyHeart (SVG pattern/solid)")
  ].join(";"));

  const icons = document.querySelectorAll("#items-layer .icon-item");
  icons.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const name = el.dataset.alt || `Ikon ${idx + 1}`;
    rows.push([
      "Ikon",
      csvEsc(name),
      ((r.width  / ppcm).toFixed(2)).replace(".", ","),
      ((r.height / ppcm).toFixed(2)).replace(".", ","),
      matKey,
      csvEsc("Gravírozott dekor"),
      csvEsc(el.dataset.src || "")
    ].join(";"));
  });

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "felirat_meretek.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEsc(t) {
  const s = String(t ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

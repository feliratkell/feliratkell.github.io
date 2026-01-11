/*****************************************************************
 * FELIRAT LÁTVÁNYTERVEZŐ – v1.5 (STABIL TEXT + ZOOM + KOMÓD-KALIBRÁCIÓ)
 * - Referencia: KOMÓD magasság = 70 cm (kalibrálható háttérképenként)
 * - Felirat = anyag textúra (nyír/hdf), NEM gravír
 * - Ikonok = gravír (solid, no opacity/blend)
 * - ENTER új sor: betűméret nem csökken (fix 11 cm betűmagasság)
 * - Kalibráció overlay csak bekapcsolva látszik, exportban sosem
 * - Zoom: 1x/1.5x/2x/3x + reset, zoom után fókusz a kijelölt elemre
 * - Zoomnál üres falon drag = pan
 * - Sablon: „ …” előtt szóköz
 *****************************************************************/

const CABINET_HEIGHT_CM = 70;
const TITLE_LETTER_CM = 11.0;
const ICON_BASE_CM = 12.0;

const MATERIALS = {
  birch: {
    titleFill: "assets/textures/birch.png",
    engrave: "#7A4A1E",
    shadow: "rgba(0,0,0,0.18)",
    titleShadow: "rgba(0,0,0,0.18)"
  },
  hdf: {
    titleFill: "__WHITE__",
    engrave: "#1E1E1E",
    shadow: "rgba(0,0,0,0.22)",
    titleShadow: "rgba(0,0,0,0.18)"
  }
};

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

let view = { zoom: 1, tx: 0, ty: 0 };
let panState = null;

document.addEventListener("DOMContentLoaded", async () => {
  initWall();
  initMaterial();
  initTitle();
  initIconPanel();
  initCategories();
  initSelectionAndShortcuts();
  initExport();
  initCsvExport();
  initCalibration();
  initZoom();

  applyWall("white");
  applyMaterial("birch");

  // Font betöltés után pontosabb a render + magasság (nem kötelező, de stabilabb)
  try {
    if (document.fonts?.load) {
      await document.fonts.load('16px "AlwaysInMyHeart"');
    }
  } catch (_) {}

  syncScaleUi();
  applyTitleLetterSize();
  centerTitle();
  updateTitleSizeLabel();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      clampView();
      applyView();
      applyTitleLetterSize();
      updateTitleSizeLabel();
    }, 120);
  });
});

/*****************************************************************
 * Segédek
 *****************************************************************/
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function getPointer(e) {
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function canvasEl() { return document.getElementById("canvas"); }
function zoomEl() { return document.getElementById("canvas-zoom"); }

function canvasRect() { return canvasEl().getBoundingClientRect(); }

function setSelected(el) {
  if (selectedItem) selectedItem.classList.remove("selected");
  selectedItem = el;
  if (selectedItem) selectedItem.classList.add("selected");
}

function getTitleTextRaw() {
  const el = document.getElementById("title-input");
  return (el?.value ?? "").replace(/\r\n/g, "\n");
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
    const r = canvasRect();
    return r.height / 220;
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
  updateTitleSizeLabel();
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
  const canvas = canvasEl();
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  canvas.style.setProperty("--engrave", mat.engrave);
  canvas.style.setProperty("--engrave-shadow", mat.shadow);

  if (mat.titleFill === "__WHITE__") {
    canvas.style.setProperty("--title-fill", "linear-gradient(#ffffff, #ffffff)");
  } else {
    canvas.style.setProperty("--title-fill", `url("${mat.titleFill}")`);
  }
  canvas.style.setProperty("--title-shadow", mat.titleShadow);

  // ikonok gravír szín
  document.querySelectorAll("#items-layer .icon-item").forEach(el => {
    applySvgEngraveColor(el, mat.engrave);
    el.dataset.material = matKey;
    el.dataset.engrave = mat.engrave;
  });

  const title = document.getElementById("title-item");
  if (title) title.dataset.material = matKey;
}

/*****************************************************************
 * Felirat
 *****************************************************************/
function initTitle() {
  const input = document.getElementById("title-input");
  const tpl = document.getElementById("template-select");
  const titleItem = document.getElementById("title-item");
  const titleText = document.getElementById("title-text");
  const centerBtn = document.getElementById("center-title-btn");

  if (!input || !titleItem || !titleText) return;

  if (!input.value) input.value = "Felirat";
  titleText.textContent = normalizeEllipsisSpacing(input.value);

  if (tpl) {
    tpl.addEventListener("change", () => {
      if (!tpl.value) return;
      input.value = tpl.value;
      titleText.textContent = normalizeEllipsisSpacing(tpl.value);
      tpl.value = "";
      applyTitleLetterSize();
      updateTitleSizeLabel();
    });
  }

  input.addEventListener("input", () => {
    titleText.textContent = normalizeEllipsisSpacing(getTitleTextRaw() || "Felirat");
    applyTitleLetterSize();
    updateTitleSizeLabel();
  });

  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      centerTitle();
      updateTitleSizeLabel();
      focusOnSelected(true);
    });
  }

  makeDraggable(titleItem);

  requestAnimationFrame(() => {
    applyTitleLetterSize();
    updateTitleSizeLabel();
  });
}

function normalizeEllipsisSpacing(text) {
  const s = String(text || "");
  return s
    .replace(/(\S)(\.\.\.|…)/g, "$1 $2")
    .replace(/\s+(…)/g, " $1")
    .replace(/\s+(\.\.\.)/g, " $1");
}

function applyTitleLetterSize() {
  const titleText = document.getElementById("title-text");
  if (!titleText) return;

  const ppcm = getPxPerCm();
  const px = TITLE_LETTER_CM * ppcm;

  // Fix betűméret px-ben (valós cm -> px)
  titleText.style.fontSize = `${clamp(px, 10, 600)}px`;
}

function centerTitle() {
  const canvas = zoomEl();
  const title = document.getElementById("title-item");
  if (!canvas || !title) return;

  const rC = canvas.getBoundingClientRect();
  const rT = title.getBoundingClientRect();

  const left = (rC.width - rT.width) / 2;
  const top  = (rC.height - rT.height) / 2;

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
  const res = await fetch(url);
  if (!res.ok) throw new Error("Fetch hiba: " + url);
  return await res.text();
}

function addIcon(svgText, meta) {
  const itemsLayer = document.getElementById("items-layer");
  if (!itemsLayer) return;

  const matKey = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = svgText;

  el.dataset.src = meta.src || "";
  el.dataset.alt = meta.alt || "";
  el.dataset.material = matKey;
  el.dataset.engrave = mat.engrave;

  const svg = el.querySelector("svg");

  const ppcm = getPxPerCm();
  const size = computeSvgSizePx(svg, ppcm, ICON_BASE_CM);

  el.style.width  = `${size.w}px`;
  el.style.height = `${size.h}px`;

  const rC = zoomEl().getBoundingClientRect();
  el.style.left = `${(rC.width - size.w) / 2}px`;
  el.style.top  = `${(rC.height - size.h) / 2}px`;

  applySvgEngraveColor(el, mat.engrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);

  focusOnSelected(true);
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
 * Drag (item) + Pan (zoom)
 *****************************************************************/
function makeDraggable(el) {
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(el);
    startDrag(e, el);
  });

  el.addEventListener("touchstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(el);
    startDrag(e, el);
  }, { passive: false });
}

function startDrag(e, el) {
  const p = getPointer(e);
  const cR = canvasRect();
  const r  = el.getBoundingClientRect();

  // képernyő -> content koordináta
  const contentLeft = (r.left - cR.left - view.tx) / view.zoom;
  const contentTop  = (r.top  - cR.top  - view.ty) / view.zoom;

  el.style.transform = "none";
  el.style.left = `${contentLeft}px`;
  el.style.top  = `${contentTop}px`;

  dragState = {
    el,
    offsetX: (p.x - cR.left - view.tx) / view.zoom - contentLeft,
    offsetY: (p.y - cR.top  - view.ty) / view.zoom - contentTop
  };
}

document.addEventListener("mousemove", (e) => {
  if (dragState) onDragMove(e);
  else if (panState) onPanMove(e);
});
document.addEventListener("touchmove", (e) => {
  if (dragState) { onDragMove(e); e.preventDefault(); }
  else if (panState) { onPanMove(e); e.preventDefault(); }
}, { passive: false });

document.addEventListener("mouseup", () => { dragState = null; panState = null; });
document.addEventListener("touchend", () => { dragState = null; panState = null; });

function onDragMove(e) {
  const p = getPointer(e);
  const cR = canvasRect();
  const { el, offsetX, offsetY } = dragState;

  const w = el.offsetWidth;
  const h = el.offsetHeight;

  let left = (p.x - cR.left - view.tx) / view.zoom - offsetX;
  let top  = (p.y - cR.top  - view.ty) / view.zoom - offsetY;

  // clamp content coord alapján
  const maxLeft = zoomEl().clientWidth - w;
  const maxTop  = zoomEl().clientHeight - h;

  left = clamp(left, 0, maxLeft);
  top  = clamp(top, 0, maxTop);

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;

  if (el.id === "title-item") updateTitleSizeLabel();
}

function startPan(e) {
  if (view.zoom <= 1) return;
  const p = getPointer(e);
  panState = { startX: p.x, startY: p.y, baseTx: view.tx, baseTy: view.ty };
}

function onPanMove(e) {
  const p = getPointer(e);
  const dx = p.x - panState.startX;
  const dy = p.y - panState.startY;

  view.tx = panState.baseTx + dx;
  view.ty = panState.baseTy + dy;

  clampView();
  applyView();
}

function initPanOnEmpty() {
  const canvas = canvasEl();
  if (!canvas) return;

  canvas.addEventListener("mousedown", (e) => {
    // üres falon drag -> pan (zoom alatt)
    const hitItem = e.target.closest?.(".item");
    const hitZoomUI = e.target.closest?.("#zoom-controls");
    const hitCalib = e.target.closest?.("#calibration-layer");
    if (hitItem || hitZoomUI || hitCalib) return;

    // katt üresre: kijelölés törlés
    setSelected(null);

    // zoom esetén pan
    startPan(e);
  });

  canvas.addEventListener("touchstart", (e) => {
    const hitItem = e.target.closest?.(".item");
    const hitZoomUI = e.target.closest?.("#zoom-controls");
    const hitCalib = e.target.closest?.("#calibration-layer");
    if (hitItem || hitZoomUI || hitCalib) return;

    setSelected(null);
    startPan(e);
  }, { passive: true });
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
  initPanOnEmpty();

  const canvas = canvasEl();
  if (!canvas) return;

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
  const cR = canvasRect();
  const r  = el.getBoundingClientRect();

  const contentLeft = (r.left - cR.left - view.tx) / view.zoom;
  const contentTop  = (r.top  - cR.top  - view.ty) / view.zoom;

  const base = {
    type: el.id === "title-item" ? "title" : "icon",
    left: contentLeft + 20,
    top:  contentTop  + 20,
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
    focusOnSelected(true);
    return;
  }

  const itemsLayer = document.getElementById("items-layer");
  if (!itemsLayer) return;

  const matKey  = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = data.svg;

  el.style.width  = `${data.w}px`;
  el.style.height = `${data.h}px`;

  const maxLeft = zoomEl().clientWidth - data.w;
  const maxTop  = zoomEl().clientHeight - data.h;

  el.style.left   = `${clamp(data.left, 0, maxLeft)}px`;
  el.style.top    = `${clamp(data.top,  0, maxTop)}px`;

  el.dataset.src = data.src || "";
  el.dataset.alt = data.alt || "Ikon";
  el.dataset.material = matKey;
  el.dataset.engrave  = mat.engrave;

  applySvgEngraveColor(el, mat.engrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);

  focusOnSelected(true);
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
    const r = zoomEl().getBoundingClientRect();
    const y1 = r.height * 0.55;
    const y2 = r.height * 0.78;
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
    const r = zoomEl().getBoundingClientRect();

    // handle top pozíció content coord-ban van, jó
    const yTop = parsePx(topH.style.top);
    const yBot = parsePx(botH.style.top);

    const topY = clamp(Math.min(yTop, yBot), 0, r.height);
    const botY = clamp(Math.max(yTop, yBot), 0, r.height);

    const cabinetPx = botY - topY;
    if (cabinetPx < 10) {
      alert("Túl kicsi a távolság. Állítsd a jelölőket a komód tetejére és aljára.");
      return;
    }

    const ppcm = cabinetPx / CABINET_HEIGHT_CM;
    setPxPerCm(ppcm);
    syncScaleUi();

    applyTitleLetterSize();
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

  document.addEventListener("mousemove", (e) => { if (calibDrag) onCalibMove(e); });
  document.addEventListener("touchmove", (e) => {
    if (!calibDrag) return;
    onCalibMove(e);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("mouseup", () => { calibDrag = null; });
  document.addEventListener("touchend", () => { calibDrag = null; });

  function onCalibMove(e) {
    const r = canvasRect();
    const p = getPointer(e);

    // pointer screen -> content coord (zoom+pan figyelembe)
    let y = (p.y - r.top - view.ty) / view.zoom;
    y = clamp(y, 0, zoomEl().clientHeight);

    calibDrag.el.style.top = `${y}px`;
  }
}

function parsePx(s) {
  const n = parseFloat(String(s || "0").replace("px",""));
  return isFinite(n) ? n : 0;
}

/*****************************************************************
 * Zoom
 *****************************************************************/
function initZoom() {
  const btns = document.querySelectorAll(".zoom-btn[data-zoom]");
  const reset = document.getElementById("zoom-reset");
  const out = document.getElementById("zoom-readout");
  const canvas = canvasEl();

  function setZoom(z) {
    const prev = view.zoom;
    view.zoom = clamp(Number(z) || 1, 1, 3);

    // ha most lépünk nagyobbra/kisebbre, próbáljunk fókuszálni a kijelölt elemre
    const shouldFocus = (Math.abs(view.zoom - prev) > 0.001);
    if (shouldFocus) focusOnSelected(false);

    clampView();
    applyView();
    if (out) out.textContent = `${view.zoom.toFixed(1)}×`;
  }

  btns.forEach(b => {
    b.addEventListener("click", () => setZoom(b.dataset.zoom));
  });

  if (reset) {
    reset.addEventListener("click", () => {
      view.zoom = 1;
      view.tx = 0;
      view.ty = 0;
      applyView();
      if (out) out.textContent = `1.0×`;
    });
  }

  // görgő + ctrl zoom (PC)
  canvas.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(view.zoom + delta);
  }, { passive: false });

  applyView();
}

function applyView() {
  const canvas = canvasEl();
  canvas.style.setProperty("--zoom", String(view.zoom));
  canvas.style.setProperty("--tx", `${view.tx}px`);
  canvas.style.setProperty("--ty", `${view.ty}px`);
}

function clampView() {
  const r = canvasRect();
  const w = r.width;
  const h = r.height;

  const scaledW = w * view.zoom;
  const scaledH = h * view.zoom;

  // ha zoom = 1 -> 0..0
  if (view.zoom <= 1.0001) {
    view.tx = 0;
    view.ty = 0;
    return;
  }

  // tx/ty screen px
  const minTx = w - scaledW; // negatív
  const minTy = h - scaledH;

  view.tx = clamp(view.tx, minTx, 0);
  view.ty = clamp(view.ty, minTy, 0);
}

function focusOnSelected(animate) {
  if (view.zoom <= 1.0001) return;

  const target = selectedItem || document.getElementById("title-item");
  if (!target) return;

  const cR = canvasRect();
  const tR = target.getBoundingClientRect();

  // target középpont screen-ben
  const targetCx = tR.left + tR.width / 2;
  const targetCy = tR.top  + tR.height / 2;

  // vászon közepe
  const canvasCx = cR.left + cR.width / 2;
  const canvasCy = cR.top  + cR.height / 2;

  // mennyit toljunk screen px-ben
  const dx = canvasCx - targetCx;
  const dy = canvasCy - targetCy;

  if (animate) {
    // egyszerű animáció
    const steps = 10;
    const startTx = view.tx, startTy = view.ty;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        view.tx = startTx + (dx * i / steps);
        view.ty = startTy + (dy * i / steps);
        clampView();
        applyView();
      }, i * 12);
    }
  } else {
    view.tx += dx;
    view.ty += dy;
  }
}

/*****************************************************************
 * PNG export
 *****************************************************************/
function initExport() {
  const btn = document.getElementById("export-btn");
  const canvasNode = canvasEl();
  if (!btn || !canvasNode) return;

  btn.addEventListener("click", async () => {
    const prev = selectedItem;
    if (prev) prev.classList.remove("selected");

    document.body.classList.add("exporting");

    try {
      // exportnál a zoom/pan ne torzítson: reset view ideiglenesen
      const saved = { ...view };
      view.zoom = 1; view.tx = 0; view.ty = 0;
      applyView();

      const shot = await html2canvas(canvasNode, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false
      });

      // visszaállítjuk
      view = saved;
      applyView();

      const a = document.createElement("a");
      a.href = shot.toDataURL("image/png");
      a.download = "felirat_latvanyterv.png";
      a.click();
    } catch (e) {
      console.error(e);
      alert("Hiba történt a PNG export során.");
    } finally {
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
  const matKey = document.querySelector('input[name="material"]:checked')?.value || "birch";

  const rows = [];
  rows.push("Típus;Név;Szélesség (cm);Magasság (cm);Anyag;Megjegyzés;Forrás");

  const titleItem = document.getElementById("title-item");
  const tR = titleItem.getBoundingClientRect();

  const titleName = getTitleTextRaw() || "Felirat";

  rows.push([
    "Felirat",
    csvEsc(titleName),
    ((tR.width  / ppcm).toFixed(2)).replace(".", ","),
    ((tR.height / ppcm).toFixed(2)).replace(".", ","),
    matKey,
    csvEsc("Ékezetek/betűrészek gyártáskor forrasztva, egybe."),
    csvEsc("font:AlwaysInMyHeart (anyag textúra kitöltés)")
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

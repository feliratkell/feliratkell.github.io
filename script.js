/*****************************************************************
 * FELIRAT LÁTVÁNYTERVEZŐ – v1.4 (SVG MASK + TEXT→PATH)
 * - Referencia: KOMÓD magasság = 70 cm (kalibrálható háttérképenként)
 * - Felirat: SVG mask (textúra a PATH-on belül), TEXT→PATH (B)
 * - Ikonok: gravír (szín + finom árnyék), NINCS opacity+blend alapból
 * - ENTER új sor: betűméret nem csökken
 * - Kalibráció overlay csak bekapcsolva látszik, exportban sosem
 * - Sablon: „ …” előtt szóköz
 *****************************************************************/

const CABINET_HEIGHT_CM = 70;
const TITLE_LETTER_CM = 11.0;   // valós (cm)
const ICON_BASE_CM = 12.0;

// Anyag preset
const MATERIALS = {
  birch: {
    titleTexture: "assets/textures/birch.png",
    engrave: "#7A4A1E",
    shadow: "rgba(0,0,0,0.12)",
    titleShadow: "rgba(0,0,0,0.18)"
  },
  hdf: {
    titleTexture: "assets/textures/hdf-white.png",
    engrave: "#1E1E1E",
    shadow: "rgba(0,0,0,0.14)",
    titleShadow: "rgba(0,0,0,0.18)"
  }
};

// Fal
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

let titleFont = null; // opentype.js font

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

  applyWall("white");
  applyMaterial("birch");

  syncScaleUi();

  // Font betöltés (B megoldás alapja)
  await loadTitleFont();

  // első render
  renderTitleSvg();
  centerTitle();
  updateTitleSizeLabel();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderTitleSvg();
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

function getLines(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const lines = t.split("\n");
  return lines.length ? lines : ["Felirat"];
}

// „.../… ” előtti szóköz szépítése
function normalizeEllipsisSpacing(text) {
  const s = String(text || "");
  return s
    .replace(/(\S)(\.\.\.|…)/g, "$1 $2")
    .replace(/\s+(…)/g, " $1")
    .replace(/\s+(\.\.\.)/g, " $1");
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

  const url = WALLS[activeWallKey] || WALLS.white;
  wallLayer.style.backgroundImage = `url("${url}")`;

  syncScaleUi();
  renderTitleSvg();
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
  canvas.style.setProperty("--title-shadow", mat.titleShadow);

  // NYERS útvonal (SVG image href-hez)
  canvas.style.setProperty("--title-texture-src", `"${mat.titleTexture}"`);

  // ikonok színezése (egyszín gravír)
  document.querySelectorAll("#items-layer .icon-item").forEach(el => {
    applySvgEngraveColor(el, mat.engrave);
    el.dataset.material = matKey;
    el.dataset.engrave = mat.engrave;
  });

  // felirat meta + rerender
  const title = document.getElementById("title-item");
  if (title) title.dataset.material = matKey;

  renderTitleSvg();
}

/*****************************************************************
 * Felirat – B: TEXT→PATH + SVG MASK
 *****************************************************************/
async function loadTitleFont() {
  // opentype.js kötelező
  if (typeof opentype === "undefined") {
    alert("Hiányzik az opentype.js (CDN). Ellenőrizd az index.html-ben a script sort.");
    return;
  }

  const fontUrl = "AlwaysInMyHeart.ttf";

  titleFont = await new Promise((resolve, reject) => {
    opentype.load(fontUrl, (err, font) => {
      if (err) reject(err);
      else resolve(font);
    });
  }).catch(err => {
    console.error(err);
    alert("Nem sikerült betölteni a betűtípust: AlwaysInMyHeart.ttf (ellenőrizd a fájlt a repo rootban)");
    return null;
  });

  return titleFont;
}

function initTitle() {
  const input = document.getElementById("title-input");
  const tpl = document.getElementById("template-select");
  const titleItem = document.getElementById("title-item");
  const centerBtn = document.getElementById("center-title-btn");

  if (!input || !titleItem) return;

  if (!input.value) input.value = "Felirat";

  if (tpl) {
    tpl.addEventListener("change", () => {
      if (!tpl.value) return;
      input.value = tpl.value;
      tpl.value = "";
      renderTitleSvg();
      updateTitleSizeLabel();
    });
  }

  input.addEventListener("input", () => {
    renderTitleSvg();
    updateTitleSizeLabel();
  });

  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      centerTitle();
      updateTitleSizeLabel();
    });
  }

  makeDraggable(titleItem);
}

function getTitleTextureSrc() {
  const canvas = canvasEl();
  if (!canvas) return "assets/textures/birch.png";
  const raw = getComputedStyle(canvas).getPropertyValue("--title-texture-src").trim();
  // raw tipikusan: "assets/textures/birch.png"
  return raw.replace(/^"+|"+$/g, "");
}

function renderTitleSvg() {
  const host = document.getElementById("title-svg");
  const titleItem = document.getElementById("title-item");
  if (!host || !titleItem) return;

  const textRaw = normalizeEllipsisSpacing(getTitleTextRaw() || "Felirat");
  const lines = getLines(textRaw);

  const ppcm = getPxPerCm();
  const fontSizePx = clamp(TITLE_LETTER_CM * ppcm, 10, 600);
  const lineHeight = 1.05;
  const lineAdvance = fontSizePx * lineHeight;

  // Ha nincs font (még nem töltött be), akkor ne villogjon: hagyjunk placeholdert
  if (!titleFont) {
    host.innerHTML = `<div style="font-family:AlwaysInMyHeart,system-ui;font-size:${fontSizePx}px;line-height:${lineHeight};white-space:pre-line;text-align:center;">${escapeHtml(textRaw)}</div>`;
    return;
  }

  // PATH-ok összerakása + bbox számítás
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const paths = [];

  // A baseline: opentype y tengelye felfelé nő, de getPath kezeli a normál koordinátát
  // Mi egyszerűen egymás alá tesszük a sorokat.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const y = (i + 1) * lineAdvance; // baseline kb így ad jó eredményt

    // üres sor: csak advance
    if (!line.trim()) continue;

    const p = titleFont.getPath(line, 0, y, fontSizePx);
    const d = p.toPathData(3);
    paths.push({ d });

    const bb = p.getBoundingBox();
    minX = Math.min(minX, bb.x1);
    minY = Math.min(minY, bb.y1);
    maxX = Math.max(maxX, bb.x2);
    maxY = Math.max(maxY, bb.y2);
  }

  // ha minden sor üres volt
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = fontSizePx * 2; maxY = lineAdvance;
  }

  const pad = Math.max(2, fontSizePx * 0.08);
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;

  // viewBox alapú méretezés: a title-item doboza a path bbox-hoz igazodik
  // Így a drag box is valós “anyag darab” lesz.
  titleItem.style.width = `${vbW}px`;
  titleItem.style.height = `${vbH}px`;
  host.style.width = "100%";
  host.style.height = "100%";

  const textureSrc = getTitleTextureSrc();
  const shadow = getComputedStyle(canvasEl()).getPropertyValue("--title-shadow").trim() || "rgba(0,0,0,0.18)";

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${vbW}" height="${vbH}"
     viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
     preserveAspectRatio="xMidYMid meet">

  <defs>
    <mask id="titleMask" maskUnits="userSpaceOnUse">
      <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="black"/>
      ${paths.map(p => `<path d="${p.d}" fill="white"/>`).join("\n")}
    </mask>

    <filter id="titleShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0.6" dy="0.9" stdDeviation="0.6" flood-color="${shadow}" flood-opacity="1"/>
    </filter>
  </defs>

  <g filter="url(#titleShadow)">
    <image href="${textureSrc}"
           x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}"
           preserveAspectRatio="xMidYMid slice"
           mask="url(#titleMask)"/>
  </g>
</svg>`;

  host.innerHTML = svg;

  // ha a title-item még középre van translate-tel, hagyjuk; ha már dragelted, úgyis átvált left/top-ra
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/*****************************************************************
 * Pozicionálás + kijelzett cm (valós)
 *****************************************************************/
function centerTitle() {
  const canvas = canvasEl();
  const title = document.getElementById("title-item");
  if (!canvas || !title) return;

  const rC = canvas.getBoundingClientRect();
  const w = title.offsetWidth || 0;
  const h = title.offsetHeight || 0;

  const left = (rC.width - w) / 2;
  const top  = (rC.height - h) / 2;

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
  const canvas = canvasEl();
  if (!itemsLayer || !canvas) return;

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

  const rC = canvas.getBoundingClientRect();
  el.style.left = `${(rC.width - size.w) / 2}px`;
  el.style.top  = `${(rC.height - size.h) / 2}px`;

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
 * Drag (touch + mouse)
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
  const cR = canvasRect();
  const r  = el.getBoundingClientRect();

  const left = r.left - cR.left;
  const top  = r.top  - cR.top;

  el.style.transform = "none";
  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;

  dragState = {
    el, cR,
    offsetX: p.x - r.left,
    offsetY: p.y - r.top
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
  const { el, cR, offsetX, offsetY } = dragState;

  const w = el.offsetWidth;
  const h = el.offsetHeight;

  let left = p.x - cR.left - offsetX;
  let top  = p.y - cR.top  - offsetY;

  left = clamp(left, 0, cR.width  - w);
  top  = clamp(top,  0, cR.height - h);

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;

  if (el.id === "title-item") updateTitleSizeLabel();
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
  const canvas = canvasEl();
  if (!canvas) return;

  canvas.addEventListener("mousedown", (e) => {
    const hit = e.target.closest(".item");
    if (!hit) setSelected(null);
  });

  canvas.addEventListener("touchstart", (e) => {
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
  const cR = canvasRect();
  const r  = el.getBoundingClientRect();

  const base = {
    type: el.id === "title-item" ? "title" : "icon",
    left: (r.left - cR.left) + 20,
    top:  (r.top  - cR.top)  + 20,
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

  const matKey  = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = data.svg;

  el.style.width  = `${data.w}px`;
  el.style.height = `${data.h}px`;
  el.style.left   = `${clamp(data.left, 0, canvasRect().width  - data.w)}px`;
  el.style.top    = `${clamp(data.top,  0, canvasRect().height - data.h)}px`;

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
    const r = canvasRect();
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
    const r = canvasRect();

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

    renderTitleSvg();
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
    const canvasTop = r.top;

    let y = p.y - canvasTop;
    y = clamp(y, 0, r.height);

    calibDrag.el.style.top = `${y}px`;
  }
}

function parsePx(s) {
  const n = parseFloat(String(s || "0").replace("px",""));
  return isFinite(n) ? n : 0;
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
      const shot = await html2canvas(canvasNode, {
        scale: 2,
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
    csvEsc("font:AlwaysInMyHeart → PATH + SVG mask (anyagtextúra)")
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

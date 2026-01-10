/*****************************************************************
 * FELIRAT LÁTVÁNYTERVEZŐ – v1.3 (VÉGLEGES LOGIKA)
 * - Fal referencia: 200 cm (2m), de a "fal-rész" a canvas 12%–88% sávja
 * - FELIRAT: kivágott anyag-szín (NEM gravír), FIX betűméret
 * - IKONOK: gravírozott szín (anyagfüggő)
 * - ENTER: új sor, semmi nem kicsinyül
 * - "... / …" elé automatikus szóköz: " …"
 * - Drag, kijelölés, törlés, Ctrl+C/V, PNG export, CSV export marad
 *****************************************************************/

// Fal valós mérete (referencia)
const WALL_HEIGHT_CM = 200;                 // 2m
const WALL_ASPECT = 310 / 225;              // canvas arány
const WALL_WIDTH_CM = WALL_HEIGHT_CM * WALL_ASPECT;

// A fal ténylegesen látható része a vásznon (segédvonalakhoz igazítva)
const WALL_REGION_TOP_PCT = 0.12;           // 12%
const WALL_REGION_BOTTOM_PCT = 0.88;        // 88%

// Ikon alapmagasság (valós falhoz viszonyítva)
const ICON_DEFAULT_HEIGHT_CM = 12;

// Anyag presetek
// - titleColor: felirat (kivágott anyag szín)
// - iconEngrave: ikon (gravír szín)
const MATERIALS = {
  birch: {
    textureUrl: "assets/textures/birch.png",
    titleColor: "#e8d7b0",      // nyír / világos fa
    iconEngrave: "#7a4a1e"      // nyír gravír (barnás)
  },
  hdf: {
    textureUrl: "assets/textures/hdf-white.png",
    titleColor: "#ffffff",      // fehér HDF
    iconEngrave: "#1e1e1e"      // HDF gravír (feketés)
  }
};

// Fal képek
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

// Felirat módot meghagyjuk kompatibilitás miatt, de a felirat TEXT
let titleMode = "text";
let titleSvgSrc = "";

document.addEventListener("DOMContentLoaded", () => {
  initWall();
  initMaterial();
  initTitle();
  initIconPanel();
  initCategories();
  initSelectionAndShortcuts();
  initExport();
  initCsvExport();

  applyWall("white");
  applyMaterial("birch");
  centerTitle();
  updateTitleSizeLabel();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // FIX betűméret → nem skálázunk semmit
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

function canvasRect() {
  return document.getElementById("canvas").getBoundingClientRect();
}

// fal-rész (12%–88%) pixelmagasság
function wallRegionHeightPx() {
  const r = canvasRect();
  return r.height * (WALL_REGION_BOTTOM_PCT - WALL_REGION_TOP_PCT);
}

function pxPerCmY() {
  // a fal 200 cm a "fal-rész" magasságához tartozik
  return wallRegionHeightPx() / WALL_HEIGHT_CM;
}

function pxPerCmX() {
  const r = canvasRect();
  return r.width / WALL_WIDTH_CM;
}

function setSelected(el) {
  if (selectedItem) selectedItem.classList.remove("selected");
  selectedItem = el;
  if (selectedItem) selectedItem.classList.add("selected");
}

function getTitleTextRaw() {
  const el = document.getElementById("title-input");
  return (el?.value ?? "").replace(/\r\n/g, "\n");
}

// "..." vagy "…", és ha nincs előtte space → tegyünk: " …"
function normalizeEllipsisSpacing(text) {
  let t = String(text ?? "");
  // egységesítsük: "..." → "…"
  t = t.replace(/\.{3}/g, "…");
  // "valami…" → "valami …"
  t = t.replace(/(\S)…/g, "$1 …");
  // többszörös space-eket ne gerjesszük
  t = t.replace(/\s{2,}/g, " ");
  return t;
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
  const wallLayer = document.getElementById("wall-layer");
  if (!wallLayer) return;
  const url = WALLS[key] || WALLS.white;
  wallLayer.style.backgroundImage = `url("${url}")`;
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
  const canvas = document.getElementById("canvas");
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  // CSS változók
  canvas.style.setProperty("--mat-texture", `url("${mat.textureUrl}")`);
  canvas.style.setProperty("--title-color", mat.titleColor);
  canvas.style.setProperty("--icon-engrave", mat.iconEngrave);

  // ikonok gravír színe
  document.querySelectorAll("#items-layer .icon-item").forEach(el => {
    applySvgEngraveColor(el, mat.iconEngrave);
    el.dataset.material = matKey;
    el.dataset.engrave = mat.iconEngrave;
  });

  // felirat meta + szín (NEM gravír)
  const title = document.getElementById("title-item");
  if (title) {
    title.dataset.material = matKey;
    title.dataset.titleColor = mat.titleColor;
  }

  updateTitleSizeLabel();
}

/*****************************************************************
 * Felirat (TEXT + ENTER sortörés + FIX betűméret)
 *****************************************************************/
function initTitle() {
  const input = document.getElementById("title-input");      // textarea
  const tpl   = document.getElementById("template-select");
  const titleItem = document.getElementById("title-item");
  const titleText = document.getElementById("title-text");
  const centerBtn = document.getElementById("center-title-btn");

  if (!input || !titleItem || !titleText) return;

  // alap
  if (!input.value) input.value = "Felirat";
  input.value = normalizeEllipsisSpacing(input.value);
  titleText.textContent = input.value;

  if (tpl) {
    tpl.addEventListener("change", () => {
      if (!tpl.value) return;
      const val = normalizeEllipsisSpacing(tpl.value);

      // TEXT sablonok
      titleMode = "text";
      titleSvgSrc = "";

      input.value = val;
      titleText.textContent = val;
      tpl.value = "";

      updateTitleSizeLabel();
    });
  }

  input.addEventListener("input", () => {
    const norm = normalizeEllipsisSpacing(getTitleTextRaw() || "Felirat");
    // textarea tartalmát is javítjuk, hogy a user lássa
    if (input.value !== norm) {
      const pos = input.selectionStart;
      input.value = norm;
      // próbáljuk megtartani nagyjából a kurzort
      try { input.selectionStart = input.selectionEnd = Math.min(pos, norm.length); } catch (_) {}
    }
    titleText.textContent = norm;
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

/*****************************************************************
 * Pozicionálás + kijelzett cm (fal-részhez)
 *****************************************************************/
function centerTitle() {
  const canvas = document.getElementById("canvas");
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
  const canvas = document.getElementById("canvas");
  const title  = document.getElementById("title-item");
  const out    = document.getElementById("title-size");
  if (!canvas || !title || !out) return;

  const rT = title.getBoundingClientRect();
  const hPx = rT.height;

  const wallPx = wallRegionHeightPx();
  const cm = (hPx / wallPx) * WALL_HEIGHT_CM;

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
  const canvas = document.getElementById("canvas");
  if (!itemsLayer || !canvas) return;

  const matKey = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = svgText;

  el.dataset.src = meta.src || "";
  el.dataset.alt = meta.alt || "";
  el.dataset.material = matKey;
  el.dataset.engrave = mat.iconEngrave;

  const svg = el.querySelector("svg");
  const ppcm = pxPerCmY();

  // alap ikon magasság: 12 cm (falhoz)
  const size = computeSvgSizePx(svg, ppcm, ICON_DEFAULT_HEIGHT_CM);

  el.style.width  = `${size.w}px`;
  el.style.height = `${size.h}px`;

  const rC = canvas.getBoundingClientRect();
  el.style.left = `${(rC.width - size.w) / 2}px`;
  el.style.top  = `${(rC.height - size.h) / 2}px`;

  applySvgEngraveColor(el, mat.iconEngrave);

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
  const canvas = document.getElementById("canvas");
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
  const canvas = document.getElementById("canvas");
  const cR = canvas.getBoundingClientRect();
  const r  = el.getBoundingClientRect();

  const base = {
    type: el.id === "title-item" ? "title" : "icon",
    left: (r.left - cR.left) + 20,
    top:  (r.top  - cR.top)  + 20,
    w: el.offsetWidth,
    h: el.offsetHeight
  };

  if (base.type === "title") {
    base.titleMode = titleMode;
    base.text = getTitleTextRaw() || "Felirat";
  } else {
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
  el.dataset.engrave  = mat.iconEngrave;

  applySvgEngraveColor(el, mat.iconEngrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);
}

/*****************************************************************
 * PNG export
 *****************************************************************/
function initExport() {
  const btn = document.getElementById("export-btn");
  const canvasEl = document.getElementById("canvas");
  if (!btn || !canvasEl) return;

  btn.addEventListener("click", async () => {
    const prev = selectedItem;
    if (prev) prev.classList.remove("selected");

    document.body.classList.add("exporting");

    try {
      const shot = await html2canvas(canvasEl, {
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
 * CSV export (méretek) – valós falhoz (fal-rész szerint)
 *****************************************************************/
function initCsvExport() {
  const btn = document.getElementById("export-csv-btn");
  if (!btn) return;
  btn.addEventListener("click", () => exportCsv());
}

function exportCsv() {
  const canvas = document.getElementById("canvas");
  const cR = canvas.getBoundingClientRect();

  const pxToCmX = WALL_WIDTH_CM  / cR.width;
  const pxToCmY = WALL_HEIGHT_CM / wallRegionHeightPx(); // fal-rész magassága!

  const matKey = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const mat = MATERIALS[matKey] || MATERIALS.birch;

  const rows = [];
  rows.push("Típus;Név;Szélesség (cm);Magasság (cm);Anyag;Szín;Forrás");

  const titleItem = document.getElementById("title-item");
  const tR = titleItem.getBoundingClientRect();

  rows.push([
    "Felirat",
    csvEsc(normalizeEllipsisSpacing(getTitleTextRaw() || "Felirat")),
    ((tR.width  * pxToCmX).toFixed(2)).replace(".", ","),
    ((tR.height * pxToCmY).toFixed(2)).replace(".", ","),
    matKey,
    mat.titleColor,
    csvEsc("font:AlwaysInMyHeart (FIX)")
  ].join(";"));

  const icons = document.querySelectorAll("#items-layer .icon-item");
  icons.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const name = el.dataset.alt || `Ikon ${idx + 1}`;
    rows.push([
      "Ikon",
      csvEsc(name),
      ((r.width  * pxToCmX).toFixed(2)).replace(".", ","),
      ((r.height * pxToCmY).toFixed(2)).replace(".", ","),
      matKey,
      mat.iconEngrave,
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

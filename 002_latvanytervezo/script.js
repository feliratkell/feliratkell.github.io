/*****************************************************************
 * FELIRAT LÁTVÁNYTERVEZŐ – v1.1 (JAVÍTOTT)
 * - Felirat valós cm magasság (stabil kalibrációval) + ZÁROLT méret
 * - Enter → új sor (textarea)
 * - Ablak / mobil forgatás esetén újrakalibrál
 *****************************************************************/

const CANVAS_CM_WIDTH  = 31.0;
const CANVAS_CM_HEIGHT = 22.5;

// Felirat magasság ZÁROLVA (automata: sorok száma alapján)
const TITLE_CM_SINGLELINE = 11.1; // 1 soros felirat célmagasság (cm)
const TITLE_CM_MULTILINE  = 8.3;  // 2+ soros felirat célmagasság (cm)

// Stabil kalibráció (tartalmaz ékezeteket + leszálló szárakat)
const CALIBRATION_TEXT_SINGLE = "ÁáÉéÍíÓóÖöŐőÚúÜüŰűgjpqy";
const CALIBRATION_TEXT_MULTI  = "ÁáÉéŐőÜüŰűgjpqy\nÁáÉéŐőÜüŰűgjpqy";

// Anyag
const MATERIALS = {
  birch: { textureUrl: "assets/textures/birch.png",     engrave: "#8A6A3B" },
  hdf:   { textureUrl: "assets/textures/hdf-white.png", engrave: "#2B2B2B" }
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

// Felirat mód: "text" vagy "svg"
let titleMode = "text"; // "text" | "svg"
let titleSvgSrc = "";   // ha sablon SVG

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
  lockTitleHeightByLines(); // induló fix magasság

  // JAVÍTÁS: resize/orientation esetén újrakalibrálunk
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      lockTitleHeightByLines();
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

function pxPerCmY() {
  const r = canvasRect();
  return r.height / CANVAS_CM_HEIGHT;
}

function setSelected(el) {
  if (selectedItem) selectedItem.classList.remove("selected");
  selectedItem = el;
  if (selectedItem) selectedItem.classList.add("selected");
}

function getLinesCount(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  return Math.max(1, t.split("\n").length);
}

function getTitleTextRaw() {
  const el = document.getElementById("title-input");
  return (el?.value ?? "").replace(/\r\n/g, "\n");
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

  canvas.style.setProperty("--mat-texture", `url("${mat.textureUrl}")`);
  canvas.style.setProperty("--engrave", mat.engrave);

  // ikonok gravír
  document.querySelectorAll("#items-layer .icon-item").forEach(el => {
    applySvgEngraveColor(el, mat.engrave);
    el.dataset.material = matKey;
    el.dataset.engrave = mat.engrave;
  });

  // felirat meta
  const title = document.getElementById("title-item");
  if (title) {
    title.dataset.material = matKey;
    title.dataset.engrave = mat.engrave;
  }

  // SVG felirat szín
  if (titleMode === "svg") {
    const wrap = document.getElementById("title-svg-wrap");
    if (wrap) applySvgEngraveColor(wrap, mat.engrave);
  }
}

/*****************************************************************
 * Felirat (TEXT + ENTER törés + FIX cm magasság)
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
  titleText.textContent = input.value;

  if (tpl) {
    tpl.addEventListener("change", async () => {
      if (!tpl.value) return;
      const val = tpl.value;

      if (val.startsWith("svg:")) {
        const src = val.slice(4);
        await setTitleAsSvg(src);
      } else {
        setTitleAsText(val);
        input.value = val; // UI sync
      }

      tpl.value = "";
    });
  }

  input.addEventListener("input", () => {
    if (titleMode !== "text") setTitleAsText(getTitleTextRaw() || "Felirat");
    else setTitleAsText(getTitleTextRaw() || "Felirat");
  });

  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      centerTitle();
      updateTitleSizeLabel();
    });
  }

  makeDraggable(titleItem);

  requestAnimationFrame(() => lockTitleHeightByLines());
}

// TEXT mód
function setTitleAsText(text) {
  titleMode = "text";
  titleSvgSrc = "";

  const titleText = document.getElementById("title-text");
  const titleItem = document.getElementById("title-item");

  const oldWrap = document.getElementById("title-svg-wrap");
  if (oldWrap) oldWrap.remove();

  titleText.style.display = "";
  titleText.textContent = String(text || "Felirat");

  lockTitleHeightByLines();
  updateTitleSizeLabel();
  titleItem.dataset.titleMode = "text";
}

// SVG mód
async function setTitleAsSvg(svgUrl) {
  titleMode = "svg";
  titleSvgSrc = svgUrl;

  const titleItem = document.getElementById("title-item");
  const titleText = document.getElementById("title-text");

  titleText.style.display = "none";

  const oldWrap = document.getElementById("title-svg-wrap");
  if (oldWrap) oldWrap.remove();

  const svgText = await fetchSvg(svgUrl);

  const wrap = document.createElement("div");
  wrap.id = "title-svg-wrap";
  wrap.className = "title-svg-wrap";
  wrap.innerHTML = svgText;

  const matKey = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const engrave = (MATERIALS[matKey] || MATERIALS.birch).engrave;
  applySvgEngraveColor(wrap, engrave);

  titleItem.appendChild(wrap);

  requestAnimationFrame(() => {
    fitTitleSvgToCmHeight(TITLE_CM_SINGLELINE);
    updateTitleSizeLabel();
  });

  titleItem.dataset.titleMode = "svg";
  titleItem.dataset.titleSvg = svgUrl;
}

// FIX cm magasság (sorok alapján)
function lockTitleHeightByLines() {
  if (titleMode === "svg") return;

  const raw = getTitleTextRaw();
  const lines = getLinesCount(raw);
  const targetCm = (lines <= 1) ? TITLE_CM_SINGLELINE : TITLE_CM_MULTILINE;

  fitTitleToCmHeightStable(targetCm, lines);
}

// Stabil illesztés: kalibrációs szöveg alapján
function fitTitleToCmHeightStable(cmTarget, lines) {
  const titleText = document.getElementById("title-text");
  const titleItem = document.getElementById("title-item");
  const ppcm = pxPerCmY();
  const targetPx = cmTarget * ppcm;

  const realText = titleText.textContent;

  titleText.textContent = (lines <= 1) ? CALIBRATION_TEXT_SINGLE : CALIBRATION_TEXT_MULTI;
  titleText.style.fontSize = "100px";

  const h100 = titleItem.getBoundingClientRect().height || 100;
  const alpha = h100 / 100;

  let needed = targetPx / (alpha || 1);
  needed = clamp(needed, 12, 260);

  titleText.style.fontSize = `${needed}px`;
  titleText.textContent = realText;

  updateTitleSizeLabel();
}

// SVG felirat magasság állítás (wrap skálázással)
function fitTitleSvgToCmHeight(cmTarget) {
  const wrap = document.getElementById("title-svg-wrap");
  if (!wrap) return;

  const ppcm = pxPerCmY();
  const targetPx = cmTarget * ppcm;

  wrap.style.transform = "none";
  wrap.style.transformOrigin = "top left";

  const hNow = wrap.getBoundingClientRect().height || 1;
  const scale = targetPx / hNow;

  wrap.style.transform = `scale(${scale})`;
}

/*****************************************************************
 * Pozicionálás + kijelzett cm
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

  const rC = canvas.getBoundingClientRect();
  const rT = title.getBoundingClientRect();
  const cm = (rT.height / rC.height) * CANVAS_CM_HEIGHT;

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
  const engrave = (MATERIALS[matKey] || MATERIALS.birch).engrave;

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = svgText;

  el.dataset.src = meta.src || "";
  el.dataset.alt = meta.alt || "";
  el.dataset.material = matKey;
  el.dataset.engrave = engrave;

  const svg = el.querySelector("svg");
  const ppcm = pxPerCmY();
  const size = computeSvgSizePx(svg, ppcm);

  el.style.width  = `${size.w}px`;
  el.style.height = `${size.h}px`;

  const rC = canvas.getBoundingClientRect();
  el.style.left = `${(rC.width - size.w) / 2}px`;
  el.style.top  = `${(rC.height - size.h) / 2}px`;

  applySvgEngraveColor(el, engrave);

  itemsLayer.appendChild(el);
  makeDraggable(el);
  setSelected(el);
}

function computeSvgSizePx(svg, pxPerCm) {
  const fallbackH = 4 * pxPerCm;
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
    h: el.offsetHeight,
    material: el.dataset.material || "birch",
    engrave: el.dataset.engrave || MATERIALS.birch.engrave
  };

  if (base.type === "title") {
    base.titleMode = titleMode;
    base.text = getTitleTextRaw() || "Felirat";
    base.svg = titleSvgSrc || "";
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

  const el = document.createElement("div");
  el.className = "item icon-item";
  el.innerHTML = data.svg;

  el.style.width  = `${data.w}px`;
  el.style.height = `${data.h}px`;
  el.style.left   = `${clamp(data.left, 0, canvasRect().width  - data.w)}px`;
  el.style.top    = `${clamp(data.top,  0, canvasRect().height - data.h)}px`;

  el.dataset.src = data.src || "";
  el.dataset.alt = data.alt || "Ikon";
  el.dataset.material = data.material || "birch";
  el.dataset.engrave  = data.engrave  || MATERIALS.birch.engrave;

  const matKey  = document.querySelector('input[name="material"]:checked')?.value || "birch";
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
 * CSV export (méretek)
 *****************************************************************/
function initCsvExport() {
  const btn = document.getElementById("export-csv-btn");
  if (!btn) return;
  btn.addEventListener("click", () => exportCsv());
}

function exportCsv() {
  const canvas = document.getElementById("canvas");
  const cR = canvas.getBoundingClientRect();

  const pxToCmX = CANVAS_CM_WIDTH  / cR.width;
  const pxToCmY = CANVAS_CM_HEIGHT / cR.height;

  const matKey = document.querySelector('input[name="material"]:checked')?.value || "birch";
  const engrave = (MATERIALS[matKey] || MATERIALS.birch).engrave;

  const rows = [];
  rows.push("Típus;Név;Szélesség (cm);Magasság (cm);Anyag;Gravír szín;Forrás");

  const titleItem = document.getElementById("title-item");
  const tR = titleItem.getBoundingClientRect();

  const titleName =
    (titleMode === "svg")
      ? `SVG felirat (${titleSvgSrc || "n/a"})`
      : (getTitleTextRaw() || "Felirat");

  rows.push([
    "Felirat",
    csvEsc(titleName),
    ((tR.width  * pxToCmX).toFixed(2)).replace(".", ","),
    ((tR.height * pxToCmY).toFixed(2)).replace(".", ","),
    matKey,
    engrave,
    csvEsc(titleMode === "svg" ? titleSvgSrc : "font:AlwaysInMyHeart")
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
      engrave,
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

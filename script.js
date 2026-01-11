// script.js
(() => {
  const BG_PATH = "assets/backgrounds/white.png";
  const BIRCH_TEX = "assets/textures/birch.png";
  const HDF_TEX = "assets/textures/hdf-white.png";

  const stage = document.getElementById("stage");
  const bgCanvas = document.getElementById("bgCanvas");
  const ctx = bgCanvas.getContext("2d", { alpha: true });

  const overlay = document.getElementById("overlay");

  const wallColorSel = document.getElementById("wallColor");
  const zoomSlider = document.getElementById("zoom");
  const zoomLabel = document.getElementById("zoomLabel");
  const resetViewBtn = document.getElementById("resetView");

  const startCalibBtn = document.getElementById("startCalib");
  const calibActions = document.getElementById("calibActions");
  const saveCalibBtn = document.getElementById("saveCalib");
  const cancelCalibBtn = document.getElementById("cancelCalib");
  const pxPerCmLabel = document.getElementById("pxPerCmLabel");

  const calibLayer = document.getElementById("calibLayer");
  const calibLine = document.getElementById("calibLine");
  const calibTop = document.getElementById("calibTop");
  const calibBottom = document.getElementById("calibBottom");

  const materialSel = document.getElementById("material");

  const textObj = document.getElementById("textObj");
  const textInner = document.getElementById("textInner");
  const textInput = document.getElementById("textInput");
  const textCm = document.getElementById("textCm");
  const textCmLabel = document.getElementById("textCmLabel");

  const addBirdsBtn = document.getElementById("addBirds");
  const clearAllBtn = document.getElementById("clearAll");

  // --- View state (world coords = image pixel coords of base background)
  const view = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    panOrig: { x: 0, y: 0 },
  };

  // Calibration
  const calib = {
    enabled: false,
    pxPerCm: null,         // number
    top: { x: 240, y: 350 },    // world coords (image px)
    bottom: { x: 240, y: 620 }, // world coords (image px)
    dragging: null, // "top" | "bottom"
  };

  // Background image + derived wall mask (alpha)
  const bg = {
    img: new Image(),
    w: 0,
    h: 0,
    wallMask: null, // ImageData alpha mask in bg native resolution
    wallMaskCanvas: document.createElement("canvas"),
    wallMaskCtx: null,
  };

  bg.wallMaskCtx = bg.wallMaskCanvas.getContext("2d", { willReadFrequently: true });

  const COLORS = {
    white: null,
    beige: "#e8d2b8",
    gray: "#7f8188",
    green: "#3f5e57",
    pink: "#e5b7c5",
  };

  // Objects (text + patterns)
  const objects = {
    items: [],
  };

  // Always keep text as first object
  const textItem = {
    id: "text",
    el: textObj,
    inner: textInner,
    type: "text",
    x: 900, y: 190,         // world coords
    cmHeight: parseFloat(textCm.value),
    dragging: false,
    dragOffset: { x: 0, y: 0 },
  };

  objects.items.push(textItem);

  // ---------- Helpers: stage sizing & transforms ----------
  function resizeCanvasToStage() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // clamp to keep perf
    bgCanvas.width = Math.round(r.width * dpr);
    bgCanvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
    layoutObjects();
    layoutCalib();
  }

  function stageToWorld(sx, sy) {
    // stage coords (CSS pixels) -> world (image px)
    const r = stage.getBoundingClientRect();
    const x = sx - r.left;
    const y = sy - r.top;
    const wx = (x - view.panX) / view.zoom;
    const wy = (y - view.panY) / view.zoom;
    return { x: wx, y: wy };
  }

  function worldToStage(wx, wy) {
    // world -> stage coords (CSS px)
    const x = wx * view.zoom + view.panX;
    const y = wy * view.zoom + view.panY;
    return { x, y };
  }

  function clampPan() {
    // Keep something on screen, but don’t hard clamp too aggressive.
    // Use background bounds in stage coords.
    const r = stage.getBoundingClientRect();
    const bgW = bg.w * view.zoom;
    const bgH = bg.h * view.zoom;

    // if bg smaller than stage: center it
    if (bgW <= r.width) view.panX = (r.width - bgW) / 2;
    else {
      const minX = r.width - bgW;
      const maxX = 0;
      view.panX = Math.min(maxX, Math.max(minX, view.panX));
    }

    if (bgH <= r.height) view.panY = (r.height - bgH) / 2;
    else {
      const minY = r.height - bgH;
      const maxY = 0;
      view.panY = Math.min(maxY, Math.max(minY, view.panY));
    }
  }

  // ---------- Background: build wall mask from base image ----------
  function buildWallMask() {
    // Goal: detect "wall" pixels from the white base image, without extra file.
    // Heuristic: wall is bright & low-chroma; furniture edges darker & higher contrast.
    const c = bg.wallMaskCanvas;
    c.width = bg.w;
    c.height = bg.h;

    const tmp = document.createElement("canvas");
    tmp.width = bg.w;
    tmp.height = bg.h;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });

    tctx.drawImage(bg.img, 0, 0, bg.w, bg.h);
    const imgData = tctx.getImageData(0, 0, bg.w, bg.h);
    const d = imgData.data;

    const mask = tctx.createImageData(bg.w, bg.h);
    const m = mask.data;

    // thresholds tuned for your current white nursery photo
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b); // 0..255
      const chroma = max - min; // 0..255

      // wall: very bright, low chroma, and not too close to strong edges
      // alpha base:
      let a = 0;

      if (lum > 170 && chroma < 22) a = 255;
      else if (lum > 150 && chroma < 18) a = 200;

      // soften edges: reduce alpha for darker pixels
      if (lum < 165) a = Math.max(0, a - (165 - lum) * 3);

      // keep alpha lower near non-white areas:
      if (chroma > 25) a = Math.max(0, a - (chroma - 25) * 6);

      // write mask as white with alpha
      m[i] = 255;
      m[i + 1] = 255;
      m[i + 2] = 255;
      m[i + 3] = Math.max(0, Math.min(255, a));
    }

    // light blur to avoid harsh mask edges
    // simple box blur pass
    const blurred = boxBlurAlpha(mask, bg.w, bg.h, 2);

    bg.wallMaskCtx.putImageData(blurred, 0, 0);
    bg.wallMask = blurred;
  }

  function boxBlurAlpha(imageData, w, h, radius) {
    const src = imageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;

    // copy RGB as white
    for (let i = 0; i < dst.length; i += 4) {
      dst[i] = 255; dst[i + 1] = 255; dst[i + 2] = 255; dst[i + 3] = 0;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let ky = -radius; ky <= radius; ky++) {
          const yy = y + ky;
          if (yy < 0 || yy >= h) continue;
          for (let kx = -radius; kx <= radius; kx++) {
            const xx = x + kx;
            if (xx < 0 || xx >= w) continue;
            const idx = (yy * w + xx) * 4 + 3;
            sum += src[idx];
            count++;
          }
        }
        const a = sum / count;
        const di = (y * w + x) * 4 + 3;
        dst[di] = a;
      }
    }
    return out;
  }

  // ---------- Rendering ----------
  function render() {
    if (!bg.w || !bg.h) return;

    // clear
    const r = stage.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);

    clampPan();

    // draw base image with view transform
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(view.zoom, view.zoom);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bg.img, 0, 0, bg.w, bg.h);

    // wall color overlay (masked), using multiply for natural shading
    const key = wallColorSel.value;
    const color = COLORS[key];

    if (color) {
      // Create colored layer at world scale, apply mask, then blend multiply.
      // 1) draw solid color
      // 2) destination-in with wall mask alpha
      // 3) multiply onto base
      const tmp = document.createElement("canvas");
      tmp.width = bg.w;
      tmp.height = bg.h;
      const tctx = tmp.getContext("2d");

      tctx.fillStyle = color;
      tctx.fillRect(0, 0, bg.w, bg.h);

      // mask it
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(bg.wallMaskCanvas, 0, 0);

      // blend on top
      ctx.globalAlpha = 0.55; // strength of wall tint
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(tmp, 0, 0);

      // reset composite
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
  }

  function layoutObjects() {
    // position & scale text and patterns based on pxPerCm
    for (const it of objects.items) {
      const p = worldToStage(it.x, it.y);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;

      // scale by cm -> px with calibration if exists, else fallback
      const pxPerCm = calib.pxPerCm || 12; // fallback (reasonable)
      const targetPxHeight = it.cmHeight * pxPerCm;
      // map "height" to font-size for text; for icons use transform scale
      if (it.type === "text") {
        it.inner.style.fontSize = `${Math.max(14, targetPxHeight)}px`;
      } else {
        // icons: store basePx = 180, scale to target height
        const base = it.basePx || 180;
        const s = targetPxHeight / base;
        it.inner.style.transform = `scale(${s})`;
      }

      applyMaterialFinish(it);
    }
  }

  function applyMaterialFinish(it) {
    const mat = materialSel.value;

    // Common “engraved” look: texture fill + subtle inner shadow
    if (mat === "birch") {
      // birch: lighter brown engraving (like your “ludas”)
      it.inner.style.color = "transparent";
      it.inner.style.backgroundImage = `url("${BIRCH_TEX}")`;
      it.inner.style.backgroundSize = "cover";
      it.inner.style.backgroundPosition = "center";
      it.inner.style.webkitBackgroundClip = "text";
      it.inner.style.backgroundClip = "text";

      it.inner.style.textShadow =
        "0 0.6px 0 rgba(120,80,45,0.35), " +
        "0 1.2px 2px rgba(80,50,25,0.18)";

      it.inner.style.filter =
        "drop-shadow(0 1px 0 rgba(60,40,20,0.15))";
      it.inner.style.opacity = "0.95";
    } else {
      // white HDF: dark gray engraving, NOT black
      it.inner.style.color = "transparent";
      it.inner.style.backgroundImage = `url("${HDF_TEX}")`;
      it.inner.style.backgroundSize = "cover";
      it.inner.style.backgroundPosition = "center";
      it.inner.style.webkitBackgroundClip = "text";
      it.inner.style.backgroundClip = "text";

      it.inner.style.textShadow =
        "0 0.7px 0 rgba(35,35,35,0.35), " +
        "0 1.4px 2px rgba(0,0,0,0.12)";

      it.inner.style.filter =
        "drop-shadow(0 1px 0 rgba(0,0,0,0.10))";
      it.inner.style.opacity = "0.92";
    }
  }

  // ---------- Calibration UI ----------
  function layoutCalib() {
    if (!calib.enabled) return;

    const t = worldToStage(calib.top.x, calib.top.y);
    const b = worldToStage(calib.bottom.x, calib.bottom.y);

    calibTop.style.left = `${t.x - 17}px`;
    calibTop.style.top = `${t.y - 17}px`;

    calibBottom.style.left = `${b.x - 17}px`;
    calibBottom.style.top = `${b.y - 17}px`;

    const dx = b.x - t.x;
    const dy = b.y - t.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    const angle = Math.atan2(dy, dx);
    calibLine.style.left = `${t.x}px`;
    calibLine.style.top = `${t.y}px`;
    calibLine.style.height = `${len}px`;
    calibLine.style.transform = `rotate(${angle + Math.PI / 2}rad)`;
  }

  function updatePxPerCmLabel() {
    if (!calib.pxPerCm) {
      pxPerCmLabel.textContent = "— px / cm";
      return;
    }
    pxPerCmLabel.textContent = `${calib.pxPerCm.toFixed(2)} px / cm`;
  }

  function computePxPerCmFromHandles() {
    const dx = calib.bottom.x - calib.top.x;
    const dy = calib.bottom.y - calib.top.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    return distPx / 70.0;
  }

  // ---------- Drag: pan vs object drag vs calib drag ----------
  function hitTestObject(target) {
    for (const it of objects.items) {
      if (it.el === target || it.el.contains(target)) return it;
    }
    return null;
  }

  function pointerPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function enablePointerCapture(el, e) {
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  // Stage pointer events (pan on empty wall)
  stage.addEventListener("pointerdown", (e) => {
    const hit = hitTestObject(e.target);

    // calibration handles take priority
    if (calib.enabled && (e.target === calibTop || e.target === calibBottom)) {
      calib.dragging = (e.target === calibTop) ? "top" : "bottom";
      enablePointerCapture(stage, e);
      return;
    }

    if (hit) {
      hit.dragging = true;
      const w = stageToWorld(e.clientX, e.clientY);
      hit.dragOffset.x = w.x - hit.x;
      hit.dragOffset.y = w.y - hit.y;
      enablePointerCapture(stage, e);
      return;
    }

    // else pan
    view.isPanning = true;
    view.panStart = pointerPos(e);
    view.panOrig = { x: view.panX, y: view.panY };
    enablePointerCapture(stage, e);
  });

  stage.addEventListener("pointermove", (e) => {
    // calibration dragging
    if (calib.dragging) {
      const w = stageToWorld(e.clientX, e.clientY);
      if (calib.dragging === "top") {
        calib.top.x = w.x;
        calib.top.y = w.y;
      } else {
        calib.bottom.x = w.x;
        calib.bottom.y = w.y;
      }
      layoutCalib();
      return;
    }

    // object dragging
    const draggingObj = objects.items.find(it => it.dragging);
    if (draggingObj) {
      const w = stageToWorld(e.clientX, e.clientY);
      draggingObj.x = w.x - draggingObj.dragOffset.x;
      draggingObj.y = w.y - draggingObj.dragOffset.y;
      layoutObjects();
      return;
    }

    // panning
    if (view.isPanning) {
      const p = pointerPos(e);
      view.panX = view.panOrig.x + (p.x - view.panStart.x);
      view.panY = view.panOrig.y + (p.y - view.panStart.y);
      render();
      layoutObjects();
      layoutCalib();
    }
  });

  stage.addEventListener("pointerup", () => {
    view.isPanning = false;
    for (const it of objects.items) it.dragging = false;
    calib.dragging = null;
  });

  // ---------- UI controls ----------
  zoomSlider.addEventListener("input", () => {
    view.zoom = parseFloat(zoomSlider.value);
    zoomLabel.textContent = `${view.zoom.toFixed(2)}×`;
    render();
    layoutObjects();
    layoutCalib();
  });

  resetViewBtn.addEventListener("click", () => {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    zoomSlider.value = "1";
    zoomLabel.textContent = "1.00×";
    render();
    layoutObjects();
    layoutCalib();
  });

  wallColorSel.addEventListener("change", () => {
    render();
  });

  materialSel.addEventListener("change", () => {
    layoutObjects();
  });

  textInput.addEventListener("input", () => {
    textInner.textContent = textInput.value;
  });

  textCm.addEventListener("input", () => {
    const v = parseFloat(textCm.value);
    textItem.cmHeight = v;
    textCmLabel.textContent = `${v.toFixed(1)} cm`;
    layoutObjects();
  });

  startCalibBtn.addEventListener("click", () => {
    calib.enabled = true;
    calibLayer.classList.remove("hidden");
    calibActions.classList.remove("hidden");
    // put handles roughly around left cabinet area (world coords)
    // you can move them precisely
    calib.top = { x: 260, y: 385 };
    calib.bottom = { x: 260, y: 655 };
    layoutCalib();
  });

  cancelCalibBtn.addEventListener("click", () => {
    calib.enabled = false;
    calibLayer.classList.add("hidden");
    calibActions.classList.add("hidden");
    calib.dragging = null;
  });

  saveCalibBtn.addEventListener("click", () => {
    calib.pxPerCm = computePxPerCmFromHandles();
    updatePxPerCmLabel();

    calib.enabled = false;
    calibLayer.classList.add("hidden");
    calibActions.classList.add("hidden");
    calib.dragging = null;

    layoutObjects();
  });

  // Patterns: simple “birds” as inline SVG (single piece)
  function createBirdsSVG() {
    // One SVG containing 3 birds (single element, easy to recolor/finish)
    return `
      <svg width="180" height="110" viewBox="0 0 180 110" xmlns="http://www.w3.org/2000/svg">
        <path d="M43 62c10-10 22-15 34-15 10 0 18 4 24 10-8 3-16 7-23 12-10 7-18 14-23 22-6-3-10-9-12-14z" fill="currentColor"/>
        <path d="M88 52c6-6 14-9 21-9 6 0 11 2 15 6-5 2-10 4-15 7-6 4-11 9-14 14-4-2-6-6-7-9z" fill="currentColor" opacity="0.95"/>
        <path d="M120 70c12-12 26-18 40-18 12 0 22 5 29 13-10 3-20 9-30 15-14 9-26 19-32 30-8-4-14-12-17-20z" fill="currentColor"/>
      </svg>
    `;
  }

  function addBirds() {
    const wrap = document.createElement("div");
    wrap.className = "obj";
    wrap.style.transform = "translate(-50%, -50%)";
    wrap.style.left = "62%";
    wrap.style.top = "46%";

    const inner = document.createElement("div");
    inner.className = "objInner";
    inner.style.fontSize = "1px"; // not used
    inner.innerHTML = createBirdsSVG();
    inner.style.transformOrigin = "top left";

    wrap.appendChild(inner);
    overlay.appendChild(wrap);

    const item = {
      id: `birds-${crypto.randomUUID()}`,
      el: wrap,
      inner: inner,
      type: "icon",
      x: 860,
      y: 420,
      cmHeight: 10.0,
      basePx: 180,
      dragging: false,
      dragOffset: { x: 0, y: 0 },
    };

    // make SVG use currentColor and set a neutral engraving tone (JS will texture it)
    inner.style.color = "#6e6e6e";

    objects.items.push(item);
    layoutObjects();
  }

  addBirdsBtn.addEventListener("click", () => addBirds());

  clearAllBtn.addEventListener("click", () => {
    // keep only text
    objects.items = [textItem];
    // remove all other DOM
    [...overlay.querySelectorAll(".obj")].forEach((el) => {
      if (el !== textObj) el.remove();
    });
    layoutObjects();
  });

  // ---------- Init ----------
  function centerInitialView() {
    const r = stage.getBoundingClientRect();
    // fit background into stage with contain, then center
    const scaleX = r.width / bg.w;
    const scaleY = r.height / bg.h;
    const scale = Math.min(scaleX, scaleY);
    view.zoom = 1; // keep slider logic; we center via pan
    // Set pan to center at zoom 1 with contain? We want image to fill stage; use cover-like:
    // But we want consistent and not clipped. We'll do "cover" at base by starting zoom to cover.
    const cover = Math.max(scaleX, scaleY);
    view.zoom = cover;
    zoomSlider.value = String(Math.min(3, Math.max(1, cover)));
    view.zoom = parseFloat(zoomSlider.value);
    zoomLabel.textContent = `${view.zoom.toFixed(2)}×`;

    // center
    const bgW = bg.w * view.zoom;
    const bgH = bg.h * view.zoom;
    view.panX = (r.width - bgW) / 2;
    view.panY = (r.height - bgH) / 2;
    clampPan();
  }

  bg.img.onload = () => {
    bg.w = bg.img.naturalWidth;
    bg.h = bg.img.naturalHeight;

    buildWallMask();
    resizeCanvasToStage();
    centerInitialView();
    render();
    layoutObjects();
    updatePxPerCmLabel();
  };

  bg.img.src = BG_PATH;

  window.addEventListener("resize", () => {
    resizeCanvasToStage();
    render();
    layoutObjects();
    layoutCalib();
  });
})();

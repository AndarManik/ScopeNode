export const newStats = (app) => {
  const SAMPLE_MS = 200; // record datapoints
  const RENDER_MS = 1000; // update labels (numbers)
  const HISTORY_MS = 15000;

  const CANVAS_W = 120; // CSS/display pixels
  const CANVAS_H = 40; // CSS/display pixels
  const CANVAS_SCALE = 3; // backing-store scale for crisp lines

  const stats = document.getElementById("Stats");
  stats.innerHTML = "";
  stats.log = new Map();

  // horizontal stack of entries
  stats.style.display = "flex";
  stats.style.flexDirection = "row";
  stats.style.alignItems = "flex-start";
  stats.style.gap = "8px";

  const historyLen = Math.max(2, Math.ceil(HISTORY_MS / SAMPLE_MS));

  // key -> entry
  const entries = new Map();

  // ====== visibility toggle (hotkey "3") ======
  let shown = true;
  const applyShown = () => {
    stats.style.display = shown ? "flex" : "none";
  };
  const toggleShown = () => {
    shown = !shown;
    applyShown();
  };
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;

      if (e.code === "Digit3") toggleShown();
    },
    { passive: true }
  );
  applyShown();

  // ====== CSS caching (values may change at runtime; we just avoid per-point reads) ======
  let lineColor = "rgba(0,0,0,0)";
  const refreshCSS = () => {
    const cs = getComputedStyle(document.documentElement);
    lineColor = cs.getPropertyValue("--light").trim() || lineColor;
  };

  // ====== small DOM pool to reuse wrappers if keys come/go ======
  const wrapperPool = [];
  const obtainWrapper = () =>
    wrapperPool.pop() || document.createElement("div");
  const releaseWrapper = (w) => {
    w.replaceChildren();
    wrapperPool.push(w);
  };

  const makeEntry = (key) => {
    const wrapper = obtainWrapper();
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "flex-start";

    const label = document.createElement("div");
    label.style.fontSize = "16px";

    const canvas = document.createElement("canvas");

    // Display size (CSS pixels)
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    canvas.style.display = "block";

    // Backing store size (device pixels)
    canvas.width = Math.max(1, Math.floor(CANVAS_W * CANVAS_SCALE));
    canvas.height = Math.max(1, Math.floor(CANVAS_H * CANVAS_SCALE));

    wrapper.appendChild(label);
    wrapper.appendChild(canvas);
    stats.appendChild(wrapper);

    const ctx = canvas.getContext("2d");

    // Draw in CSS-pixel coordinates, scaled into the backing store.
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);

    // ring buffer
    const buf = new Float32Array(historyLen);
    entries.set(key, {
      key,
      wrapper,
      label,
      canvas,
      ctx,
      buf,
      head: 0,
      size: 0,
      lastValue: 0,
    });
  };

  const removeEntry = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    entry.wrapper.remove();
    releaseWrapper(entry.wrapper);
    entries.delete(key);
  };

  const pruneMissing = () => {
    for (const key of entries.keys()) {
      if (!stats.log.has(key)) removeEntry(key);
    }
  };

  const sampleIntoRing = (entry, value) => {
    entry.lastValue = value;

    entry.buf[entry.head] = value;
    entry.head = (entry.head + 1) % historyLen;
    if (entry.size < historyLen) entry.size++;
  };

  const drawGraph = (entry) => {
    const { ctx, canvas, buf, head, size } = entry;

    const EMA_ALPHA = 0.18;
    const ROBUST_RANGE = true;
    const STD_K = 2.5;
    const PAD_PX = 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);

    if (size < 2) return;

    const oldest = size === historyLen ? head : 0;

    // range
    let min = Infinity;
    let max = -Infinity;

    // Welford mean/std
    let mean = 0;
    let m2 = 0;
    let n = 0;

    for (let i = 0; i < size; i++) {
      const v = buf[(oldest + i) % historyLen];

      if (v < min) min = v;
      if (v > max) max = v;

      n++;
      const d = v - mean;
      mean += d / n;
      m2 += d * (v - mean);
    }

    if (ROBUST_RANGE && n > 2) {
      const variance = m2 / (n - 1);
      const std = Math.sqrt(Math.max(0, variance));
      if (std > 0) {
        const lo = mean - STD_K * std;
        const hi = mean + STD_K * std;

        min = Math.max(min, lo);
        max = Math.min(max, hi);

        if (!(max > min)) {
          min = Math.min(min, mean - 1);
          max = Math.max(max, mean + 1);
        }
      }
    }

    if (!(max > min)) max = min + 1;

    const minP = min;
    const maxP = max;
    const yTop = PAD_PX;
    const yBot = CANVAS_H - PAD_PX;
    const ySpan = Math.max(1e-9, yBot - yTop);

    const toY = (v) => {
      if (v < minP) v = minP;
      else if (v > maxP) v = maxP;
      const t = (v - minP) / (maxP - minP);
      return yBot - t * ySpan;
    };

    const denom = Math.max(1, historyLen - 1);
    const start = historyLen - size;

    let ema = buf[oldest];
    let started = false;

    ctx.strokeStyle = lineColor;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    for (let i = 0; i < size; i++) {
      const v = buf[(oldest + i) % historyLen];
      ema = ema + EMA_ALPHA * (v - ema);

      const slot = start + i;
      const x = (slot / denom) * CANVAS_W;
      const y = toY(ema);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // ====== loops ======

  // 1) sampling loop (collect data at SAMPLE_MS)
  const sampleTick = () => {
    if (!shown) {
      setTimeout(sampleTick, SAMPLE_MS);
      return;
    }

    for (const [key, value] of stats.log.entries()) {
      let entry = entries.get(key);
      if (!entry) {
        makeEntry(key);
        entry = entries.get(key);
      }
      sampleIntoRing(entry, value);
    }

    pruneMissing();
    setTimeout(sampleTick, SAMPLE_MS);
  };

  // 2) graph loop (draw graph fast, as it collects data)
  const graphTick = () => {
    if (!shown) {
      setTimeout(graphTick, SAMPLE_MS);
      return;
    }

    // in case --light changes while shown, but without per-point reads
    // (this is cheap; keep it here if you want the graph color to react quickly)
    refreshCSS();

    for (const entry of entries.values()) drawGraph(entry);

    setTimeout(graphTick, SAMPLE_MS);
  };

  // 3) label loop (numbers update slower)
  const renderTick = () => {
    if (!shown) {
      setTimeout(renderTick, RENDER_MS);
      return;
    }

    // If you prefer color updates to be slow (instead of graphTick),
    // move refreshCSS() here and remove it from graphTick.
    // refreshCSS();

    for (const entry of entries.values()) {
      entry.label.textContent = `${entry.key}: ${
        Math.round(10 * entry.lastValue) / 10
      }`;
    }

    setTimeout(renderTick, RENDER_MS);
  };

  sampleTick();
  graphTick();
  renderTick();

  stats.show = () => {
    shown = true;
    applyShown();
  };
  stats.hide = () => {
    shown = false;
    applyShown();
  };
  stats.toggle = toggleShown;
  stats.hide();

  return stats;
};

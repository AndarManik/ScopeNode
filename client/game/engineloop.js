import { render } from "./render.js";
import { update } from "./update.js";

export const startEngine = (game, app, team1, team2) => {
  const { renderSettings } = game;

  let diag = false;
  const DIAG_SAMPLE_MS = 2000;
  const MIN_GOOD_FPS = 50;
  const samplesMs = [];
  let elapsedMs = 0;

  if (renderSettings.firstRender) {
    diag = true;
    renderSettings.scale = 2;
    renderSettings.glowEnabled = true;
    renderSettings.firstRender = false;
  }

  let isFocused = true;
  let last = performance.now();
  let rafId = null;
  let timeoutId = null;

  const getDesiredIntervalMs = () => {
    const cap = renderSettings.fpsCap;
    if (cap == null || cap < 0) return 0;
    return 1000 / cap;
  };

  const scheduleNext = () => {
    const interval = getDesiredIntervalMs();
    const preferRAF =
      isFocused &&
      renderSettings.vSync &&
      typeof requestAnimationFrame === "function";
    // Some browsers don't even have rAF

    if (preferRAF) rafId = requestAnimationFrame(tick);
    else {
      const delay = interval > 0 ? interval : 0;
      timeoutId = setTimeout(tick, delay);
    }
  };

  const tick = (now = performance.now()) => {
    if (game.isDead) return;

    const deltaMs = now - last;
    const delta = deltaMs / 1000;
    const desiredInterval = getDesiredIntervalMs();

    if (renderSettings.vSync && desiredInterval > 0)
      if (deltaMs < desiredInterval) return scheduleNext();

    last = now;

    if (diag && isFocused && deltaMs > 0) {
      samplesMs.push(deltaMs);
      elapsedMs += deltaMs;

      if (elapsedMs >= DIAG_SAMPLE_MS) {
        const sorted = samplesMs.slice().sort((a, b) => a - b);
        const medianDt = sorted[Math.floor(sorted.length / 2)];
        const fps = 1000 / medianDt;

        if (fps < MIN_GOOD_FPS) {
          renderSettings.scale = 1;
          renderSettings.glowEnabled = false;
        } else {
          renderSettings.scale = 2;
          renderSettings.glowEnabled = true;
        }
        diag = false;
      }
    }

    try {
      update(game, app, delta, team1, team2);
    } catch (err) {
      console.error("ENGINE UPDATE ERROR:", err);
    }

    try {
      render(game, team1, team2);
    } catch (err) {
      console.error("ENGINE RENDER ERROR:", err);
    }

    app.stats.log.set("FPS", Math.round(1000 / deltaMs));

    scheduleNext();
  };

  window.addEventListener("focus", () => {
    if (isFocused) return;
    isFocused = true;
    clearTimeout(timeoutId);
    last = performance.now(); // reset timing
    scheduleNext();
  });

  window.addEventListener("blur", () => {
    if (!isFocused) return;
    isFocused = false;
    cancelAnimationFrame(rafId);
    clearTimeout(timeoutId);
    last = performance.now();
    scheduleNext();
  });

  scheduleNext();
};

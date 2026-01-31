import { render } from "./render.js";
import { update } from "./update.js";

// As well as starting the engine, if the settings doesn't have a performance test, it will conduct one.

const stages = [
  [0.25, false],
  [0.5, false],
  [0.75, false],
  [1, false],
  [1, true],
  [1.25, true],
  [1.5, true],
  [1.75, true],
  [2, true],
];

export const startEngine = (game, app, team1, team2) => {
  const { renderSettings } = game;

  let diag = false;
  let stage = 0;
  let fpsThreshold = 0;
  const samplesMs = [];
  const sampleCount = 30;
  const BASE_SAMPLE_COUNT = sampleCount * 2;
  const WARMUP_SAMPLES = 10;
  let totalSamples = 0;

  if (renderSettings.firstRender) {
    diag = true;
    renderSettings.firstRender = false;
    renderSettings.scale = stages[stage][0];
    renderSettings.glowEnabled = stages[stage][1];
  }

  let isFocused = true;
  let last = performance.now();
  let rafId = null;
  let timeoutId = null;

  const getDesiredIntervalMs = (cap = renderSettings.fpsCap) =>
    cap == null || cap < 0 ? 0 : 1000 / cap;

  const scheduleNext = () => {
    const interval = getDesiredIntervalMs();
    let preferRAF = isFocused;
    preferRAF &&= renderSettings.vSync;
    preferRAF &&= typeof requestAnimationFrame === "function";
    if (preferRAF) rafId = requestAnimationFrame(tick);
    else timeoutId = setTimeout(tick, interval > 0 ? interval : 0);
  };

  const diagnostic = (deltaMs) => {
    if (!diag || !isFocused || deltaMs <= 0 || !game.lightGraph) return;

    totalSamples++;
    if (totalSamples <= WARMUP_SAMPLES) return;

    samplesMs.push(deltaMs);
    const needed = stage === 0 ? BASE_SAMPLE_COUNT : sampleCount;
    if (samplesMs.length < needed) return;

    const sorted = [...samplesMs].sort((a, b) => a - b);
    const slowHalf = sorted.slice(Math.floor(sorted.length / 2));
    const median = slowHalf[Math.floor(slowHalf.length / 2)];

    if (stage === 0) fpsThreshold = 1.1 * median;
    console.log({ stage: stages[stage], median, fpsThreshold });

    if (stage > 0 && median > fpsThreshold) {
      renderSettings.scale = stages[stage - 1][0];
      renderSettings.glowEnabled = stages[stage - 1][1];
      diag = false;
      return;
    }

    if (stage === stages.length - 1) {
      diag = false;
      return;
    }

    stage++;
    renderSettings.scale = stages[stage][0];
    renderSettings.glowEnabled = stages[stage][1];
    samplesMs.length = 0;
  };

  const tick = (now = performance.now()) => {
    if (game.isDead) return;

    const deltaMs = now - last;
    const delta = deltaMs / 1000;
    const desiredInterval = getDesiredIntervalMs();

    if (renderSettings.vSync && desiredInterval > 0)
      if (deltaMs < desiredInterval) return scheduleNext();

    last = now;

    diagnostic(deltaMs);

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

  const focus = () => {
    if (game.isDead) window.removeEventListener("focus", focus);

    if (isFocused) return;
    isFocused = true;
    clearTimeout(timeoutId);
    last = performance.now(); // reset timing
    scheduleNext();
  };

  const blur = () => {
    if (game.isDead) window.removeEventListener("blur", blur);

    if (!isFocused) return;
    isFocused = false;
    cancelAnimationFrame(rafId);
    clearTimeout(timeoutId);
    last = performance.now();
    scheduleNext();
  };

  window.addEventListener("focus", focus);
  window.addEventListener("blur", blur);

  scheduleNext();
};

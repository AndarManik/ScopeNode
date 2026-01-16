const V = "3";
export const addUserSettings = (app) => {
  const version = localStorage.getItem("version");
  if (version != V) {
    localStorage.clear();
    localStorage.setItem("version", V);
  }

  app.name = localStorage.getItem("name");

  const hasRenderScale = localStorage.getItem("render.scale") !== null;
  const hasGlowEnabled = localStorage.getItem("render.glowEnabled") !== null;
  const firstRenderRun = !hasRenderScale && !hasGlowEnabled;

  const rawSettings = {};
  const settings = makePersistentProxy(rawSettings);
  app.settings = settings;

  // -------------------------
  // game settings
  // -------------------------
  rawSettings.game = {
    playerRadius: defaultGet("game.playerRadius", 18),
    moveSpeed: defaultGet("game.moveSpeed", 6),
    obstacleArea: defaultGet("game.obstacleArea", 5),
    obstacleStartCount: defaultGet("game.obstacleStartCount", 10),
  };

  // -------------------------
  // render settings
  // -------------------------
  rawSettings.render = {
    scale: defaultGet("render.scale", 1),
    preferredSide: defaultGet("render.preferredSide", "left"),
    bulletSpeed: defaultGet("render.bulletSpeed", 100),
    shellAngle: defaultGet("render.shellAngle", 150),
    glowEnabled: defaultGet("render.glowEnabled", false),
  };

  // Run diagnostic only if this is the first time we have no render settings.
  if (firstRenderRun) runRenderDiagnostic(app);
};

export function runRenderDiagnostic(
  app,
  {
    highScale = 2,
    lowScale = 1,
    highGlow = true,
    lowGlow = false,
    sampleDurationMs = 500, // how long to measure
    minGoodFps = 50, // threshold for "can handle high quality"
  } = {}
) {
  const render = app.settings.render;

  // Start optimistic: high quality
  render.scale = highScale;
  render.glowEnabled = highGlow;

  return new Promise((resolve) => {
    const samples = [];
    let last = performance.now();
    let elapsed = 0;

    function onFrame(now) {
      const dt = now - last;
      last = now;

      if (samples.length > 0) {
        samples.push(dt);
        elapsed += dt;
      } else {
        samples.push(dt); // first frame
      }

      if (elapsed < sampleDurationMs) {
        requestAnimationFrame(onFrame);
        return;
      }

      // Compute median frame time as a robust FPS estimate
      samples.sort((a, b) => a - b);
      const medianDt = samples[Math.floor(samples.length / 2)];
      const fps = 1000 / medianDt;

      // If FPS is too low, drop quality
      if (fps < minGoodFps) {
        render.scale = lowScale;
        render.glowEnabled = lowGlow;
      }

      // Because render is a persistent proxy, these changes will be
      // written to localStorage as your existing system already does.
      resolve({ fps, usedHighQuality: fps >= minGoodFps });
    }

    requestAnimationFrame(onFrame);
  });
}

function makePersistentProxy(obj, baseKey = "") {
  return new Proxy(obj, {
    get(target, prop) {
      const value = target[prop];
      if (!value || typeof value !== "object") return value;
      const childKey = baseKey ? `${baseKey}.${String(prop)}` : String(prop);
      return makePersistentProxy(value, childKey);
    },

    set(target, prop, value) {
      target[prop] = value;
      const fullKey = baseKey ? `${baseKey}.${String(prop)}` : String(prop);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        try {
          localStorage.setItem(fullKey, String(value));
        } catch (err) {
          console.error("localStorage write error in settings proxy:", err);
        }
      }
      return true;
    },
  });
}

const getParse = {
  number: (stored, n = Number(stored)) => (Number.isNaN(n) ? defaultValue : n),
  boolean: (stored) => stored === "true",
};

export const defaultGet = (key, defaultValue) => {
  const stored = localStorage.getItem(key);
  if (stored) return getParse[typeof defaultValue]?.(stored) ?? stored;
  try {
    localStorage.setItem(key, String(defaultValue));
  } catch (err) {
    console.error("localStorage write error in defaultGet:", err);
  }
  return defaultValue;
};

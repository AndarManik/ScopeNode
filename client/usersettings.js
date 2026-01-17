const V = "4";
export const addUserSettings = (app) => {
  const version = localStorage.getItem("version");
  if (version != V) {
    localStorage.clear();
    localStorage.setItem("version", V);
  }

  app.name = localStorage.getItem("name");

  const rawSettings = {};
  const settings = makePersistentProxy(rawSettings);
  app.settings = settings;

  rawSettings.game = {
    playerRadius: defaultGet("game.playerRadius", 18),
    moveSpeed: defaultGet("game.moveSpeed", 6.25),
    obstacleArea: defaultGet("game.obstacleArea", 6),
    obstacleStartCount: defaultGet("game.obstacleStartCount", 20),
  };

  rawSettings.render = {
    scale: defaultGet("render.scale", 1),
    preferredSide: defaultGet("render.preferredSide", "left"),
    bulletSpeed: defaultGet("render.bulletSpeed", 100),
    shellAngle: defaultGet("render.shellAngle", 150),
    glowEnabled: defaultGet("render.glowEnabled", false),
    fpsCap: defaultGet("render.fpsCap", 70),
    vSync: defaultGet("render.vSync", true),
    firstRender: defaultGet("render.firstRender", true),
  };
};

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
      )
        localStorage.setItem(fullKey, String(value));
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
  localStorage.setItem(key, String(defaultValue));
  return defaultValue;
};

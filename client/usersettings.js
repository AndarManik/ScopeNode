// unlike the other one we just push onto the app
export const addUserSettings = (app) => {
  app.name = localStorage.getItem("name");

  const settings = {};
  app.settings = settings;

  const game = {};
  settings.game = game;
  game.playerRadius = parseFloat(defaultGet("game.playerRadius", 18));
  game.moveSpeed = parseFloat(defaultGet("game.moveSpeed", 6));
  game.obstacleArea = parseFloat(defaultGet("game.obstacleArea", 5));
  game.obstacleStartCount = parseInt(defaultGet("game.obstacleStartCount", 10));

  const render = {};
  settings.render = render;
  render.scale = parseFloat(defaultGet("render.scale", 2));
  render.preferredSide = defaultGet("render.preferredSide", "none");
  render.bulletSpeed = parseFloat(defaultGet("render.bulletSpeed", 50));
  render.shellEjectAngleDeg = parseFloat(
    defaultGet("render.shellEjectAngleDeg", 150)
  );
};

export const defaultGet = (key, defaultValue) => {
  const value = localStorage.getItem(key);
  if (value) return value;
  localStorage.setItem(key, defaultValue);
  return defaultValue;
};

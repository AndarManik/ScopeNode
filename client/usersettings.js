// unlike the other one we just push onto the app
export const addUserSettings = (app) => {
  app.name = localStorage.getItem("name");

  const settings = {};
  app.settings = settings;

  const game = {};
  settings.game = game;
  game.playerRadius = parseInt(defaultGet("game.playerRadius", 18));
  game.moveSpeed = parseInt(defaultGet("game.moveSpeed", 6));
  game.obstacleArea = parseInt(defaultGet("game.obstacleArea", 5));

  const render = {};
  settings.render = render;
  render.scale = parseInt(defaultGet("render.scale", 2));
  render.preferredSide = defaultGet("render.preferredSide", "none");
};

export const defaultGet = (key, defaultValue) => {
  const value = localStorage.getItem(key);
  if (value) return value;
  localStorage.setItem(key, defaultValue);
  return defaultValue;
};

import { packObstacle, unpackObstacle } from "./binary.js";
import { pushLightingObstacle, pushManyLightingObstacles } from "./lighting.js";
import { generateObstacle } from "./obstaclegenerator.js";
import {
  setupObstacleBlockers,
  pushValidObstacle,
  validateNewObstacle,
} from "./obstaclevalidator.js";
import { pushManyPathingObstacle, pushPathingObstacle } from "./pathing.js";

export const initializeObstacles = (game) => {
  setupObstacleBlockers(game);
  const style = Math.random() < 0.5 ? mirrorAcrossMap : rotateAcrossMap;
  for (let i = 0; i < game.obstacleStartCount / 2; i++) {
    while (true) {
      let pos = sampleNormal(game);
      if (i === 0) pos[1] = game.mapHeight / 2;
      const obstacle1 = generateObstacle(game, pos);
      const obstacle2 = generateObstacle(game, style(game, pos));
      //not exactly correct close enough without having to create temp objects
      if (validateNewObstacle(game, obstacle1) === -1) continue;
      if (validateNewObstacle(game, obstacle2) === -1) continue;
      pushValidObstacle(game, obstacle1);
      pushValidObstacle(game, obstacle2);
      break;
    }
  }
  pushManyPathingObstacle(game, game.obstacles);
  pushManyLightingObstacles(game, game.obstacles);
};

export const initializeReceivedObstacles = (game, obstacles) => {
  setupObstacleBlockers(game);
  obstacles.forEach((obstacle) => pushValidObstacle(game, obstacle));
  pushManyPathingObstacle(game, game.obstacles);
  pushManyLightingObstacles(game, game.obstacles);
};

export const newObstaclePreview = (game, socket) => {
  game.previewObstacle = generateObstacle(
    game,
    game.mouse,
    game.previewAngle,
    game.previewAlpha
  );
  game.previewObstacle.index = validateNewObstacle(game, game.previewObstacle);

  if (game.mouse.isClicking && game.previewObstacle.index !== -1) {
    game.choosingObstacle = false;
    game.forceDrop.forEach(clearTimeout);
    addObstacle(game, game.previewObstacle);
    return socket.json({
      command: "confirm obstacle",
      position: game.mouse,
      angle: game.previewAngle,
      alpha: game.previewAlpha,
    });
  }

  socket.send(
    packObstacle({
      position: game.mouse,
      angle: game.previewAngle,
      alpha: game.previewAlpha,
      index: game.previewObstacle.index,
    })
  );
};

export const forceDropNewObstacle = (game, socket) => {
  if (!game.choosingObstacle) return;
  game.choosingObstacle = false;
  game.forceDrop.forEach(clearTimeout);

  if (game.previewObstacle.index !== -1) {
    addObstacle(game, game.previewObstacle);
    const { position, angle, alpha } = game.previewObstacle;
    return socket.json({ command: "confirm obstacle", position, angle, alpha });
  }

  while (true) {
    const position = sampleNormal(game);
    const angle = Math.PI * 2 * Math.random();
    const alpha = Math.random();
    const obstacle = generateObstacle(game, position, angle, alpha);
    if (validateNewObstacle(game, obstacle) === -1) continue;
    addObstacle(game, obstacle);
    socket.json({
      command: "confirm obstacle",
      position,
      angle,
      alpha,
    });
    break;
  }
};

export const receivePreviewObstacle = (game, data) => {
  const obstacle = unpackObstacle(data);
  if (!obstacle) return false;
  game.previewObstacle = generateObstacle(
    game,
    obstacle.position,
    obstacle.angle,
    obstacle.alpha
  );
  game.previewObstacle.index = obstacle.index;
  return true;
};

export const confirmPreviewObstacle = (game, obstacle) => {
  game.previewObstacle = generateObstacle(
    game,
    obstacle.position,
    obstacle.angle,
    obstacle.alpha
  );
  addObstacle(game, game.previewObstacle);
};

export const addObstacle = (game, obstacle) => {
  pushValidObstacle(game, obstacle);
  pushPathingObstacle(game, obstacle);
  pushLightingObstacle(game, obstacle);
};

const randomNormal = (a = Math.random(), b = Math.random()) =>
  Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
const sampleNormal = (game, W = game.mapWidth, H = game.mapHeight, s = 0.5) => [
  Math.min(W, Math.max(0, W / 2 + randomNormal() * (W / 2) * s)),
  Math.min(H, Math.max(0, H / 2 + randomNormal() * (H / 2) * s)),
];
const mirrorAcrossMap = (game, [x, y]) => [game.mapWidth - x, y];
const rotateAcrossMap = (game, [x, y]) => [
  game.mapWidth - x,
  game.mapHeight - y,
];

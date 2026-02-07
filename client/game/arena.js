import { packObstacle, unpackObstacle } from "./binary.js";
import { pushLightingObstacle, pushManyLightingObstacles } from "./lighting.js";
import { generateObstacle } from "./obstaclegenerator.js";
import {
  setupObstacleBlockers,
  pushValidObstacle,
  validateNewObstacle,
} from "./obstaclevalidator.js";
import { pushManyPathingObstacle, pushPathingObstacle } from "./pathing.js";

export const initializeObstacles = (game, whenDone) => {
  const style = Math.random() < 0.5 ? mirrorAcrossMap : rotateAcrossMap;

  const vary = (Math.random() * game.mapWidth) / 4;
  game.team1Objective = [(5 * game.mapWidth) / 8 + vary, game.mapHeight / 2];
  game.team2Objective = [(3 * game.mapWidth) / 8 - vary, game.mapHeight / 2];

  setupObstacleBlockers(game, style);

  let count = 0;
  const obstacleArea = game.obstacleArea;

  const pushTwo = () => {
    const prealpha = (2 * count) / game.obstacleStartCount;
    const alpha = 1 - Math.sqrt(prealpha);
    game.obstacleArea = alpha * obstacleArea + (1 - alpha) * 4;

    while (true) {
      let pos = sampleUniform(game);
      if (count === 0) pos[1] = game.mapHeight / 2;
      const obstacle1 = generateObstacle(game, pos);
      const obstacle2 = generateObstacle(game, style(game, pos));
      //not exactly correct close enough without having to create temp objects
      validateNewObstacle(game, obstacle1);
      validateNewObstacle(game, obstacle2);
      if (obstacle1.index === -1) continue;
      if (obstacle2.index === -1) continue;
      if (Math.random() < 0.5) {
        pushValidObstacle(game, obstacle1);
        pushValidObstacle(game, obstacle2);
      } else {
        pushValidObstacle(game, obstacle2);
        pushValidObstacle(game, obstacle1);
      }

      break;
    }
    count += 1;
    if (count <= game.obstacleStartCount / 2)
      if (whenDone) return pushTwo();
      else return setTimeout(pushTwo, 1000 / 20);

    game.obstacleArea = obstacleArea;
    pushManyPathingObstacle(game, game.obstacles);
    pushManyLightingObstacles(game, game.obstacles);
    if (whenDone) whenDone();
  };

  pushTwo();
};

export const initializeReceivedObstacles = (game, data) => {
  const [obstacles, blockers] = data;
  setupObstacleBlockers(game, mirrorAcrossMap);
  game.obstacleBlockers = blockers;
  obstacles.forEach((obstacle) => pushValidObstacle(game, obstacle));
  pushManyPathingObstacle(game, game.obstacles);
  pushManyLightingObstacles(game, game.obstacles);
};

export const newObstaclePreview = (game, socket) => {
  game.previewObstacle = generateObstacle(
    game,
    game.mouse,
    game.previewAngle,
    game.previewAlpha,
  );
  validateNewObstacle(game, game.previewObstacle);

  if (game.mouse.isClicking && game.previewObstacle.index !== -1) {
    game.choosingObstacle = false;
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
    }),
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
    validateNewObstacle(game, obstacle);
    if (obstacle.index === -1) continue;
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
    obstacle.alpha,
  );
  game.previewObstacle.index = obstacle.index;
  return true;
};

export const confirmPreviewObstacle = (game, obstacle) => {
  game.previewObstacle = generateObstacle(
    game,
    obstacle.position,
    obstacle.angle,
    obstacle.alpha,
  );
  addObstacle(game, game.previewObstacle);
};

export const addObstacle = (game, obstacle) => {
  if (!pushValidObstacle(game, obstacle)) return;
  pushPathingObstacle(game, obstacle);
  pushLightingObstacle(game, obstacle);
};

const randomNormal = (a = Math.random(), b = Math.random()) =>
  Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
const sampleNormal = (game, W = game.mapWidth, H = game.mapHeight, s = 0.8) => [
  Math.min(W, Math.max(0, W / 2 + randomNormal() * (W / 2) * s)),
  Math.min(H, Math.max(0, H / 2 + randomNormal() * (H / 2) * s)),
];

const sampleUniform = (game, W = game.mapWidth, H = game.mapHeight) => [
  W * Math.random(),
  H * Math.random(),
];
const mirrorAcrossMap = (game, [x, y]) => [game.mapWidth - x, y];
const rotateAcrossMap = (game, [x, y]) => [
  game.mapWidth - x,
  game.mapHeight - y,
];

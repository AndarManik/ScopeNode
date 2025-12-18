import { updateFps } from "./fps.js";
import {
  render,
  drawPolygon,
  triangleLayer,
  reDrawMTriangleLayer,
  reDrawObstacleVisibilityLayer,
  drawPolygonThick,
} from "./render.js";
import {
  game,
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
  obstacleColor,
  PLAYER_SPEED,
  TEAM1_SPAWN,
} from "./global.js";
import { extendLights } from "./light.js";
import {
  extendObstacles,
  initializeObstacles,
  planPath,
  validateNewObstacle,
} from "./obstacle.js";

game.pushPolygon = (triangle, mTriangle) => {
  const validationIndex = validateNewObstacle(mTriangle);
  if (validationIndex === -1) return false;
  drawPolygon(triangle, triangleLayer.ctx, obstacleColor(validationIndex));

  extendLights(triangle);
  extendObstacles(mTriangle);

  reDrawMTriangleLayer(); // do after we extend
  reDrawObstacleVisibilityLayer();
  return true;
};

const clamp = (val, min, max) => (val < min ? min : val > max ? max : val);

const update = (delta) => {
  const { player, extraPlayer, extraPlayer1, extraPlayer2 } = game;
  // target is the first node in the path.
  const t = performance.now() * 0.001;

  function parametricTarget(phaseX, phaseY, radiusX, radiusY) {
    return [
      MAP_WIDTH * 0.5 + Math.cos(t + phaseX) * radiusX,
      MAP_HEIGHT * 0.5 + Math.sin(t * 0.7 + phaseY) * radiusY,
    ];
  }

  const targets = [
    parametricTarget(0, 0, 1024, 768),
    parametricTarget(1.7, 0.9, 1024, 768),
    parametricTarget(3.1, 2.4, 1024, 768),
  ];

  moveAlongPath(extraPlayer, targets[0], delta);
  moveAlongPath(extraPlayer1, targets[1], delta);
  moveAlongPath(extraPlayer2, targets[2], delta);
  game.playerPath = moveAlongPath(player, game.mouse, delta);
};

const ARRIVE_RADIUS = 3; // snap distance
const SWITCH_RADIUS = 8; // how far a new final waypoint must be before we switch
const moveAlongPath = (player, target, delta) => {
  const path = planPath(player, target);
  target = path[0];
  const lastInPath = path.length > 0 ? path[path.length - 1] : target;
  if (player.stickyFinal) {
    const dx = lastInPath[0] - player.stickyFinal[0];
    const dy = lastInPath[1] - player.stickyFinal[1];
    const dSticky = Math.hypot(dx, dy);
    if (dSticky >= SWITCH_RADIUS) player.stickyFinal = lastInPath;
  } else player.stickyFinal = lastInPath;

  // Movement logic uses the *current target* from planPath, but stops early
  const dirX = target[0] - player[0];
  const dirY = target[1] - player[1];
  const dist = Math.hypot(dirX, dirY);

  if (dist <= ARRIVE_RADIUS && path.length === 0) {
    player[0] = player.stickyFinal[0];
    player[1] = player.stickyFinal[1];
  } else {
    const maxStep = PLAYER_SPEED * delta;
    if (dist <= maxStep) {
      player[0] = target[0];
      player[1] = target[1];
    } else {
      const inv = 1 / dist;
      player[0] += dirX * (maxStep * inv);
      player[1] += dirY * (maxStep * inv);
    }
  }

  // Clamp to map bounds
  player[0] = clamp(player[0], PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
  player[1] = clamp(player[1], PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);

  return path;
};

// engine

const initializeGame = () => {
  initializeObstacles();
};

let last = performance.now();
const engineCycle = () => {
  const now = performance.now();
  const delta = (now - last) / 1000;
  last = now;
  update(delta);
  render();
  updateFps(delta);
  requestAnimationFrame(engineCycle);
};

initializeGame();
engineCycle();

import { packObstacle, unpackObstacle } from "./binary.js";
import { pushLightingObstacle, pushManyLightingObstacles } from "./lighting.js";
import { generateObstacle } from "./obstaclegenerator.js";
import {
  setupObstacleBlockers,
  pushValidObstacle,
  validateNewObstacle,
  pushValidObstaclePair,
} from "./obstaclevalidator.js";
import { pushManyPathingObstacle, pushPathingObstacle } from "./pathing.js";

export const initializeObstacles = (game) => {
  setupObstacleBlockers(game);

  const style = Math.random() < 0.5 ? mirrorAcrossMap : rotateAcrossMap;

  let placementBalance = 0;
  for (let i = 0; i < game.obstacleStartCount / 2; i++) {
    while (true) {
      let pos = sampleNormal(game);
      if (i === 0) pos[1] = game.mapHeight / 2;
      const obstacle = generateObstacle(game, pos);
      const obstacle2 = generateObstacle(game, style(game, pos));
      if (
        validateNewObstacle(game, obstacle) !== -1 &&
        validateNewObstacle(game, obstacle2) !== -1
      ) {
        pushValidObstacle(game, obstacle);
        pushValidObstacle(game, obstacle2);
        break;
      }
    }
  }
  pushManyPathingObstacle(game, game.obstacles);
  pushManyLightingObstacles(game, game.obstacles);
};

const rotateAcrossMap = (game, [x, y]) => [
  game.mapWidth - x,
  game.mapHeight - y,
];

const mirrorAcrossMap = (game, [x, y]) => [game.mapWidth - x, y];

export const initializeReceivedObstacles = (game, obstacles) => {
  setupObstacleBlockers(game);

  obstacles.forEach((obstacle) => {
    pushValidObstacle(game, obstacle);
  });
  pushManyPathingObstacle(game, game.obstacles);
  pushManyLightingObstacles(game, game.obstacles);
};

export const addObstacle = (game, obstacle) => {
  pushValidObstacle(game, obstacle);
  pushPathingObstacle(game, obstacle);
  pushLightingObstacle(game, obstacle);
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
    addObstacle(game, game.previewObstacle);
    socket.json({
      command: "confirm obstacle",
      position: game.mouse,
      angle: game.previewAngle,
      alpha: game.previewAlpha,
    });
  } else {
    socket.send(
      packObstacle({
        position: game.mouse,
        angle: game.previewAngle,
        alpha: game.previewAlpha,
        index: game.previewObstacle.index,
      })
    );
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

const randomNormal = (a = Math.random(), b = Math.random()) =>
  Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
const sampleNormal = (game, W = game.mapWidth, H = game.mapHeight, s = 0.5) => [
  Math.min(W, Math.max(0, W / 2 + randomNormal() * (W / 2) * s)),
  Math.min(H, Math.max(0, H / 2 + randomNormal() * (H / 2) * s)),
];

const teamBalance = (game, p) => {
  const R0 = 0.01 * Math.min(game.mapWidth, game.mapHeight);
  const R1 = 0.25 * Math.min(game.mapWidth, game.mapHeight);
  const midWidth = 0.5;
  const power = 2;
  const block = (spawn) => {
    const { dist, t } = pointToSegment(p, spawn, game.centerObjective);
    if (t <= 0 || t >= 1) return 0;
    const u = (t - 0.5) / midWidth;
    const bump = Math.exp(-Math.pow(Math.abs(u), power));
    const R = R0 + (R1 - R0) * bump;
    const s = dist / Math.max(1e-6, R);
    return Math.exp(-(s * s));
  };
  const b1 = block(game.spawn1);
  const b2 = block(game.spawn2);
  return Math.tanh((b2 - b1) / 2);
};

const pointToSegment = (p, a, b) => {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const vv = vx * vx + vy * vy;
  const t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
  const tc = Math.max(0, Math.min(1, t));
  const cx = ax + tc * vx;
  const cy = ay + tc * vy;
  return {
    dist: Math.hypot(px - cx, py - cy),
    t: tc,
  };
};

window.openTeamBalanceHeatmap = () =>
  openTeamBalanceHeatmap({
    mapWidth: 1024,
    mapHeight: 768,
    centerObjective: [512, 384],
    spawn1: [24, 384],
    spawn2: [1000, 384],
  });

const openTeamBalanceHeatmap = async (game, opts = {}) => {
  const {
    step = 1,
    negColor = [223, 33, 8],
    midColor = [121, 121, 121],
    posColor = [12, 111, 249],
  } = opts;

  const W = Math.ceil(game.mapWidth / step);
  const H = Math.ceil(game.mapHeight / step);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const img = ctx.createImageData(W, H);
  const data = img.data;

  const lerp = (a, b, t) => a + (b - a) * t;
  const mixColor = (c1, c2, t) => [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t),
  ];

  let i = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const worldX = x * step;
      const worldY = y * step;

      const v = teamBalance(game, [worldX, worldY]); // [-1,1]

      let color;
      if (v < 0) color = mixColor(midColor, negColor, -v);
      else color = mixColor(midColor, posColor, v);

      data[i++] = color[0];
      data[i++] = color[1];
      data[i++] = color[2];
      data[i++] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  let finalCanvas = canvas;
  if (step !== 1) {
    finalCanvas = document.createElement("canvas");
    finalCanvas.width = game.mapWidth;
    finalCanvas.height = game.mapHeight;
    const fctx = finalCanvas.getContext("2d");
    fctx.imageSmoothingEnabled = true;
    fctx.drawImage(canvas, 0, 0, finalCanvas.width, finalCanvas.height);
  }

  const blob = await new Promise((res) => finalCanvas.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);

  // Open in a new tab
  window.open(url, "_blank", "noopener");

  // Optional cleanup later
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  return { blob, url, canvas: finalCanvas };
};

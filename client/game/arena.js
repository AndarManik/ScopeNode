import { pushLightingObstacle, pushManyLightingObstacles } from "./lighting.js";
import { generateObstacle, transformPoints } from "./obstaclegenerator.js";
import {
  setupObstacleBlockers,
  pushValidObstacle,
} from "./obstaclevalidator.js";
import { pushPathingObstacle } from "./pathing.js";

export const initializeObstacles = (game) => {
  setupObstacleBlockers(game);

  let placementBalance = 0;
  for (let i = 0; i < game.obstacleStartCount; i++) {
    const obstacle = generateObstacle(game, [0, 0]);

    while (true) {
      let pos = sampleNormal(game);
      if (i === 0) pos[1] = game.mapHeight / 2;

      if (teamBalance(game, pos) * placementBalance > 0)
        pos = mirrorAcrossMap(game, pos);
      placementBalance += teamBalance(game, pos);

      console.log(placementBalance);
      const rot = Math.random() * Math.PI * 2;
      const poly = transformPoints(pos, rot, obstacle.poly);
      const pathPoly = transformPoints(pos, rot, obstacle.pathPoly);
      const positionedObstacle = { poly, pathPoly };

      if (pushValidObstacle(game, positionedObstacle)) {
        pushPathingObstacle(game, positionedObstacle);
        break;
      }
    }
  }
  pushManyLightingObstacles(game, game.obstacles);
};

export const initializeReceivedObstacles = (game, obstacles) => {
  setupObstacleBlockers(game);

  obstacles.forEach((obstacle) => {
    pushValidObstacle(game, obstacle);
    pushPathingObstacle(game, obstacle);
  });
  pushManyLightingObstacles(game, game.obstacles);
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

const mirrorAcrossMap = (game, [x, y]) => [
  game.mapWidth - x,
  game.mapHeight - y,
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
  return Math.tanh(2 * (b2 - b1));
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

//testing function which shows heat map of placement
export async function copyTeamBalanceHeatmap(game, opts = {}) {
  const {
    // sampling resolution: 1 = full res, 2 = half res, etc
    step = 1,

    // colors in linear RGB space
    // team2 (negative), neutral, team1 (positive)
    negColor = [110, 155, 251], // blue
    midColor = [158, 158, 158], // light grey
    posColor = [237, 118, 101], // red
  } = opts;

  const W = Math.ceil(game.mapWidth / step);
  const H = Math.ceil(game.mapHeight / step);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const img = ctx.createImageData(W, H);
  const data = img.data;

  // linear interpolation
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

      // ∈ [-1, 1]
      const v = teamBalance(game, [worldX, worldY]);

      let color;
      if (v < 0) {
        // map [-1,0] → [0,1]
        const t = -v;
        color = mixColor(midColor, negColor, t);
      } else {
        // map [0,1] → [0,1]
        const t = v;
        color = mixColor(midColor, posColor, t);
      }

      data[i++] = color[0];
      data[i++] = color[1];
      data[i++] = color[2];
      data[i++] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // upscale to full map size if step > 1
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

  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

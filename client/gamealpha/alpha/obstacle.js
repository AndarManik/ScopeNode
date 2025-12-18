import "./martinez.min.js";
import {
  CENTER_OBJECTIVE,
  game,
  INIT_OBSTACLE_COUNT,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYER_RADIUS,
  TEAM1_SPAWN,
  TEAM2_SPAWN,
} from "./global.js";
import {
  minkowskiSum,
  spawnTriangleCentered,
  transformPoints,
} from "./triangle.js";
import { makeLazyAPSP } from "./lazyallpairsshortestpath.js";
import { kickout } from "./kickout.js";

// Obstacles are the primary data for two graph based systems.
// 1. Path planning (pathGraph)
// 2. Shine casting (shineGraph)

// The goal for obstacle placement is to give as much freedom of placement
// while restricting some choices to enable interesting map development.
// Beyond choices which softlock the game, players will not be able to close
// paths by placing an obstacle.
// If we consider obstacles as holes in a topological 2d sheet,
// the previous statement reduces to ensuring the genus of the sheet is
// monotonically increasing.

//      ________             ________
//     / __    /  good      / ____  /
//    / /_/   /  --->      / /___/ /
//   /       /  extending /       /
//  /_______/  existing  /_______/
//      ________             ________
//     / __    /  good      / __    /
//    / /_/   /  --->      / /_/___/
//   /       /  extending /    /__
//  /_______/  outside   /_______/
//      ________             ________
//     /______ /  good      /______ /
//    //___  //  --->      // __  //
//   //_____//  ring      //_____//
//  /_______/  closing   /_______/
//      ________             ________
//     / __    /  bad       / _____ /
//    / /_/__ /  --->      / /__  //
//   /    /_//  fusing    /    /_//
//  /_______/  seperated /_______/
//      ________             ________
//     / __    /  bad       / __    /
//    / /_/   /  --->      / / /___/
//   /       /  fuse      / /_____
//  /_______/  outside   /_______/

export const validateNewObstacle = (polygon) => {
  const newGroup = [[[...polygon, polygon[0]]]];

  const noHoles = unholy(martinez.union(game.obstacleTotal, newGroup));
  if (game.obstacleTotal.length > noHoles.length) return -1;

  if (martinez.union(noHoles, TEAM1).length <= noHoles.length) return -1;
  if (martinez.union(noHoles, TEAM2).length <= noHoles.length) return -1;
  if (martinez.union(noHoles, CENTER).length <= noHoles.length) return -1;

  for (let i = 0; i < game.obstacleGroups.length; i++) {
    if (martinez.union(game.obstacleGroups[i], newGroup).length === 1) return i; // hit
  }

  return game.obstacleGroups.length;
};

let init_time = 0;
export const extendObstacles = (polygon) => {
  const startTime = performance.now();
  game.pathGraph.pushPolygon(polygon);
  game.apsp = makeLazyAPSP(game.pathGraph);
  init_time += performance.now() - startTime;

  const newGroup = [[[...polygon, polygon[0]]]];

  if (!game.obstacleTotal) game.obstacleTotal = newGroup;
  else game.obstacleTotal = martinez.union(game.obstacleTotal, newGroup);
  game.obstacleTotal = unholy(game.obstacleTotal);

  for (let i = 0; i < game.obstacleGroups.length; i++) {
    const group = game.obstacleGroups[i];
    const merged = martinez.union(group, newGroup);
    if (merged.length > 1) continue;
    game.obstacleGroups[i] = merged.map((poly) => [poly[0]]); // drop holes
    return i;
  }

  game.obstacleGroups.push(newGroup);
  return game.obstacleGroups.length - 1;
};

export function planPath(source, target) {
  let targetPath = [];
  source = kickout(source, game.obstacleTotal);
  target = kickout(target, game.obstacleTotal);
  if (game.apsp && !game.pathGraph._visibleFromPointToPoint(source, target)) {
    const sourceVerts = game.pathGraph.visibleIndicesAt(source);
    const targetVerts = game.pathGraph.visibleIndicesAt(target);

    const vertices = game.pathGraph.vertices;
    let minDistance = Number.MAX_VALUE;
    for (const sIdx of sourceVerts) {
      const sDist = Math.hypot(
        vertices[sIdx][0] - source[0],
        vertices[sIdx][1] - source[1]
      );
      for (const tIdx of targetVerts) {
        const res = game.apsp(sIdx, tIdx);
        const tDist = Math.hypot(
          vertices[tIdx][0] - target[0],
          vertices[tIdx][1] - target[1]
        );
        const total = sDist + tDist + res.distance;
        if (total < minDistance) {
          targetPath = res.path;
          minDistance = total;
        }
      }
    }
  }
  return [...targetPath, target];
}

// skip first cause we use it as the init val reduce
const unholy = (holy) =>
  holy.slice(1).reduce((a, p) => martinez.union(a, [[p[0]]]), [[holy[0][0]]]);

const squareAt = ([cx, cy]) => [
  [cx - 1, cy - 1],
  [cx + 1, cy - 1],
  [cx + 1, cy + 1],
  [cx - 1, cy + 1],
  [cx - 1, cy - 1],
];
const TEAM1 = [[squareAt(TEAM1_SPAWN)]];
const TEAM2 = [[squareAt(TEAM2_SPAWN)]];
const CENTER = [[squareAt(CENTER_OBJECTIVE)]];

export const initializeObstacles = () => {
  buildBoundaryRect(-1000, -1000, MAP_WIDTH + 1000, PLAYER_RADIUS - 1);
  buildBoundaryRect(
    -1000,
    MAP_HEIGHT - PLAYER_RADIUS + 1,
    MAP_WIDTH + 1000,
    MAP_HEIGHT + 1000
  );
  buildBoundaryRect(
    -1000,
    PLAYER_RADIUS,
    PLAYER_RADIUS,
    MAP_HEIGHT - PLAYER_RADIUS
  );
  buildBoundaryRect(
    MAP_WIDTH - PLAYER_RADIUS,
    PLAYER_RADIUS,
    MAP_WIDTH + 1000,
    MAP_HEIGHT - PLAYER_RADIUS
  );
  let placementBalance = 0;

  for (let i = 0; i < INIT_OBSTACLE_COUNT; i++) {
    const triangle = spawnTriangleCentered(Math.random());
    const mTriangle = minkowskiSum(triangle, PLAYER_RADIUS);

    while (true) {
      let pos = sampleNormal();
      if (i === 0) pos[1] = MAP_HEIGHT / 2;

      if (teamBalance(pos) * placementBalance > 0) pos = mirrorAcrossMap(pos);

      placementBalance += teamBalance(pos);
      console.log(placementBalance);
      const rot = Math.random() * Math.PI * 2;
      const posTriangle = transformPoints(pos, rot, triangle);
      const posMTriangle = transformPoints(pos, rot, mTriangle);
      if (game.pushPolygon(posTriangle, posMTriangle)) break;
    }
  }
  console.log(init_time);
};

const buildBoundaryRect = (left, top, right, bottom) =>
  extendObstacles([
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]);

const randomNormal = (a = Math.random(), b = Math.random()) =>
  Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);

const sampleNormal = (W = MAP_WIDTH, H = MAP_HEIGHT, s = 0.5) => [
  Math.min(W, Math.max(0, W / 2 + randomNormal() * (W / 2) * s)),
  Math.min(H, Math.max(0, H / 2 + randomNormal() * (H / 2) * s)),
];

const mirrorAcrossMap = ([x, y]) => [MAP_WIDTH - x, MAP_HEIGHT - y];
const distance = ([x1, y1], [x2, y2]) => Math.hypot(x1 - x2, y1 - y2);

const teamBalance = (p) => {
  const d1 = distance(p, TEAM1_SPAWN);
  const d2 = distance(p, TEAM2_SPAWN);
  const raw = (d2 - d1) / Math.min(d1, d2);
  return Math.tanh(raw / 2); // squashes into [-1, 1]
};


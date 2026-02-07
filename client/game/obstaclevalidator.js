import "./martinez.min.js";
import { removeHoles, toMulti, unionNoHoles } from "./martinezutil.js";
import { pushPathingObstacle } from "./pathing.js";
// Obstacles are the primary data for two graph based systems.
// 1. Path planning
// 2. Shine casting

// The goal for obstacle placement is to give as much freedom of placement
// while restricting some choices to enable interesting map development.
// Beyond choices which softlock the game, players will not be able to close
// paths by placing an obstacle.
// If we consider obstacles as holes in a bounded topological 2d sheet,
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
//
// There is another case which is subtly banned but it's hard to draw in ascii
// It's the case where ring closing around an obstacle, the genus would --.
export const pushValidObstacle = (game, obstacle) => {
  validateNewObstacle(game, obstacle);
  const validationIndex = obstacle.index;
  if (validationIndex === -1) return false;
  game.obstacles.push(obstacle);
  game.obstacleTotal = obstacle.noHoles;
  if (validationIndex === game.obstacleGroups.length) {
    game.obstacleGroups.push(obstacle.pathMulti);
    game.obstacleRenderGroups.push([obstacle.poly]);
    return true;
  }
  game.obstacleGroups[validationIndex] = obstacle.group;
  game.obstacleRenderGroups[validationIndex].push(obstacle.poly);
  return true;
};

export const validateNewObstacle = (game, obstacle) => {
  obstacle.pathMulti = toMulti(obstacle.pathPoly);
  obstacle.noHoles = unionNoHoles(game.obstacleTotal, obstacle.pathMulti);
  if (game.obstacleTotal.length > obstacle.noHoles.length)
    return (obstacle.index = -1);
  for (const blocker of game.obstacleBlockers) {
    const withBlocker = martinez.union(obstacle.noHoles, blocker);
    if (withBlocker.length <= obstacle.noHoles.length)
      return (obstacle.index = -1);
  }
  for (let i = 0; i < game.obstacleGroups.length; i++) {
    obstacle.group = unionNoHoles(game.obstacleGroups[i], obstacle.pathMulti);
    if (obstacle.group.length === 1) return (obstacle.index = i); // hit
  }
  obstacle.index = game.obstacleGroups.length;
};

export const setupObstacleBlockers = (game, transform) => {
  const { playerRadius, mapWidth, mapHeight } = game;
  const wmp = mapWidth - playerRadius;
  const hmp = mapHeight - playerRadius;

  const boundary = [
    buildBoundaryRect(-1000, -1000, mapWidth + 1000, playerRadius - 1),
    buildBoundaryRect(-1000, hmp + 1, mapWidth + 1000, mapHeight + 1000),
    buildBoundaryRect(-1000, playerRadius, playerRadius, hmp),
    buildBoundaryRect(wmp, playerRadius, mapWidth + 1000, hmp),
  ];

  game.obstacles = [];
  game.obstacleGroups = boundary.map(toMulti);
  game.obstacleTotal = null;
  game.obstacleGroups.forEach((multi) => {
    if (!game.obstacleTotal) return (game.obstacleTotal = multi);
    game.obstacleTotal = removeHoles(martinez.union(game.obstacleTotal, multi));
  });
  game.obstacleRenderGroups = [...boundary];

  game.pathTotal = null;
  game.lightTotal = null;
  boundary.forEach((pathPoly) => pushPathingObstacle(game, { pathPoly }));

  const crossPoint1 = [
    (mapWidth * Math.random()) / 2 + mapWidth / 4,
    Math.random() < 0.5 ? playerRadius + 1 : mapHeight - playerRadius - 1,
  ];
  const crossPoint2 = transform(game, crossPoint1);

  game.obstacleBlockers = [
    [[crossbarsAt(crossPoint1, game.team1Objective)]],
    [[crossbarsAt(crossPoint2, game.team2Objective)]],
    [[crossbarsAt(crossPoint1, game.team2Objective)]],
    [[crossbarsAt(crossPoint2, game.team1Objective)]],
    [[crossbarsAt(game.spawn1, crossPoint1)]],
    [[crossbarsAt(game.spawn2, crossPoint2)]],
  ];
};

const buildBoundaryRect = (left, top, right, bottom) => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
];

const squareAt = ([cx, cy]) => [
  [cx - 1, cy - 1],
  [cx + 1, cy - 1],
  [cx + 1, cy + 1],
  [cx - 1, cy + 1],
  [cx - 1, cy - 1],
];

const crossbarsAt = ([cx, cy], [dx, dy]) => {
  let vx = dx - cx;
  let vy = dy - cy;
  const len = Math.hypot(vx, vy);

  // Degenerate case: points coincide → just draw the 2x2 square
  if (len === 0) return squareAt([cx, cy]);

  // Unit direction from c → d
  vx /= len;
  vy /= len;

  // Perpendicular unit vector
  const nx = -vy;
  const ny = vx;

  // Rectangle parameters
  const halfWidth = len / 2; // along the line between the points
  const halfHeight = 1; // total height = 2

  // Center at midpoint between the two points
  const mx = (cx + dx) / 2;
  const my = (cy + dy) / 2;

  // Four corners (counter-clockwise) and close the polygon
  const p1 = [
    mx - vx * halfWidth - nx * halfHeight,
    my - vy * halfWidth - ny * halfHeight,
  ];
  const p2 = [
    mx + vx * halfWidth - nx * halfHeight,
    my + vy * halfWidth - ny * halfHeight,
  ];
  const p3 = [
    mx + vx * halfWidth + nx * halfHeight,
    my + vy * halfWidth + ny * halfHeight,
  ];
  const p4 = [
    mx - vx * halfWidth + nx * halfHeight,
    my - vy * halfWidth + ny * halfHeight,
  ];

  return [p1, p2, p3, p4, p1];
};

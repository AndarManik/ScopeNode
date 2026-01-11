import "./martinez.min.js";
import { cloneMultiPoly } from "./martinezutil.js";
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

export const pushValidObstacle = (game, obstacle) => {
  const { poly, pathPoly } = obstacle;

  const validationIndex = validateNewObstacle(game, obstacle);
  if (validationIndex === -1) return false;

  game.obstacles.push(obstacle);

  const multiPathPoly = toMulti(pathPoly);

  const totalWithHoles = martinez.union(game.obstacleTotal, multiPathPoly);
  game.obstacleTotal = removeHoles(totalWithHoles);

  if (validationIndex === game.obstacleGroups.length) {
    game.obstacleGroups.push(multiPathPoly);
    game.obstacleRenderGroups.push([poly]);
    return true;
  }

  const group = game.obstacleGroups[validationIndex];
  const groupWithHoles = martinez.union(group, multiPathPoly);
  game.obstacleGroups[validationIndex] = removeHoles(groupWithHoles);
  game.obstacleRenderGroups[validationIndex].push(poly);

  return true;
};

export const validateNewObstacle = (game, obstacle) => {
  const obstaclePath = toMulti(obstacle.pathPoly);
  const noHoles = removeHoles(martinez.union(game.obstacleTotal, obstaclePath));
  if (game.obstacleTotal.length > noHoles.length) return -1;

  const { team1, team2, center } = game.obstacleBlockers;
  if (martinez.union(noHoles, team1).length <= noHoles.length) return -1;
  if (martinez.union(noHoles, team2).length <= noHoles.length) return -1;
  if (martinez.union(noHoles, center).length <= noHoles.length) return -1;

  for (let i = 0; i < game.obstacleGroups.length; i++)
    if (martinez.union(game.obstacleGroups[i], obstaclePath).length === 1)
      return i; // hit

  return game.obstacleGroups.length;
};

export const pushValidObstaclePair = (game, obstacleA, obstacleB) => {
  // Clone only the fields that pushValidObstacle mutates
  const tempGame = {
    // These are safe shallow copies / fresh arrays
    obstacles: [...game.obstacles],
    obstacleTotal: cloneMultiPoly(game.obstacleTotal),
    obstacleGroups: game.obstacleGroups.map(cloneMultiPoly),
    obstacleRenderGroups: game.obstacleRenderGroups.map((group) => [...group]),
    obstacleBlockers: game.obstacleBlockers,
  };

  if (!pushValidObstacle(tempGame, obstacleA)) {
    console.log("failed first");
    return false;
  }
  if (!pushValidObstacle(tempGame, obstacleB)) {
    console.log("failed second");
    return false;
  }

  if (!pushValidObstacle(game, obstacleA)) {
    throw new Error(
      "pushValidObstaclePair: unexpected failure inserting first obstacle"
    );
  }

  if (!pushValidObstacle(game, obstacleB)) {
    throw new Error(
      "pushValidObstaclePair: unexpected failure inserting second obstacle"
    );
  }

  return true;
};

export const setupObstacleBlockers = (game) => {
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
  game.obstacleGroups.forEach((multi) => {
    if (!game.obstacleTotal) return (game.obstacleTotal = multi);
    game.obstacleTotal = removeHoles(martinez.union(game.obstacleTotal, multi));
  });
  game.obstacleRenderGroups = [...boundary];

  boundary.forEach((pathPoly) => pushPathingObstacle(game, { pathPoly }));

  const team1 = [[squareAt(game.spawn1)]];
  const team2 = [[squareAt(game.spawn2)]];
  const center = [[squareAt(game.centerObjective)]];
  game.obstacleBlockers = { team1, team2, center };
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

const toMulti = (polygon) => [[[...polygon, polygon[0]]]];

// skip first cause we use it as the init val reduce
const removeHoles = (holedPolygon) =>
  holedPolygon
    .slice(1)
    .reduce((a, p) => martinez.union(a, [[p[0]]]), [[holedPolygon[0][0]]]);

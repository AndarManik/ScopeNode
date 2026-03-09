import "./martinez.min.js";
import { removeHoles, toMulti, unionNoHoles } from "./martinezutil.js";
import { pushPathingObstacle } from "./pathing.js";
import { util } from "./util.js";
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
    util.buildBoundaryRect(-1000, -1000, mapWidth + 1000, playerRadius - 1),
    util.buildBoundaryRect(-1000, hmp + 1, mapWidth + 1000, mapHeight + 1000),
    util.buildBoundaryRect(-1000, playerRadius, playerRadius, hmp),
    util.buildBoundaryRect(wmp, playerRadius, mapWidth + 1000, hmp),
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
    [[util.crossbarsAt(crossPoint1, game.team1Objective)]],
    [[util.crossbarsAt(crossPoint2, game.team2Objective)]],
    [[util.crossbarsAt(crossPoint1, game.team2Objective)]],
    [[util.crossbarsAt(crossPoint2, game.team1Objective)]],
    [[util.crossbarsAt(game.spawn1, crossPoint1)]],
    [[util.crossbarsAt(game.spawn2, crossPoint2)]],
  ];
};

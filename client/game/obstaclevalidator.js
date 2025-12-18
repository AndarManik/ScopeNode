import "./martinez.min.js";

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

const squareAt = ([cx, cy]) => [
  [cx - 1, cy - 1],
  [cx + 1, cy - 1],
  [cx + 1, cy + 1],
  [cx - 1, cy + 1],
  [cx - 1, cy - 1],
];

export const newObstacleBlockers = (game) => {
  const team1 = [[squareAt(game.team1Spawn)]];
  const team2 = [[squareAt(game.team2Spawn)]];
  const center = [[squareAt(game.centerObjective)]];
  return { team1, team2, center };
}

export const validateNewObstacle = (game, obstaclePath) => {
  const noHoles = removeHoles(martinez.union(game.obstacleTotal, obstaclePath));
  if (game.obstacleTotal.length > noHoles.length) return -1;

  if (martinez.union(noHoles, game.obstacleBlockers.team1).length <= noHoles.length) return -1;
  if (martinez.union(noHoles, game.obstacleBlockers.team2).length <= noHoles.length) return -1;
  if (martinez.union(noHoles, game.obstacleBlockers.center).length <= noHoles.length) return -1;

  for (let i = 0; i < game.obstacleGroups.length; i++)
    if (martinez.union(game.obstacleGroups[i], obstaclePath).length === 1) return i; // hit

  return game.obstacleGroups.length;
};

// skip first cause we use it as the init val reduce
const removeHoles = (holedPolygon) =>
  holedPolygon.slice(1).reduce((a, p) => martinez.union(a, [[p[0]]]), [[holedPolygon[0][0]]]);

const toMulti = (polygon) => [[[...polygon, polygon[0]]]];

export const pushObstacle = (game, obstacle) => {
  const { triangle, pathTriangle } = obstacle;
  const multiPathTriangle = toMulti(pathTriangle);
  if (!game.obstacleTotal || !game.obstacleGroups) {
    game.obstacleTotal = multiPathTriangle;
    game.obstacleGroups = [multiPathTriangle];
    game.obstacleRenderGroups = [[triangle]];
    return true;
  }

  const validationIndex = validateNewObstacle(game, multiPathTriangle);
  if (validationIndex === -1) {
    return false;
  }

  game.obstacleTotal = removeHoles(martinez.union(game.obstacleTotal, multiPathTriangle));

  if (validationIndex === game.obstacleGroups.length) {
    game.obstacleGroups.push(multiPathTriangle);
    game.obstacleRenderGroups.push([triangle]);
    return true
  }

  game.obstacleGroups[validationIndex] = removeHoles(martinez.union(game.obstacleGroups[validationIndex], multiPathTriangle));
  game.obstacleRenderGroups[validationIndex].push(triangle);

  return true;
}
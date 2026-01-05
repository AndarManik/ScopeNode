import { LightGraph } from "./lightVisibilityGraph.js";
import { removeHoles, toMulti } from "./martinezutil.js";
import { kickout, newKickoutParams } from "./pathkickout.js";
import { makeLazyAPSP } from "./pathVisibilityGraph.js";

export const pushPathingObstacle = (game, obstacle) => {
  pushManyPathingObstacle(game, [obstacle]);
};

export const pushManyPathingObstacle = (game, obstacles) => {
  obstacles.forEach((obstacle) => {
    const newPathGroup = toMulti(obstacle.pathPoly);
    if (!game.pathTotal) game.pathTotal = newPathGroup;
    else game.pathTotal = martinez.union(game.pathTotal, newPathGroup);
    game.pathTotal = removeHoles(game.pathTotal);
  });
  game.pathGraph = new LightGraph(game);
  game.pathTotal.forEach(([poly]) => game.pathGraph.pushPolygon(poly));

  game.apsp = makeLazyAPSP(game.pathGraph);
  game.kickoutParams = newKickoutParams(game.obstacleTotal);
};

export const planPath = (game, source, target) => {
  if (!game.kickoutParams) return [];

  let targetPath = [];

  source = kickout(source, game.kickoutParams);
  target = kickout(target, game.kickoutParams);

  if (game.apsp && !game.pathGraph._visibleFromPointToPoint(source, target)) {
    const sourceVerts = game.pathGraph.visibleIndicesAt(source);
    const targetVerts = game.pathGraph.visibleIndicesAt(target);
    const vertices = game.pathGraph.vertices;

    let minDistance = Number.MAX_VALUE;

    for (const sIdx of sourceVerts) {
      const sx = vertices[sIdx][0] - source[0];
      const sy = vertices[sIdx][1] - source[1];
      const sDist = Math.sqrt(sx * sx + sy * sy);

      if (sDist >= minDistance) continue;

      for (const tIdx of targetVerts) {
        const tx = vertices[tIdx][0] - target[0];
        const ty = vertices[tIdx][1] - target[1];
        const tDist = Math.sqrt(tx * tx + ty * ty);

        if (sDist + tDist > minDistance) continue;

        const res = game.apsp(sIdx, tIdx);
        const total = sDist + tDist + res.distance;

        if (total < minDistance) {
          minDistance = total;
          targetPath = res.path;
        }
      }
    }
  }

  return [source, ...targetPath, target];
};

export const moveAlongPath = (position, path, step) => {
  if (path.length < 2) return;
  while (step > 0 && path.length > 0) {
    const point = path[0];

    const dx = point[0] - position[0];
    const dy = point[1] - position[1];
    const dist = Math.hypot(dx, dy);

    if (dist <= 1e-9) {
      position[0] = point[0];
      position[1] = point[1];
      path.shift();
      continue;
    }

    if (step < dist) {
      const scale = step / dist;
      position[0] += scale * dx;
      position[1] += scale * dy;
      step = 0;
      break;
    }

    position[0] = point[0];
    position[1] = point[1];
    step -= dist;
    path.shift();
  }
  path.unshift([...position]);
};

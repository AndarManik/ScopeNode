import { kickout, newKickoutParams } from "./pathkickout.js";
import { makeLazyAPSP, PathGraph } from "./pathVisibilityGraph.js";

export const pushPathingObstacle = (game, obstacle) => {
  if (!game.pathGraph) game.pathGraph = new PathGraph();

  game.pathGraph.pushPolygon(obstacle.pathPoly);
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

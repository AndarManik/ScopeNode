import { VisibilityGraph } from "./visibilitygraph.js";
import "./martinez.min.js";
import { removeHoles, toMulti } from "./martinezutil.js";

export const pushLightingObstacle = (game, obstacle) => {
  pushManyLightingObstacles(game, [obstacle]);
};

export const pushManyLightingObstacles = (game, obstacles) => {
  obstacles.forEach((obstacle) => {
    const newLightGroup = toMulti(obstacle.poly);
    if (!game.lightTotal) game.lightTotal = newLightGroup;
    else game.lightTotal = martinez.union(game.lightTotal, newLightGroup);
    game.lightTotal = removeHoles(game.lightTotal);
  });
  game.lightGraph = new VisibilityGraph(game);
  game.lightTotal.forEach(([poly]) => game.lightGraph.pushPolygon(poly));
};

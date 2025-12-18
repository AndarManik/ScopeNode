import { game } from "./global.js";
import { ShineGraph } from "./shining.js";
import "./martinez.min.js";

export const extendLights = (polygon) => {
  const newGroup = [[[...polygon, polygon[0]]]];
  if (!game.lightTotal) game.lightTotal = newGroup;
  else game.lightTotal = martinez.union(game.lightTotal, newGroup);
  game.lightTotal = unholy(game.lightTotal);

  game.shineGraph = new ShineGraph();
  game.lightTotal.forEach(([poly]) => game.shineGraph.pushPolygon(poly));
  
};

// skip first cause we use it as the init val reduce
const unholy = (holy) =>
  holy.slice(1).reduce((a, p) => martinez.union(a, [[p[0]]]), [[holy[0][0]]]);

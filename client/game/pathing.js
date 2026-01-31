import { pointInClosedPolygonInclusive } from "./hitreg.js";
import { LightGraph } from "./lightVisibilityGraph.js";
import { removeHoles, toMulti } from "./martinezutil.js";
import { kickout, newKickoutParams } from "./pathkickout.js";

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

  if (!game.apsp) return [source, target];

  const targetVerts = game.pathGraph.visibleIndicesAt(target);
  const targetPointPoly = game.pathGraph.pointPolyAt(target, targetVerts);

  if (!pointInClosedPolygonInclusive(source[0], source[1], targetPointPoly)) {
    const sourceVerts = game.pathGraph.visibleIndicesAt(source);
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

        const { path, distance } = game.apsp(sIdx, tIdx);
        const total = sDist + tDist + distance;

        if (total >= minDistance) continue;

        minDistance = total;
        targetPath = path;
      }
    }
  }

  return [source, ...targetPath, target];
};

export const planPathSafe = (game, source, target, avoid) => {
  if (!game.kickoutParams) {
    return { path: [], distance: 0 };
  }

  const { playerRadius } = game;

  source = kickout(source, game.kickoutParams);
  target = kickout(target, game.kickoutParams);

  const fallBackClosest = avoid([source, target]);
  const fallBackPath = fallBackClosest < playerRadius ? [] : [source, target];

  const straightDistance = Math.hypot(
    target[0] - source[0],
    target[1] - source[1]
  );
  const fallBackDistance = fallBackPath.length ? straightDistance : Infinity;
  const fallBack = { path: fallBackPath, distance: fallBackDistance };

  if (!game.apsp) return fallBack;

  const targetVerts = game.pathGraph.visibleIndicesAt(target);
  const targetPointPoly = game.pathGraph.pointPolyAt(target, targetVerts);

  if (pointInClosedPolygonInclusive(source[0], source[1], targetPointPoly))
    return fallBack;

  const sourceVerts = game.pathGraph.visibleIndicesAt(source);
  const vertices = game.pathGraph.vertices;

  const candidates = [];

  for (const sIdx of sourceVerts) {
    const sx = vertices[sIdx][0] - source[0];
    const sy = vertices[sIdx][1] - source[1];
    const sDist = Math.hypot(sx, sy);

    for (const tIdx of targetVerts) {
      const tx = vertices[tIdx][0] - target[0];
      const ty = vertices[tIdx][1] - target[1];
      const tDist = Math.hypot(tx, ty);

      const result = game.apsp(sIdx, tIdx);
      if (!result) continue;

      const { path, distance } = result;

      if (!path || !path.length || !Number.isFinite(distance)) continue;

      const total = sDist + tDist + distance;
      if (!Number.isFinite(total)) continue;

      const fullPath = [source, ...path, target];
      candidates.push({ path: fullPath, distance: total });
    }
  }

  if (!candidates.length) return fallBack;

  candidates.sort((a, b) => a.distance - b.distance);

  for (const candidate of candidates)
    if (avoid(candidate.path) >= playerRadius) return candidate;

  return fallBack;
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

/**
 * Build a lazy all-pairs shortest path query over a weighted graph.
 * Weights default to Euclidean distance between vertex coordinates.
 *
 * @param {{ vertices: Array<[number,number]>, edges: number[][] }} graph
 * @param {(uIdx:number, vIdx:number, u:[number,number], v:[number,number])=>number} [weightFn]
 * @returns {(source:number, target:number)=>{distance:number, path:Array<[number,number]>}}
 *
 * Conventions:
 * - edges[i] is a list of neighbor indices for vertex i (directed or undirected).
 * - If (source===target), distance = 0 and path = [vertices[source]].
 * - If unreachable, distance = Infinity and path = [].
 * - Returns paths as a list of vertex *coordinates* (not indices).
 */
function makeLazyAPSP(graph, weightFn) {
  const { vertices, edges } = graph;
  const n = vertices.length;

  if (!Array.isArray(vertices) || !Array.isArray(edges) || edges.length !== n) {
    throw new Error("Invalid graph: vertices/edges mismatch.");
  }

  // Default weight: Euclidean distance between coordinates
  const w =
    typeof weightFn === "function"
      ? weightFn
      : (uIdx, vIdx, u, v) => {
          const dx = u[0] - v[0];
          const dy = u[1] - v[1];
          return Math.hypot(dx, dy);
        };

  // Cache: source -> { dist: Float64Array, prev: Int32Array }
  const cache = new Map();

  // Minimal binary heap for Dijkstra
  class MinHeap {
    constructor() {
      this.a = [];
    }
    size() {
      return this.a.length;
    }
    push(item) {
      this.a.push(item);
      this._siftUp(this.a.length - 1);
    }
    pop() {
      if (this.a.length === 0) return undefined;
      const top = this.a[0];
      const last = this.a.pop();
      if (this.a.length) {
        this.a[0] = last;
        this._siftDown(0);
      }
      return top;
    }
    _siftUp(i) {
      const a = this.a;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].key <= a[i].key) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    _siftDown(i) {
      const a = this.a;
      const n = a.length;
      while (true) {
        let l = i * 2 + 1,
          r = l + 1,
          s = i;
        if (l < n && a[l].key < a[s].key) s = l;
        if (r < n && a[r].key < a[s].key) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
  }

  function dijkstraFrom(source) {
    const dist = new Float64Array(n);
    const prev = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      dist[i] = Infinity;
      prev[i] = -1;
    }

    dist[source] = 0;
    const pq = new MinHeap();
    pq.push({ key: 0, v: source });

    while (pq.size() > 0) {
      const { key: d, v: uIdx } = pq.pop();
      if (d !== dist[uIdx]) continue; // stale entry
      const u = vertices[uIdx];

      const nbrs = edges[uIdx] || [];
      for (let k = 0; k < nbrs.length; k++) {
        const vIdx = nbrs[k];
        if (vIdx < 0 || vIdx >= n) continue; // ignore invalid neighbor indices
        const v = vertices[vIdx];
        const wt = w(uIdx, vIdx, u, v);
        if (wt < 0)
          throw new Error(
            "Negative edge weight encountered; Dijkstra requires nonnegative weights."
          );
        const alt = d + wt;
        if (alt < dist[vIdx]) {
          dist[vIdx] = alt;
          prev[vIdx] = uIdx;
          pq.push({ key: alt, v: vIdx });
        }
      }
    }

    cache.set(source, { dist, prev });
    return { dist, prev };
  }

  function reconstructPath(prev, source, target) {
    if (source === target) return [vertices[source]];
    const pathIdx = [];
    for (let v = target; v !== -1; v = prev[v]) pathIdx.push(v);
    if (pathIdx[pathIdx.length - 1] !== source) return []; // unreachable
    pathIdx.reverse();
    return pathIdx.map((i) => vertices[i]);
  }

  return function query(source, target) {
    // Basic validations
    if (
      !Number.isInteger(source) ||
      !Number.isInteger(target) ||
      source < 0 ||
      target < 0 ||
      source >= n ||
      target >= n
    ) {
      throw new Error("source/target out of range.");
    }

    if (source === target) return { distance: 0, path: [vertices[source]] };

    const entry = cache.get(source) || dijkstraFrom(source);
    const { dist, prev } = entry;
    const distance = dist[target];
    if (!Number.isFinite(distance)) return { distance: Infinity, path: [] };

    const path = reconstructPath(prev, source, target);
    return { distance, path };
  };
}

const EPS = 1e-9;
function pointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const cross = abx * apy - aby * apx;
  if (cross < -EPS || cross > EPS) return false;

  const dot = apx * abx + apy * aby;
  if (dot < -EPS) return false;

  const ab2 = abx * abx + aby * aby;
  if (dot > ab2 + EPS) return false;

  return true;
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;

  const apx = px - ax;
  const apy = py - ay;

  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return [ax, ay];

  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  return [ax + t * abx, ay + t * aby];
}


export function makeDistancePathToPolys(polys) {
  // polys: same shape as before => array of [poly0, bodyPolys, ...]
  if (!polys || polys.length === 0) {
    return () => Infinity;
  }

  const prePolys = [];

  for (let p = 0; p < polys.length; p++) {
    const entry = polys[p];
    if (!entry) continue;
    const poly = entry[0]; // as in your old distancePathToPolys
    if (!poly || poly.length < 4) continue; // need at least 3 distinct points + repeat

    const n = poly.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Bake vertices as float arrays + polygon AABB
    for (let i = 0; i < n; i++) {
      const x = +poly[i][0];
      const y = +poly[i][1];
      xs[i] = x;
      ys[i] = y;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Bake edge list (segment endpoints)
    const edges = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const ax = xs[i];
      const ay = ys[i];
      const bx = xs[i + 1];
      const by = ys[i + 1];
      edges[i] = { ax, ay, bx, by };
    }

    prePolys.push({ xs, ys, edges, minX, maxX, minY, maxY });
  }

  if (prePolys.length === 0) {
    return () => Infinity;
  }

  // ---- The baked distance function ----
  return function distancePath(path) {
    if (!path || path.length === 0) return Infinity;
    const plen = path.length;

    // 1) Early exit: any path vertex inside or on boundary of any polygon => distance 0
    for (let i = 0; i < plen; i++) {
      const px = +path[i][0];
      const py = +path[i][1];

      for (let k = 0; k < prePolys.length; k++) {
        const poly = prePolys[k];
        if (
          px < poly.minX ||
          px > poly.maxX ||
          py < poly.minY ||
          py > poly.maxY
        ) {
          continue; // outside AABB, can't be inside polygon
        }

        if (pointInClosedPolygonInclusivePre(px, py, poly)) {
          return 0;
        }
      }
    }

    // 2) Single-point path: just point->poly distance
    if (plen === 1) {
      const px = +path[0][0];
      const py = +path[0][1];

      let bestD2 = Infinity;

      for (let k = 0; k < prePolys.length; k++) {
        const poly = prePolys[k];

        // quick AABB cull: if current bestD2 is finite, we can skip polygons
        // whose bbox is already farther than sqrt(bestD2)
        if (bestD2 < Infinity) {
          const dx =
            px < poly.minX
              ? poly.minX - px
              : px > poly.maxX
              ? px - poly.maxX
              : 0;
          const dy =
            py < poly.minY
              ? poly.minY - py
              : py > poly.maxY
              ? py - poly.maxY
              : 0;
          const aabbD2 = dx * dx + dy * dy;
          if (aabbD2 >= bestD2) continue;
        }

        const d2 = pointToPolyDist2Pre(px, py, poly);
        if (d2 < bestD2) {
          bestD2 = d2;
          if (bestD2 === 0) return 0;
        }
      }

      return bestD2 === Infinity ? Infinity : Math.sqrt(bestD2);
    }

    // 3) General case: path segments vs polygon edges
    let bestD2 = Infinity;

    for (let i = 0; i < plen - 1; i++) {
      const ax = +path[i][0];
      const ay = +path[i][1];
      const bx = +path[i + 1][0];
      const by = +path[i + 1][1];

      const segMinX = ax < bx ? ax : bx;
      const segMaxX = ax > bx ? ax : bx;
      const segMinY = ay < by ? ay : by;
      const segMaxY = ay > by ? ay : by;

      for (let k = 0; k < prePolys.length; k++) {
        const poly = prePolys[k];

        // AABB cull: if segment bbox doesn't intersect poly bbox, skip
        if (
          segMaxX < poly.minX ||
          segMinX > poly.maxX ||
          segMaxY < poly.minY ||
          segMinY > poly.maxY
        ) {
          continue;
        }

        const edges = poly.edges;

        for (let j = 0; j < edges.length; j++) {
          const e = edges[j];
          const cx = e.ax;
          const cy = e.ay;
          const dx = e.bx;
          const dy = e.by;

          // Segment intersection => distance 0
          if (segmentsIntersectInclusive(ax, ay, bx, by, cx, cy, dx, dy)) {
            return 0;
          }

          // Otherwise, update min distance using endpoint -> opposite segment distances,
          // same logic as your original function but using baked edges.

          // A -> CD
          let q = closestPointOnSegment(ax, ay, cx, cy, dx, dy);
          let ddx = q[0] - ax;
          let ddy = q[1] - ay;
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) {
            bestD2 = d2;
            if (bestD2 === 0) return 0;
          }

          // B -> CD
          q = closestPointOnSegment(bx, by, cx, cy, dx, dy);
          ddx = q[0] - bx;
          ddy = q[1] - by;
          d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) {
            bestD2 = d2;
            if (bestD2 === 0) return 0;
          }

          // C -> AB
          q = closestPointOnSegment(cx, cy, ax, ay, bx, by);
          ddx = q[0] - cx;
          ddy = q[1] - cy;
          d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) {
            bestD2 = d2;
            if (bestD2 === 0) return 0;
          }

          // D -> AB
          q = closestPointOnSegment(dx, dy, ax, ay, bx, by);
          ddx = q[0] - dx;
          ddy = q[1] - dy;
          d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) {
            bestD2 = d2;
            if (bestD2 === 0) return 0;
          }
        }
      }
    }

    if (bestD2 === Infinity) return Infinity;
    return Math.sqrt(bestD2);
  };
}

// ---- Helpers that operate on the baked polygon representation ----

function pointInClosedPolygonInclusivePre(px, py, poly) {
  const { xs, ys, edges } = poly;
  const n = xs.length;

  // On-boundary check
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (pointOnSegment(px, py, e.ax, e.ay, e.bx, e.by)) return true;
  }

  // Ray-casting for interior
  let inside = false;
  for (let i = 0, j = n - 2; i < n - 1; j = i++) {
    const xi = xs[i];
    const yi = ys[i];
    const xj = xs[j];
    const yj = ys[j];

    const intersects = yi > py !== yj > py;
    if (!intersects) continue;

    const xAtY = xj + ((py - yj) * (xi - xj)) / (yi - yj);
    if (xAtY > px) inside = !inside;
  }
  return inside;
}

function pointToPolyDist2Pre(px, py, poly) {
  const { edges } = poly;
  let bestD2 = Infinity;

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const q = closestPointOnSegment(px, py, e.ax, e.ay, e.bx, e.by);
    const dx = q[0] - px;
    const dy = q[1] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      if (bestD2 === 0) break;
    }
  }

  return bestD2;
}

function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (v > EPS) return 1;
  if (v < -EPS) return -1;
  return 0;
}

function segmentsIntersectInclusive(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
  if (o2 === 0 && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
  if (o3 === 0 && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
  if (o4 === 0 && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;

  return false;
}

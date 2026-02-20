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

  const lazyAPSP = makeLazyAPSP(game.pathGraph);
  game.apsp = lazyAPSP.query;
  game.apspGetEntry = lazyAPSP.dijkstraFrom;
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

  let minDistance = Number.MAX_VALUE;

  if (!pointInClosedPolygonInclusive(source[0], source[1], targetPointPoly)) {
    const sourceVerts = game.pathGraph.visibleIndicesAt(source);
    const vertices = game.pathGraph.vertices;

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

  if (!isFinite(minDistance))
    minDistance = Math.hypot(source[0] - target[0], source[1] - target[1]);

  return { path: [source, ...targetPath, target], distance: minDistance };
};

export const planPathSafe = (game, source, target, avoidASPS) => {
  if (!game.kickoutParams) return { path: [], distance: 0 };

  const { playerRadius } = game;
  const { query, segmentDistanceToPolys, pointDistanceToPolys } = avoidASPS;

  source = kickout(source, game.kickoutParams);
  target = kickout(target, game.kickoutParams);

  const fallBackClosest = segmentDistanceToPolys(...source, ...target);
  const fallBackPath = fallBackClosest < playerRadius ? [] : [source, target];

  const straightDistance = Math.hypot(
    target[0] - source[0],
    target[1] - source[1],
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

    if (segmentDistanceToPolys(sx, sy, ...source) < playerRadius) continue;

    for (const tIdx of targetVerts) {
      const tx = vertices[tIdx][0] - target[0];
      const ty = vertices[tIdx][1] - target[1];
      const tDist = Math.hypot(tx, ty);

      if (segmentDistanceToPolys(tx, ty, ...target) < playerRadius) continue;

      const result = query(sIdx, tIdx);
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

  return candidates[0];
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

function makeLazyAPSP(graph) {
  const { vertices, edges } = graph;
  const n = vertices.length;

  if (!Array.isArray(vertices) || !Array.isArray(edges) || edges.length !== n)
    throw new Error("Invalid graph: vertices/edges mismatch.");

  const cache = new Map();

  function dijkstraFrom(source) {
    const entry = cache.get(source);
    if (entry) return entry;

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
        const dx = u[0] - v[0];
        const dy = u[1] - v[1];
        const wt = Math.hypot(dx, dy);
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

  function query(source, target) {
    const isNumber = Number.isInteger(source) && Number.isInteger(target);
    const isNonNegative = isNumber && source >= 0 && target >= 0;
    const inRange = isNonNegative && source < n && target < n;
    if (!inRange)
      throw new Error("safeGraphQuery: source/target out of range.");

    if (source === target) return { distance: 0, path: [vertices[source]] };

    const { dist, prev } = dijkstraFrom(source);
    const distance = dist[target];
    if (!Number.isFinite(distance)) return { distance: Infinity, path: [] };
    const path = reconstructPath(prev, source, target);
    return { distance, path };
  }

  return { query, dijkstraFrom };
}

/**
 * Build a *safe* shortest-path query over game.pathGraph, given avoid polys.
 *
 * OPTIMIZATIONS INCLUDED:
 * 1) Lazy vertex legality cache (vertexLegal + pointDistanceToPolys)
 * 2) Constrained search uses A* with an admissible heuristic from unconstrained APSP
 *    - requires: game.apspGetEntry(targetIdx).dist (dist-from-target array), OR falls back to Euclid-to-target
 * 3) Optional best-so-far bound from prefix/suffix stitching of unconstrained APSP path (prunes A*)
 *
 * Returns: { query, segmentDistanceToPolys, pointDistanceToPolys }
 */
export function makeSafeGraphQueryFromPolys(game, polys) {
  const r = +game.playerRadius || 0;
  const graph = game.pathGraph;
  if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges))
    throw new Error("makeSafeGraphQueryFromPolys: game.pathGraph invalid.");

  const { vertices, edges } = graph;
  const n = vertices.length;

  const EPS = 1e-9;

  // --- Bake polys (same structure as makeDistancePathToPolys) ---
  // Each poly: { xs, ys, edges:[{ax,ay,bx,by}], minX,maxX,minY,maxY }
  const prePolys = [];
  if (polys && polys.length) {
    for (let p = 0; p < polys.length; p++) {
      const entry = polys[p];
      if (!entry) continue;
      const poly = entry[0];
      if (!poly || poly.length < 4) continue;

      const m = poly.length;
      const xs = new Float64Array(m);
      const ys = new Float64Array(m);

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (let i = 0; i < m; i++) {
        const x = +poly[i][0];
        const y = +poly[i][1];
        xs[i] = x;
        ys[i] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const e = new Array(m - 1);
      for (let i = 0; i < m - 1; i++) {
        const ax = xs[i],
          ay = ys[i];
        const bx = xs[i + 1],
          by = ys[i + 1];
        e[i] = { ax, ay, bx, by };
      }

      prePolys.push({ xs, ys, edges: e, minX, maxX, minY, maxY });
    }
  }

  // --- Virtual culling cache ---
  // edgeKey(u,v) -> boolean ok

  const edgeOk = new Map();

  const vertexLegal = [];
  const refToIdx = new Map();
  for (let i = 0; i < n; i++) {
    const p = vertices[i];
    vertexLegal[i] = pointDistanceToPolys(p[0], p[1]) >= r;
    refToIdx.set(p, i);
  }

  // ---------- Geometry helpers ----------

  function pointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax,
      aby = by - ay;
    const apx = px - ax,
      apy = py - ay;

    const cross = abx * apy - aby * apx;
    if (cross < -EPS || cross > EPS) return false;

    const dot = apx * abx + apy * aby;
    if (dot < -EPS) return false;

    const ab2 = abx * abx + aby * aby;
    if (dot > ab2 + EPS) return false;

    return true;
  }

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax,
      aby = by - ay;
    const apx = px - ax,
      apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return [ax, ay];

    let t = (apx * abx + apy * aby) / ab2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return [ax + t * abx, ay + t * aby];
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

  function pointInClosedPolygonInclusivePre(px, py, poly) {
    // On-boundary check
    for (let i = 0; i < poly.edges.length; i++) {
      const e = poly.edges[i];
      if (pointOnSegment(px, py, e.ax, e.ay, e.bx, e.by)) return true;
    }

    // Ray cast
    const { xs, ys } = poly;
    const m = xs.length;
    let inside = false;
    for (let i = 0, j = m - 2; i < m - 1; j = i++) {
      const xi = xs[i],
        yi = ys[i];
      const xj = xs[j],
        yj = ys[j];
      const intersects = yi > py !== yj > py;
      if (!intersects) continue;
      const xAtY = xj + ((py - yj) * (xi - xj)) / (yi - yj);
      if (xAtY > px) inside = !inside;
    }
    return inside;
  }

  /**
   * Minimum distance between segment AB and the union of polygons.
   * Returns 0 if AB intersects/touches or either endpoint is inside/on boundary.
   */
  function segmentDistanceToPolys(ax, ay, bx, by) {
    if (prePolys.length === 0) return Infinity;

    // Endpoint-in-poly early exit
    for (let k = 0; k < prePolys.length; k++) {
      const poly = prePolys[k];

      if (
        ax >= poly.minX &&
        ax <= poly.maxX &&
        ay >= poly.minY &&
        ay <= poly.maxY &&
        pointInClosedPolygonInclusivePre(ax, ay, poly)
      ) {
        return 0;
      }
      if (
        bx >= poly.minX &&
        bx <= poly.maxX &&
        by >= poly.minY &&
        by <= poly.maxY &&
        pointInClosedPolygonInclusivePre(bx, by, poly)
      ) {
        return 0;
      }
    }

    let bestD2 = Infinity;

    const segMinX = ax < bx ? ax : bx;
    const segMaxX = ax > bx ? ax : bx;
    const segMinY = ay < by ? ay : by;
    const segMaxY = ay > by ? ay : by;

    for (let k = 0; k < prePolys.length; k++) {
      const poly = prePolys[k];

      // Segment bbox vs poly bbox cull
      if (
        segMaxX < poly.minX ||
        segMinX > poly.maxX ||
        segMaxY < poly.minY ||
        segMinY > poly.maxY
      ) {
        continue;
      }

      const pe = poly.edges;
      for (let j = 0; j < pe.length; j++) {
        const e = pe[j];
        const cx = e.ax,
          cy = e.ay;
        const dx = e.bx,
          dy = e.by;

        if (segmentsIntersectInclusive(ax, ay, bx, by, cx, cy, dx, dy))
          return 0;

        // A -> CD
        let q = closestPointOnSegment(ax, ay, cx, cy, dx, dy);
        let ddx = q[0] - ax,
          ddy = q[1] - ay;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) bestD2 = d2;

        // B -> CD
        q = closestPointOnSegment(bx, by, cx, cy, dx, dy);
        ddx = q[0] - bx;
        ddy = q[1] - by;
        d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) bestD2 = d2;

        // C -> AB
        q = closestPointOnSegment(cx, cy, ax, ay, bx, by);
        ddx = q[0] - cx;
        ddy = q[1] - cy;
        d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) bestD2 = d2;

        // D -> AB
        q = closestPointOnSegment(dx, dy, ax, ay, bx, by);
        ddx = q[0] - dx;
        ddy = q[1] - dy;
        d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) bestD2 = d2;

        if (bestD2 === 0) return 0;
      }
    }

    return bestD2 === Infinity ? Infinity : Math.sqrt(bestD2);
  }

  function pointDistanceToPolys(px, py) {
    if (prePolys.length === 0) return Infinity;

    // inside/on-boundary early exit
    for (let k = 0; k < prePolys.length; k++) {
      const poly = prePolys[k];
      if (
        px >= poly.minX &&
        px <= poly.maxX &&
        py >= poly.minY &&
        py <= poly.maxY &&
        pointInClosedPolygonInclusivePre(px, py, poly)
      ) {
        return 0;
      }
    }

    let bestD2 = Infinity;

    // NOTE: do NOT bbox-cull here by requiring (px,py) be within poly bbox.
    // Closest point to a poly can be outside its bbox; the bbox is still useful for a *lower bound*,
    // but your original pointDistanceToPolys incorrectly skipped polys whose bbox doesn't contain the point.
    // We'll do a cheap lower-bound check instead:
    for (let k = 0; k < prePolys.length; k++) {
      const poly = prePolys[k];

      // Lower bound from AABB distance
      let dx = 0;
      if (px < poly.minX) dx = poly.minX - px;
      else if (px > poly.maxX) dx = px - poly.maxX;

      let dy = 0;
      if (py < poly.minY) dy = poly.minY - py;
      else if (py > poly.maxY) dy = py - poly.maxY;

      const lb2 = dx * dx + dy * dy;
      if (lb2 >= bestD2) continue;

      const pe = poly.edges;
      for (let j = 0; j < pe.length; j++) {
        const e = pe[j];
        const q = closestPointOnSegment(px, py, e.ax, e.ay, e.bx, e.by);
        const ddx = q[0] - px,
          ddy = q[1] - py;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) bestD2 = d2;
        if (bestD2 === 0) return 0;
      }
    }

    return bestD2 === Infinity ? Infinity : Math.sqrt(bestD2);
  }

  function isEdgeLegal(u, v) {
    const key = u > v ? u * n + v : u + v * n;
    const cached = edgeOk.get(key);
    if (cached !== undefined) return cached;

    // cheap cull: if either endpoint is illegal, edge is illegal
    if (!vertexLegal[u] || !vertexLegal[v]) {
      edgeOk.set(key, false);
      return false;
    }

    const a = vertices[u];
    const b = vertices[v];
    const d = segmentDistanceToPolys(a[0], a[1], b[0], b[1]);
    const ok = d >= r;
    edgeOk.set(key, ok);
    return ok;
  }

  function pathIsLegalByEdges(pathCoords) {
    if (!pathCoords || pathCoords.length <= 1) return true;
    for (let i = 0; i < pathCoords.length; i++) {
      const u = refToIdx.get(pathCoords[i]);
      if (u !== undefined && !vertexLegal[u]) return false;
    }
    for (let i = 0; i < pathCoords.length - 1; i++) {
      const u = refToIdx.get(pathCoords[i]);
      const v = refToIdx.get(pathCoords[i + 1]);
      if (u === undefined || v === undefined) {
        const a = pathCoords[i];
        const b = pathCoords[i + 1];
        if (segmentDistanceToPolys(a[0], a[1], b[0], b[1]) < r) return false;
      } else {
        if (!isEdgeLegal(u, v)) return false;
      }
    }
    return true;
  }

  function reconstructIdxPath(prev, s, t) {
    if (s === t) return [s];
    const out = [];
    for (let v = t; v !== -1; v = prev[v]) out.push(v);
    if (out[out.length - 1] !== s) return [];
    out.reverse();
    return out;
  }

  function constrainedAStar(sourceIdx, targetIdx) {
    const hDist = game.apspGetEntry(targetIdx).dist;
    const h0 = hDist[sourceIdx];

    const verticesIllegal = !vertexLegal[sourceIdx] || !vertexLegal[targetIdx];
    if (verticesIllegal || !Number.isFinite(h0))
      return { distance: Infinity, path: [] };

    const gScore = new Float64Array(n);
    const fBest = new Float64Array(n);
    const prev = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      gScore[i] = Infinity;
      fBest[i] = Infinity;
      prev[i] = -1;
    }

    gScore[sourceIdx] = 0;
    fBest[sourceIdx] = h0;

    const pq = new MinHeap();
    pq.push({ key: h0, v: sourceIdx });

    while (pq.size() > 0) {
      const { key: f, v: u } = pq.pop();

      // skip stale heap entries
      if (f > fBest[u]) continue;

      if (u === targetIdx) break;

      const nbrs = edges[u];
      if (!nbrs) continue;

      const uPos = vertices[u];
      const g = gScore[u]; // finite if reached via best-f

      for (let k = 0; k < nbrs.length; k++) {
        const v = nbrs[k];
        if (v < 0 || v >= n) continue;

        if (!vertexLegal[v]) continue;
        if (!isEdgeLegal(u, v)) continue;

        const hv = hDist[v];
        if (!Number.isFinite(hv)) continue;

        const vPos = vertices[v];
        const w = Math.hypot(uPos[0] - vPos[0], uPos[1] - vPos[1]);
        const alt = g + w;

        const nf = alt + hv;

        // only accept if strictly better
        if (nf < fBest[v]) {
          fBest[v] = nf;
          gScore[v] = alt;
          prev[v] = u;
          pq.push({ key: nf, v });
        }
      }
    }

    const d = gScore[targetIdx];
    if (!Number.isFinite(d)) return { distance: Infinity, path: [] };

    const idxPath = reconstructIdxPath(prev, sourceIdx, targetIdx);
    if (!idxPath.length) return { distance: Infinity, path: [] };

    return { distance: d, path: idxPath.map((i) => vertices[i]) };
  }

  function query(sourceIdx, targetIdx) {
    const isNumber = Number.isInteger(sourceIdx) && Number.isInteger(targetIdx);
    const isNonNegative = isNumber && sourceIdx >= 0 && targetIdx >= 0;
    const inRange = isNonNegative && sourceIdx < n && targetIdx < n;
    if (!inRange)
      throw new Error("safeGraphQuery: source/target out of range.");

    if (sourceIdx === targetIdx)
      return { distance: 0, path: [vertices[sourceIdx]] };

    // hard early rejects via vertex legality
    if (!vertexLegal[sourceIdx] || !vertexLegal[targetIdx])
      return { distance: Infinity, path: [] };

    const res = game.apsp(sourceIdx, targetIdx);
    if (res.path.length && pathIsLegalByEdges(res.path)) return res;

    return constrainedAStar(sourceIdx, targetIdx);
  }

  return { query, segmentDistanceToPolys, pointDistanceToPolys };
}

class MinHeap {
  constructor() {
    this.a = [];
  }
  size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        let l = i * 2 + 1,
          r = l + 1,
          s = i;
        if (l < a.length && a[l].key < a[s].key) s = l;
        if (r < a.length && a[r].key < a[s].key) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

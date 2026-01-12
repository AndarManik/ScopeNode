/**
 * Returns:
 *  - [x,y] if the point is inside/on the polygon boundary
 *  - [ix,iy] for the first circle↔polygon intersection found
 *  - null if outside and no intersection
 *
 * Inputs:
 *  - position: [x,y]
 *  - radius: number
 *  - poly: closed polygon as [[x,y], ...] where poly[0] equals poly[poly.length-1]
 *
 * Notes:
 *  - "inside" treats boundary as inside (so you keep the original position).
 *  - Intersection returns the first one found while scanning edges (not necessarily nearest).
 */
export function registerHit(position, radius, poly) {
  const px = +position[0];
  const py = +position[1];
  const r = +radius;
  if (!poly || poly.length < 4 || !(r >= 0)) return null; // need at least 3 verts + closure

  // ---- 1) point-in-polygon (ray casting), boundary-inclusive ----
  if (pointInClosedPolygonInclusive(px, py, poly)) return [px, py];

  // ---- 2) circle vs polygon edges: find any intersection, return immediately ----
  const r2 = r * r;

  // poly is closed; iterate edges [i] -> [i+1] up to length-2
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = +poly[i][0],
      ay = +poly[i][1];
    const bx = +poly[i + 1][0],
      by = +poly[i + 1][1];

    const hit = segmentCircleFirstIntersection(ax, ay, bx, by, px, py, r, r2);
    if (hit) return hit; // [ix, iy]
  }

  return null;
}

/** Boundary-inclusive point in polygon (closed poly). */
function pointInClosedPolygonInclusive(px, py, poly) {
  // quick boundary check: if point is on any segment, treat as inside
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = +poly[i][0],
      ay = +poly[i][1];
    const bx = +poly[i + 1][0],
      by = +poly[i + 1][1];
    if (pointOnSegment(px, py, ax, ay, bx, by)) return true;
  }

  // ray casting (odd-even rule)
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
    const xi = +poly[i][0],
      yi = +poly[i][1];
    const xj = +poly[j][0],
      yj = +poly[j][1];

    // check if edge straddles horizontal ray at py
    const intersects = yi > py !== yj > py;
    if (intersects) {
      const xAtY = xj + ((py - yj) * (xi - xj)) / (yi - yj);
      if (xAtY > px) inside = !inside;
    }
  }
  return inside;
}

function pointOnSegment(px, py, ax, ay, bx, by) {
  // colinearity + within bounding box
  const abx = bx - ax,
    aby = by - ay;
  const apx = px - ax,
    apy = py - ay;
  const cross = abx * apy - aby * apx;
  // small epsilon helps with float noise
  const EPS = 1e-9;
  if (cross < -EPS || cross > EPS) return false;

  const dot = apx * abx + apy * aby;
  if (dot < -EPS) return false;
  const ab2 = abx * abx + aby * aby;
  if (dot > ab2 + EPS) return false;

  return true;
}

/**
 * Returns first intersection point between segment AB and circle centered at C with radius r.
 * If none, returns null.
 */
function segmentCircleFirstIntersection(ax, ay, bx, by, cx, cy, r, r2) {
  // parametric: P(t)=A + t*(B-A), t in [0,1]
  const dx = bx - ax;
  const dy = by - ay;

  const fx = ax - cx;
  const fy = ay - cy;

  const a = dx * dx + dy * dy;
  if (a === 0) {
    // degenerate segment (A==B): point-circle test
    const dist2 = fx * fx + fy * fy;
    return dist2 <= r2 ? [ax, ay] : null;
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r2;

  // solve a t^2 + b t + c = 0
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);

  // two roots
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  // pick the first valid intersection along the segment in scan order
  // (prefer smaller t; if tangential, t1==t2)
  if (t1 >= 0 && t1 <= 1) return [ax + t1 * dx, ay + t1 * dy];
  if (t2 >= 0 && t2 <= 1) return [ax + t2 * dx, ay + t2 * dy];

  return null;
}

export function registerTarget(shooter, enemies, radius) {
  // who is the shooter closest to shooting.
  let bodyDist = Infinity;
  let bodyPoint = null;
  let bestEnemy = null;
  for (const enemy of enemies) {
    const { point, dist2 } = closestPointToBodyUnion(...shooter[2], enemy[1]);
    if (dist2 < bodyDist) {
      bestEnemy = enemy;
      bodyDist = dist2;
      bodyPoint = point;
    }
  }
  if (!bestEnemy) return [null, false];

  const { point: subTarget, dist2: enemyBodyDist } = closestPointToBodyUnion(
    ...bestEnemy[2],
    shooter[1]
  );

  const { point: target, dist2: enemyPointDist } = closestPointToClosedPolygon(
    ...(subTarget || bestEnemy[2]),
    shooter[0]
  );

  const pointDist = closestPointToClosedPolygon(
    ...bodyPoint,
    bestEnemy[0]
  ).dist2;

  const shooterAdvantage = Math.sqrt(pointDist) > radius;

  const targetAdvantage = subTarget
    ? Math.sqrt(enemyPointDist) > radius
    : Math.sqrt(enemyPointDist) - Math.sqrt(enemyBodyDist) > radius;

  const targetClose = Math.sqrt(enemyBodyDist) < radius * 8;

  return [targetClose ? target : null, shooterAdvantage && !targetAdvantage];
}

/** Closest point to union of bodyPolys (min over polys). */
function closestPointToBodyUnion(px, py, bodyPolys) {
  let bestPoint = null;
  let bestD2 = Infinity;

  for (let i = 0; i < bodyPolys.length; i++) {
    const poly = bodyPolys[i];
    if (!poly || poly.length < 4) continue;

    const { point, dist2 } = closestPointToClosedPolygon(px, py, poly);
    if (dist2 < bestD2) {
      bestD2 = dist2;
      bestPoint = point;
      if (bestD2 === 0) break;
    }
  }

  return { point: bestPoint, dist2: bestD2 };
}

/**
 * Returns the closest point on/in a CLOSED polygon to point P.
 * If P is inside/on boundary => { point: P, dist2: 0 }
 * else => closest point on boundary segments.
 */
function closestPointToClosedPolygon(px, py, poly) {
  if (pointInClosedPolygonInclusive(px, py, poly)) {
    return { point: [px, py], dist2: 0 };
  }

  let bestX = 0,
    bestY = 0;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length - 1; i++) {
    const ax = +poly[i][0],
      ay = +poly[i][1];
    const bx = +poly[i + 1][0],
      by = +poly[i + 1][1];

    const q = closestPointOnSegment(px, py, ax, ay, bx, by);
    const dx = q[0] - px;
    const dy = q[1] - py;
    const d2 = dx * dx + dy * dy;

    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = q[0];
      bestY = q[1];
      if (bestD2 === 0) break;
    }
  }

  return { point: [bestX, bestY], dist2: bestD2 };
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

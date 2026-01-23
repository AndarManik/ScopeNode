export function registerHit(position, radius, poly) {
  const px = +position[0];
  const py = +position[1];
  const r = +radius;
  if (!poly || poly.length < 4 || !(r >= 0)) return null;
  if (pointInClosedPolygonInclusive(px, py, poly)) return [px, py];

  const r2 = r * r;
  let hit = null;
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = +poly[i][0];
    const ay = +poly[i][1];
    const bx = +poly[i + 1][0];
    const by = +poly[i + 1][1];
    hit = segmentCircleFirstIntersection(ax, ay, bx, by, px, py, r2);
    if (hit) break;
  }
  return hit;
}

function pointInClosedPolygonInclusive(px, py, poly) {
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = +poly[i][0];
    const ay = +poly[i][1];
    const bx = +poly[i + 1][0];
    const by = +poly[i + 1][1];
    if (pointOnSegment(px, py, ax, ay, bx, by)) return true;
  }

  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
    const xi = +poly[i][0];
    const yi = +poly[i][1];
    const xj = +poly[j][0];
    const yj = +poly[j][1];
    const intersects = yi > py !== yj > py;
    if (!intersects) continue;

    const xAtY = xj + ((py - yj) * (xi - xj)) / (yi - yj);
    if (xAtY > px) inside = !inside;
  }
  return inside;
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

function segmentCircleFirstIntersection(ax, ay, bx, by, cx, cy, r2) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;

  const a = dx * dx + dy * dy;
  const dist2 = fx * fx + fy * fy;
  if (a === 0) return dist2 <= r2 ? [ax, ay] : null;

  const b = 2 * (fx * dx + fy * dy);
  const c = dist2 - r2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return [ax + t1 * dx, ay + t1 * dy];
  if (t2 >= 0 && t2 <= 1) return [ax + t2 * dx, ay + t2 * dy];

  return null;
}

export function registerTarget(shooter, enemies, radius) {
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

  const target = closestPointToClosedPolygon(
    ...(subTarget || bestEnemy[2]),
    shooter[0]
  ).point;

  const pointDist = closestPointToClosedPolygon(
    ...bodyPoint,
    bestEnemy[0]
  ).dist2;

  const shooterAdvantage = Math.sqrt(pointDist) > radius;

  const targetClose = Math.sqrt(enemyBodyDist) < radius * 8;

  return [targetClose ? target : null, shooterAdvantage];
}

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

function closestPointToClosedPolygon(px, py, poly) {
  if (pointInClosedPolygonInclusive(px, py, poly))
    return { point: [px, py], dist2: 0 };

  let bestX = 0;
  let bestY = 0;
  let bestD2 = Infinity;

  for (let i = 0; i < poly.length - 1; i++) {
    const ax = +poly[i][0];
    const ay = +poly[i][1];
    const bx = +poly[i + 1][0];
    const by = +poly[i + 1][1];

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

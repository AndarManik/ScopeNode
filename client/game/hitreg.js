export const registerTeamHits = (game, team1States, team2States, time) => {
  const playerRadius = game.playerRadius;
  const timeAlpha = Math.max(0, (time - 30) / 30) ** 3;

  const obstacleRadius =
    (1 - timeAlpha) * playerRadius +
    timeAlpha * Math.hypot(game.mapWidth, game.mapHeight);

  const center = game.centerObjective;
  const shots = [];

  for (const team1Player of team1States) {
    const uuid1 = team1Player.uuid;
    const los1 = team1Player.light[0];

    for (const team2Player of team2States) {
      const uuid2 = team2Player.uuid;
      const los2 = team2Player.light[0];

      // team1 kills team2
      const hit1 = registerHit(team2Player.position, playerRadius, los1);
      if (hit1) {
        shots.push({
          team1: true,
          killer: uuid1,
          killed: uuid2,
          killerPosition: team1Player.position,
          killedPosition: team2Player.position,
          hit: hit1,
        });
      }

      // team2 kills team1
      const hit2 = registerHit(team1Player.position, playerRadius, los2);
      if (hit2) {
        shots.push({
          team2: true,
          killer: uuid2,
          killed: uuid1,
          killerPosition: team2Player.position,
          killedPosition: team1Player.position,
          hit: hit2,
        });
      }
    }
  }

  // team1 touching objective wins vs all team2
  for (const team1Player of team1States) {
    const dx = team1Player.position[0] - center[0];
    const dy = team1Player.position[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy) - playerRadius;
    if (dist > obstacleRadius) continue;
    const uuid1 = team1Player.uuid;
    for (const team2Player of team2States) {
      const uuid2 = team2Player.uuid;
      shots.push({
        team1: true,
        killer: uuid1,
        killed: uuid2,
        killerPosition: team1Player.position,
        killedPosition: team2Player.position,
        hit: team2Player.position,
      });
    }
  }

  // team2 touching objective wins vs all team1
  for (const team2Player of team2States) {
    const dx = team2Player.position[0] - center[0];
    const dy = team2Player.position[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy) - playerRadius;
    if (dist > obstacleRadius) continue;
    const uuid2 = team2Player.uuid;
    for (const team1Player of team1States) {
      const uuid1 = team1Player.uuid;
      shots.push({
        team2: true,
        killer: uuid2,
        killed: uuid1,
        killerPosition: team2Player.position,
        killedPosition: team1Player.position,
        hit: team1Player.position,
      });
    }
  }

  return shots;
};

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

export function pointInClosedPolygonInclusive(px, py, poly) {
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

const translateNormalIntoPoly = (
  from,
  line,
  distance,
  poly,
  wantInside = true,
) => {
  if (!line || line.length !== 2) return [from[0], from[1]];

  const ax = line[0][0];
  const ay = line[0][1];
  const bx = line[1][0];
  const by = line[1][1];

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [from[0], from[1]];

  // Two candidate points, one on each unit normal
  const nx = -dy / len;
  const ny = dx / len;

  const p1 = [from[0] + nx * distance, from[1] + ny * distance];
  const p2 = [from[0] - nx * distance, from[1] - ny * distance];

  const in1 = pointInClosedPolygonInclusive(p1[0], p1[1], poly);
  const in2 = pointInClosedPolygonInclusive(p2[0], p2[1], poly);

  // If we want the point inside the polygon:
  // - choose the one inside if exactly one is inside
  // - if both inside or both outside (degenerate/ambiguous), fall back deterministically
  if (wantInside) {
    if (in1 && !in2) return p1;
    if (in2 && !in1) return p2;
    // both true or both false
    return p1;
  }

  // If we want the point outside the polygon:
  if (!wantInside) {
    if (!in1 && in2) return p1;
    if (!in2 && in1) return p2;
    // both true or both false
    return p1;
  }
};

export function allKillTargets(game, position, enemies) {
  const killTargets = [];
  if (!position || position.length === 0 || !enemies || enemies.length === 0)
    return killTargets;

  // fudge factors, any amount above float rounding is good here
  const fudge = 0.1;
  const r_ = fudge * game.playerRadius;
  const r = r_ + game.playerRadius;
  const r2 = r * r;

  for (const enemy of enemies) {
    const closestBody = closestPointToBodyUnion(...position, enemy[1]);
    if (!closestBody.point) continue;

    const closestVision = closestPointToClosedPolygon(
      ...closestBody.point,
      enemy[0],
    );

    if (closestVision.dist2 < r2) continue;

    const killTarget = translateNormalIntoPoly(
      closestBody.point,
      closestBody.line, // must be provided by closestPointToBodyUnion
      r_,
      closestBody.poly,
    );

    killTargets.push(killTarget);
  }

  return killTargets;
}

const translateTowards = (from, to, distance) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [from[0], from[1]];

  const t = distance / len; // no clamping, can overshoot
  return [from[0] + dx * t, from[1] + dy * t];
};

const translateAway = (from, fromWhat, distance) => {
  const dx = from[0] - fromWhat[0];
  const dy = from[1] - fromWhat[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [from[0], from[1]];

  const t = distance / len; // no clamping, can overshoot
  return [from[0] + dx * t, from[1] + dy * t];
};

export function allDieTargets(game, position, enemies) {
  const dieTargets = [];
  if (!position || position.length === 0 || !enemies || enemies.length === 0)
    return dieTargets;

  for (const enemy of enemies) {
    const closestBody = closestPointToBodyUnion(...position, enemy[1]).point;

    const closestVision = closestPointToClosedPolygon(...closestBody, enemy[0]);

    const a = closestVision.line[0];
    const b = closestVision.line[1];

    const [ex, ey] = enemy[2];
    const dax = a[0] - ex;
    const day = a[1] - ey;
    const dbx = b[0] - ex;
    const dby = b[1] - ey;
    const da2 = dax * dax + day * day;
    const db2 = dbx * dbx + dby * dby;

    const pointOfInterest = da2 <= db2 ? a : b;
    const r = game.playerRadius;

    const risk = 0.5;
    const arisk = 1 - risk;
    // 0 to 1

    const fleeX = risk * ex + arisk * pointOfInterest[0];
    const fleeY = risk * ey + arisk * pointOfInterest[1];

    const dieTarget = translateAway(position, [fleeX, fleeY], r);

    dieTargets.push(dieTarget);
  }

  return dieTargets;
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
    shooter[1],
  );

  const target = closestPointToClosedPolygon(
    ...(subTarget || bestEnemy[2]),
    shooter[0],
  ).point;

  const pointDist = closestPointToClosedPolygon(
    ...bodyPoint,
    bestEnemy[0],
  ).dist2;

  const shooterAdvantage = Math.sqrt(pointDist) > radius;

  const targetClose = Math.sqrt(enemyBodyDist) < radius * 8;

  return [targetClose ? target : null, shooterAdvantage];
}

function closestPointToBodyUnion(px, py, bodyPolys) {
  let bestPoly = null;
  let bestLine = null;
  let bestPoint = null;
  let bestD2 = Infinity;
  for (let i = 0; i < bodyPolys.length; i++) {
    const poly = bodyPolys[i];
    const { line, point, dist2 } = closestPointToClosedPolygon(px, py, poly);
    if (dist2 < bestD2) {
      bestD2 = dist2;
      bestPoint = point;
      bestLine = line;
      bestPoly = poly;
      if (bestD2 === 0) break;
    }
  }

  return { poly: bestPoly, line: bestLine, point: bestPoint, dist2: bestD2 };
}

function closestPointToClosedPolygon(px, py, poly) {
  let bestX = 0;
  let bestY = 0;
  let bestD2 = Infinity;

  let bestA = 0;
  let bestB = 0;

  for (let i = 0; i < poly.length - 1; i++) {
    const ax = poly[i][0];
    const ay = poly[i][1];
    const bx = poly[i + 1][0];
    const by = poly[i + 1][1];

    const q = closestPointOnSegment(px, py, ax, ay, bx, by);
    const dx = q[0] - px;
    const dy = q[1] - py;
    const d2 = dx * dx + dy * dy;

    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = q[0];
      bestY = q[1];
      bestA = [ax, ay];
      bestB = [bx, by];
      if (bestD2 === 0) break;
    }
  }

  return { line: [bestA, bestB], point: [bestX, bestY], dist2: bestD2 };
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

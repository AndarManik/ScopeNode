import { util } from "./util.js";

export const registerTeamHits = (game, team1States, team2States, time) => {
  const playerRadius = game.playerRadius;
  const timeAlpha = Math.max(0, (time - 30) / 30) ** 3;

  const obstacleRadius =
    (1 - timeAlpha) * playerRadius +
    timeAlpha * Math.hypot(game.mapWidth, game.mapHeight);

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

  const { team1Objective, team2Objective } = game;

  // team1 touching objective wins vs all team2
  for (const team1Player of team1States) {
    const dist =
      Math.hypot(
        team1Player.position[0] - team1Objective[0],
        team1Player.position[1] - team1Objective[1],
      ) - playerRadius;

    if (dist > obstacleRadius) continue;

    const uuid1 = team1Player.uuid;
    for (const team2Player of team2States) {
      shots.push({
        team1: true,
        killer: uuid1,
        killed: team2Player.uuid,
        killerPosition: team1Player.position,
        killedPosition: team2Player.position,
        hit: team2Player.position,
      });
    }
  }

  // team2 touching objective wins vs all team1
  for (const team2Player of team2States) {
    const dist =
      Math.hypot(
        team2Player.position[0] - team2Objective[0],
        team2Player.position[1] - team2Objective[1],
      ) - playerRadius;

    if (dist > obstacleRadius) continue;

    const uuid2 = team2Player.uuid;
    for (const team1Player of team1States) {
      shots.push({
        team2: true,
        killer: uuid2,
        killed: team1Player.uuid,
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

  const point = [px, py];
  if (util.pointInClosedPolygonInclusive(point, poly)) return point;

  const r2 = r * r;
  for (let i = 0; i < poly.length - 1; i++) {
    const hit = util.segmentCircleFirstIntersection(
      poly[i],
      poly[i + 1],
      point,
      r2,
    );
    if (hit) return hit;
  }

  return null;
}

function makeSpiralShifts(count, maxRadius = 1) {
  if (count <= 0) return [];
  if (count === 1) return [[0, 0]];

  const shifts = [[0, 0]];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 1; i < count; i++) {
    const t = i / (count - 1);
    const r = maxRadius * t;
    const a = i * goldenAngle;
    shifts.push([r * Math.cos(a), r * Math.sin(a)]);
  }

  return shifts;
}

export const shifts = makeSpiralShifts(20);

// Returns a list of positions, if the player is at the position right now, they yeild a kill
export function allKillTargets(game, position, enemies) {
  const killTargets = [];
  if (!position || position.length === 0 || !enemies || enemies.length === 0)
    return killTargets;

  // fudge factors, any amount above float rounding is good here
  const fudge = 0.1;
  const r_ = fudge * game.playerRadius;
  const r = r_ + game.playerRadius;
  const r2 = r * r;

  const size = game.mapHeight / 2;

  for (const [xShift, yShift] of shifts) {
    const sample = [position[0] + size * xShift, position[1] + size * yShift];

    let sampleIsUnseen = true;
    const potentialKillTargets = [];

    for (const enemy of enemies) {
      const outsideOfSeen = util.closestPointToPolygon(sample, enemy[0]).dist2;
      if (!outsideOfSeen) {
        sampleIsUnseen = false;
        break;
      }

      const closestBody = util.closestPointToPolygonUnion(sample, enemy[1]);
      if (!closestBody.point) continue;

      const closestVision = util.closestPointToPolygon(
        closestBody.point,
        enemy[0],
      );
      if (closestVision.dist2 < r2) continue;

      const killTarget = util.translateNormalIntoPoly(
        closestBody.point,
        closestBody.line,
        r_,
        closestBody.poly,
      );

      if (killTarget[0] < 0 || killTarget[1] < 0) continue;
      if (killTarget[0] > game.mapWidth || killTarget[1] > game.mapHeight)
        continue;

      potentialKillTargets.push(killTarget);
    }

    if (sampleIsUnseen) killTargets.push(...potentialKillTargets);
  }

  return killTargets;
}

// paths towards safety relative to enemies vision, scaled by the enemies own exposure.
export function allDieTargets(game, position, enemies, friends) {
  const dieTargets = [];
  if (!position || position.length === 0 || !enemies || enemies.length === 0)
    return dieTargets;

  for (const enemy of enemies) {
    const closestBody = util.closestPointToPolygonUnion(
      position,
      enemy[1],
    ).point;
    if (!closestBody) continue;

    const closestVision = util.closestPointToPolygon(closestBody, enemy[0]);
    if (!closestVision.point || !closestVision.line) continue;

    const a = closestVision.line[0];
    const b = closestVision.line[1];

    const [ex, ey] = enemy[2];
    const da2 = (a[0] - ex) * (a[0] - ex) + (a[1] - ey) * (a[1] - ey);
    const db2 = (b[0] - ex) * (b[0] - ex) + (b[1] - ey) * (b[1] - ey);

    const pointOfInterest = da2 <= db2 ? a : b;
    const r = game.playerRadius;

    const rawRisk = Math.sqrt(closestVision.dist2) / game.playerRadius;
    const risk = util.clamp01(rawRisk);
    const safeWeight = 1 - risk;

    const riskFlee = util.translateAway(position, closestVision.point, r);
    const safeFlee = util.translateTowards(position, pointOfInterest, r);

    dieTargets.push([
      risk * riskFlee[0] + safeWeight * safeFlee[0],
      risk * riskFlee[1] + safeWeight * safeFlee[1],
    ]);
  }

  for (const friend of friends) {
    if (position[0] === friend[2][0] && position[1] === friend[2][1]) continue;
    dieTargets.push(util.translateAway(position, friend[2], game.playerRadius));
  }

  for (const enemy of enemies) {
    if (position[0] === enemy[2][0] && position[1] === enemy[2][1]) continue;
    dieTargets.push(
      util.translateTowards(position, enemy[2], game.playerRadius),
    );
  }

  if (dieTargets.length === 0) return [];

  // Average unit directions from position -> dieTargets
  let sx = 0;
  let sy = 0;

  for (const [tx, ty] of dieTargets) {
    const dx = tx - position[0];
    const dy = ty - position[1];
    const d = Math.hypot(dx, dy);
    if (d === 0) continue;

    sx += dx / d;
    sy += dy / d;
  }

  const s = Math.hypot(sx, sy);
  if (s === 0) return [];

  const shift = game.playerRadius * 16;
  return [[position[0] + (sx / s) * shift, position[1] + (sy / s) * shift]];
}

export function registerTarget(shooter, enemies, radius) {
  let bodyDist = Infinity;
  let bestEnemy = null;

  for (const enemy of enemies) {
    const { dist2 } = util.closestPointToPolygonUnion(shooter[2], enemy[1]);
    if (dist2 < bodyDist) {
      bestEnemy = enemy;
      bodyDist = dist2;
    }
  }

  if (!bestEnemy) return null;

  const { point: subTarget, dist2: enemyBodyDist } =
    util.closestPointToPolygonUnion(bestEnemy[2], shooter[1]);

  const target = util.closestPointToPolygon(
    subTarget || bestEnemy[2],
    shooter[0],
  ).point;

  return Math.sqrt(enemyBodyDist) < radius * 8 ? target : null;
}

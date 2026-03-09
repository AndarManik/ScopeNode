import { util } from "./util.js";

// The path that a circle takes as it rolls around the perimeter of a polygon,
// its center traces a path which is circle radius larger than the polygon.
// This is a Minkowski sum of a circle with the polygon.

// The Minkowski sum special-cased for a circle on a polygon can be computed by
// 1. expanding edges outward by the circle radius
// 2. approximating circle boundary at vertices

export const generateObstacle = (
  { playerRadius, obstacleArea, minkowskiDeg, minObstacleDeg },
  position = [0, 0],
  angle = Math.PI * 2 * Math.random(),
  alpha = Math.random(),
) => {
  const area = (obstacleArea * playerRadius) ** 2;
  const triangle = spawnTriangleCentered(alpha, area, minObstacleDeg);
  const poly = util.transformPoints(triangle, position, angle);
  const pathPoly = minkowskiSum(poly, playerRadius, minkowskiDeg);
  const previewPoly = minkowskiSum(poly, 2 * playerRadius, minkowskiDeg / 8);
  return { poly, pathPoly, previewPoly, position, angle, alpha };
};

const spawnTriangleCentered = (alpha, area, minDeg) => {
  const [A, B, C] = anglesFromAlpha(alpha, minDeg);

  const sA = Math.sin(A);
  const sB = Math.sin(B);
  const sC = Math.sin(C);
  const k = Math.sqrt((2 * area) / (sA * sB * sC));
  const aSide = k * sA; // BC opposite A
  const bSide = k * sB; // CA opposite B
  const cSide = k * sC; // AB opposite C

  const c = cSide;
  const aLen = aSide;
  const bLen = bSide;
  const x2 = (bLen * bLen - aLen * aLen + c * c) / (2 * c);
  const y2 = Math.sqrt(Math.max(0, bLen * bLen - x2 * x2));

  let p1 = [0, 0];
  let p2 = [c, 0];
  let p3 = [x2, y2];

  const cx = (p1[0] + p2[0] + p3[0]) / 3;
  const cy = (p1[1] + p2[1] + p3[1]) / 3;
  p1 = [p1[0] - cx, p1[1] - cy];
  p2 = [p2[0] - cx, p2[1] - cy];
  p3 = [p3[0] - cx, p3[1] - cy];

  return [p1, p2, p3];
};

const anglesFromAlpha = (alpha, minDeg) => {
  const min = (minDeg * Math.PI) / 180;
  if (!(min > 0 && min < Math.PI / 3))
    throw new Error("minDeg must satisfy 0 < minDeg < 60.");

  const budget = Math.PI - 3 * min;

  // Key barycentric points (weights sum to 1, all >= 0)
  const Ea = [1 / 2, 1 / 2, 0]; // edge midpoint where a=min
  const Vc = [0, 0, 1]; // vertex where c is maximal (a=min, b=min)

  const a = util.clamp01(alpha);
  const w =
    a < 0.5
      ? util.mix3(Ea, Vc, util.smoothstep(2 * a))
      : util.mix3(Vc, Ea, util.smoothstep(2 * (a - 0.5)));

  const a1 = min + budget * w[0];
  const a2 = min + budget * w[1];
  const a3 = min + budget * w[2];
  return [a1, a2, a3];
};

export const minkowskiSum = (triangle, playerRadius, angleStepDeg) => {
  angleStepDeg = Math.min(120, Math.max(0.1, angleStepDeg));
  const dTheta = (angleStepDeg * Math.PI) / 180;
  const rEff = playerRadius / Math.cos(dTheta / 2);

  // Ensure CCW orientation
  const p = triangle.slice();
  if (util.orient(p[0], p[1], p[2]) < 0) p.reverse();

  const N = 3;
  const V = (i) => p[(i + N) % N];

  const normals = new Array(N);
  const angs = new Array(N);
  for (let i = 0; i < N; i++) {
    const n = util.outwardNormal(V(i), V(i + 1));
    normals[i] = n;
    angs[i] =
      n[0] === 0 && n[1] === 0 ? (i ? angs[i - 1] : 0) : Math.atan2(n[1], n[0]);
  }

  const out = [];
  const pushUnique = (pt) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-12) {
      out.push(pt);
    }
  };

  for (let i = 0; i < N; i++) {
    const vi = V(i);
    const viNext = V(i + 1);

    const prevAng = angs[(i - 1 + N) % N];
    const currAng = angs[i];
    const nCurr = normals[i];

    // Raw CCW turning angle between consecutive outward normals
    let delta = util.ccwAngleDelta(prevAng, currAng);
    if (delta > Math.PI) delta = Math.PI;

    // After trimming half-step at both ends, remaining sweep
    const sweep = Math.max(0, delta - dTheta);
    if (sweep <= 1e-12) {
      const ang = prevAng + dTheta / 2;
      const x = vi[0] + rEff * Math.cos(ang);
      const y = vi[1] + rEff * Math.sin(ang);
      if (Number.isFinite(x) && Number.isFinite(y)) pushUnique([x, y]);
    } else {
      const start = prevAng + dTheta / 2;
      const steps = Math.max(1, Math.ceil(sweep / dTheta));
      for (let k = 0; k <= steps; k++) {
        const ang = start + (sweep * k) / steps;
        const x = vi[0] + rEff * Math.cos(ang);
        const y = vi[1] + rEff * Math.sin(ang);
        if (Number.isFinite(x) && Number.isFinite(y)) pushUnique([x, y]);
      }
    }

    // Straight offset segment: add far endpoint if current edge isn't zero-length
    if (!(nCurr[0] === 0 && nCurr[1] === 0)) {
      const s1 = [
        viNext[0] + nCurr[0] * playerRadius,
        viNext[1] + nCurr[1] * playerRadius,
      ];
      if (Number.isFinite(s1[0]) && Number.isFinite(s1[1])) pushUnique(s1);
    }
  }

  return out;
};

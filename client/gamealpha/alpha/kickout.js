const DEFAULT_EPS = 1e-9;
/**
 * Accepts:
 *  - [[x,y], ...]  OR  [ [[x,y], ...] ]
 * Converts to numbers, ensures open, returns array-of-polygons.
 */
function normalizePolygons(multiPoly, eps = DEFAULT_EPS) {
  return multiPoly.map((entry) => {
    if (
      Array.isArray(entry) &&
      entry.length === 1 &&
      Array.isArray(entry[0][0])
    ) {
      return ensureOpen(
        entry[0].map(([x, y]) => [Number(x), Number(y)]),
        eps
      );
    }
    return ensureOpen(
      entry.map(([x, y]) => [Number(x), Number(y)]),
      eps
    );
  });
}

export function pointInPolygon(p, poly, eps = DEFAULT_EPS, polyAABBOpt = null) {
  const [px, py] = p;

  if (polyAABBOpt) {
    if (
      px < polyAABBOpt.minX - eps ||
      px > polyAABBOpt.maxX + eps ||
      py < polyAABBOpt.minY - eps ||
      py > polyAABBOpt.maxY + eps
    ) {
      return false;
    }
  }

  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];

    if (onSegment(xj, yj, xi, yi, px, py, eps)) return true;

    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 0.0) + xi;

    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * If first and last vertices are (almost) identical, drop the last to ensure open polygon.
 * @param {number[][]} poly
 * @returns {number[][]}
 */
export function ensureOpen(poly, eps = DEFAULT_EPS) {
  if (poly.length >= 2) {
    const a = poly[0];
    const b = poly[poly.length - 1];
    if (almostEq(a[0], b[0], eps) && almostEq(a[1], b[1], eps)) {
      return poly.slice(0, -1);
    }
  }
  return poly;
}

/** @returns {boolean} true iff |a-b| <= eps */
export function almostEq(a, b, eps = DEFAULT_EPS) {
  return Math.abs(a - b) <= eps;
}

export function onSegment(ax, ay, bx, by, px, py, eps = DEFAULT_EPS) {
  if (Math.abs(orient(ax, ay, bx, by, px, py)) > eps) return false;
  return (
    Math.min(ax, bx) - eps <= px &&
    px <= Math.max(ax, bx) + eps &&
    Math.min(ay, by) - eps <= py &&
    py <= Math.max(ay, by) + eps
  );
}

/** 2D cross((bx-ax, by-ay), (cx-ax, cy-ay)) */
export function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}


/**
 * Resolve penetration by pushing to the nearest *locally correct* outside point.
 * Prefers the first boundary hit along the motion from p0 -> p (swept test).
 *
 * @param {Array<number[][]|[number[][]]>} mPolygons
 * @param {[number,number]} p  - current (possibly inside)
 * @param {[number,number]|null} p0 - previous (non-penetrating) position; REQUIRED for robust concave behavior
 * @param {number} eps
 */
export function kickout(p, mPolygons, p0 = null, eps = DEFAULT_EPS) {
  const polygons = normalizePolygons(mPolygons, eps);
  if (polygons.length === 0) return [p[0], p[1]];

  // Quick outside test
  let insideAny = false;
  for (const poly of polygons) {
    if (pointInPolygon(p, poly, eps)) {
      insideAny = true;
      break;
    }
  }
  if (!insideAny) return [p[0], p[1]];

  // Helpers
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const dot2 = (ax, ay, bx, by) => ax * bx + ay * by;

  const signedArea = (poly) => {
    let a = 0,
      n = poly.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % n];
      a += x1 * y2 - y1 * x2;
    }
    return 0.5 * a;
  };

  // Segment–segment intersection with parameters (t on p0->p, u on a->b)
  function segSegParam(ax, ay, bx, by, cx, cy, dx, dy) {
    const rX = bx - ax,
      rY = by - ay;
    const sX = dx - cx,
      sY = dy - cy;
    const qmpX = cx - ax,
      qmpY = cy - ay;
    const den = cross(rX, rY, sX, sY);

    if (Math.abs(den) < 1e-12) {
      // Parallel (ignore collinear for simplicity; rare for collision resolution)
      return null;
    }
    const t = cross(qmpX, qmpY, sX, sY) / den; // on AB
    const u = cross(qmpX, qmpY, rX, rY) / den; // on CD
    if (t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10) {
      return { t, u, ix: ax + t * rX, iy: ay + t * rY };
    }
    return null;
  }

  // If we have a previous point, do swept resolution: pick earliest hit
  if (p0) {
    const mvX = p[0] - p0[0],
      mvY = p[1] - p0[1];
    // If no motion, fall back later
    if (Math.hypot(mvX, mvY) > eps) {
      let best = null;

      for (let pi = 0; pi < polygons.length; pi++) {
        const poly = polygons[pi];
        const ccw = signedArea(poly) > 0;
        for (let ei = 0; ei < poly.length; ei++) {
          const a = poly[ei];
          const b = poly[(ei + 1) % poly.length];
          const hit = segSegParam(
            p0[0],
            p0[1],
            p[0],
            p[1],
            a[0],
            a[1],
            b[0],
            b[1]
          );
          if (!hit) continue;

          // Ignore exits (when starting inside and moving out): we want the *entry* into the polygon
          // A simple heuristic: keep hits where p0 is outside or the motion points deeper inside.
          // But since you reported entering concavity, we primarily care about outside->inside entries:
          const entryCandidate = true; // keep it simple—choose the earliest along motion

          if (entryCandidate) {
            if (!best || hit.t < best.t) {
              best = { ...hit, pi, ei, a, b, ccw };
            }
          }
        }
      }

      if (best) {
        // Compute outward normal of the *hit edge*
        const ex = best.b[0] - best.a[0],
          ey = best.b[1] - best.a[1];
        // Interior is left for CCW; outward is right normal for CCW
        let nx = best.ccw ? ey : -ey;
        let ny = best.ccw ? -ex : ex;

        // If we hit exactly at a vertex, pick the dominating wall
        if (best.u <= 1e-6 || best.u >= 1 - 1e-6) {
          const poly = polygons[best.pi];
          const n = poly.length;
          const vi = best.u <= 1e-6 ? best.ei : (best.ei + 1) % n;

          const vPrev = poly[(vi - 1 + n) % n];
          const v = poly[vi];
          const vNext = poly[(vi + 1) % n];

          const t0x = v[0] - vPrev[0],
            t0y = v[1] - vPrev[1]; // edge leaving vPrev->v, tangent from vPrev to v
          const t1x = vNext[0] - v[0],
            t1y = vNext[1] - v[1]; // edge v->vNext

          // Outward normals for both incident edges
          let n0x = best.ccw ? t0y : -t0y,
            n0y = best.ccw ? -t0x : t0x;
          let n1x = best.ccw ? t1y : -t1y,
            n1y = best.ccw ? -t1x : t1x;

          // Pick the one that opposes the motion most (push back along the primary wall)
          const d0 = -dot2(n0x, n0y, mvX, mvY);
          const d1 = -dot2(n1x, n1y, mvX, mvY);
          if (d0 >= d1) {
            nx = n0x;
            ny = n0y;
          } else {
            nx = n1x;
            ny = n1y;
          }
        }

        let nL = Math.hypot(nx, ny) || 1;
        nx /= nL;
        ny /= nL;

        // Place just outside the boundary where we actually collided
        const pad = Math.max(eps * 8, Math.hypot(mvX, mvY) * 1e-6);
        let cand = [best.ix + nx * pad, best.iy + ny * pad];

        // If numerical issues keep us inside, escalate a bit
        for (let tries = 0; tries < 10; tries++) {
          let ok = true;
          for (const poly of polygons) {
            if (pointInPolygon(cand, poly, eps)) {
              ok = false;
              break;
            }
          }
          if (ok) return cand;
          cand = [cand[0] + nx * pad, cand[1] + ny * pad];
        }
      }
    }
  }

  // ------- Fallback: no previous point or no swept hit; use nearest boundary, but step OUTWARD from boundary --------
  // Prefer edge interiors over vertices; then step from Q along *outward* normal (not along p->Q).
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const closestPointOnSegWithT = (ax, ay, bx, by, px, py) => {
    const vx = bx - ax,
      vy = by - ay;
    const wx = px - ax,
      wy = py - ay;
    const vv = vx * vx + vy * vy;
    let t = vv > 0 ? dot2(wx, wy, vx, vy) / vv : 0;
    t = clamp01(t);
    return { qx: ax + t * vx, qy: ay + t * vy, t };
  };

  // Only consider polygons that actually contain p
  const containing = [];
  for (let pi = 0; pi < polygons.length; pi++) {
    if (pointInPolygon(p, polygons[pi], eps)) containing.push(pi);
  }

  let best = { d2: Infinity, pi: -1, ei: -1, qx: 0, qy: 0, t: 0 };
  const TOL_T = 1e-7;

  for (const pi of containing) {
    const poly = polygons[pi];
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const { qx, qy, t } = closestPointOnSegWithT(ax, ay, bx, by, p[0], p[1]);
      // prefer edge interior (t∈(0,1)) by biasing distance slightly
      const interior = t > TOL_T && t < 1 - TOL_T;
      const dx = qx - p[0],
        dy = qy - p[1];
      const d2 = dx * dx + dy * dy + (interior ? 0 : 1e-9);
      if (d2 < best.d2) best = { d2, pi, ei: i, qx, qy, t };
    }
  }

  if (best.pi >= 0) {
    const poly = polygons[best.pi];
    const ccw = signedArea(poly) > 0;

    let nx, ny;
    if (best.t > TOL_T && best.t < 1 - TOL_T) {
      // Edge interior: use edge outward normal
      const [ax, ay] = poly[best.ei];
      const [bx, by] = poly[(best.ei + 1) % poly.length];
      const ex = bx - ax,
        ey = by - ay;
      nx = ccw ? ey : -ey;
      ny = ccw ? -ex : ex;
    } else {
      // Vertex: exterior-bisector of incident edges
      const n = poly.length;
      const vi = best.t <= TOL_T ? best.ei : (best.ei + 1) % n;
      const vPrev = poly[(vi - 1 + n) % n];
      const v = poly[vi];
      const vNext = poly[(vi + 1) % n];

      const t0x = v[0] - vPrev[0],
        t0y = v[1] - vPrev[1];
      const t1x = vNext[0] - v[0],
        t1y = vNext[1] - v[1];

      let n0x = ccw ? t0y : -t0y,
        n0y = ccw ? -t0x : t0x;
      let n1x = ccw ? t1y : -t1y,
        n1y = ccw ? -t1x : t1x;

      const n0L = Math.hypot(n0x, n0y) || 1,
        n1L = Math.hypot(n1x, n1y) || 1;
      n0x /= n0L;
      n0y /= n0L;
      n1x /= n1L;
      n1y /= n1L;

      nx = n0x + n1x;
      ny = n0y + n1y;
      const L = Math.hypot(nx, ny);
      if (L < 1e-12) {
        nx = n0x;
        ny = n0y;
      } else {
        nx /= L;
        ny /= L;
      }
    }

    // Step a tiny bit outside from the *boundary point* (not from p)
    const pad = Math.max(eps * 8, 1e-7);
    let cand = [best.qx + nx * pad, best.qy + ny * pad];

    for (let tries = 0; tries < 10; tries++) {
      let ok = true;
      for (const poly2 of polygons) {
        if (pointInPolygon(cand, poly2, eps)) {
          ok = false;
          break;
        }
      }
      if (ok) return cand;
      cand = [cand[0] + nx * pad, cand[1] + ny * pad];
    }
  }

  // Absolute fallback: nudge left
  return [p[0] - 1e-3, p[1]];
}

// kickout.js
// Refactor goals:
// - Make kickout hot-loop friendly: no per-call normalization, no per-call helper allocations.
// - Minimize function calls in the inner loops (inline where it matters).
// - Move “internal helpers/objects” into a reusable params/context object created once.

export const DEFAULT_EPS = 1e-9;

// ---------------------------------------------
// Public: build reusable params for kickout()
// ---------------------------------------------

/**
 * Create a reusable context for kickout() for a fixed polygon set.
 * Call this once per level/map, then reuse in your loop.
 *
 * @param {Array<number[][]|[number[][]]>} mPolygons
 * @param {number} eps
 * @returns {{
 *   eps: number,
 *   polys: number[][][],
 *   aabbs: Array<{minX:number,minY:number,maxX:number,maxY:number}>,
 *   ccw: boolean[],
 *   nVerts: number[],
 * }}
 */
export function newKickoutParams(mPolygons, eps = DEFAULT_EPS) {
  const polys = normalizePolygonsOnce(mPolygons, eps);
  const count = polys.length;

  const aabbs = new Array(count);
  const ccw = new Array(count);
  const nVerts = new Array(count);

  for (let pi = 0; pi < count; pi++) {
    const poly = polys[pi];
    const n = poly.length;
    nVerts[pi] = n;

    // AABB
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    // Signed area *2 (avoid 0.5)
    let area2 = 0;

    if (n > 0) {
      let x1 = poly[n - 1][0];
      let y1 = poly[n - 1][1];
      for (let i = 0; i < n; i++) {
        const v = poly[i];
        const x2 = v[0];
        const y2 = v[1];

        if (x2 < minX) minX = x2;
        if (x2 > maxX) maxX = x2;
        if (y2 < minY) minY = y2;
        if (y2 > maxY) maxY = y2;

        area2 += x1 * y2 - y1 * x2;
        x1 = x2;
        y1 = y2;
      }
    }

    aabbs[pi] = { minX, minY, maxX, maxY };
    ccw[pi] = area2 > 0;
  }

  return { eps, polys, aabbs, ccw, nVerts };
}

// ---------------------------------------------
// Public: hot-loop kickout using params
// ---------------------------------------------

/**
 * Resolve penetration by pushing to nearest locally-correct outside point.
 * Optimized for hot-loop usage when polygons are fixed:
 *   const K = newKickoutParams(levelPolys);
 *   p = kickout(p, K, p0);
 *
 * @param {[number,number]} p
 * @param {{eps:number, polys:number[][][], aabbs:any[], ccw:boolean[], nVerts:number[]}} K
 * @param {[number,number]|null} p0
 * @returns {[number,number]}
 */
export function kickout(p, K, p0 = null) {
  const eps = K.eps;
  const polys = K.polys;
  const aabbs = K.aabbs;
  const ccwArr = K.ccw;
  const nVerts = K.nVerts;

  const px = p[0];
  const py = p[1];

  const polyCount = polys.length;
  if (polyCount === 0) return [px, py];

  // -------- Quick outside test: are we inside ANY polygon? --------
  let insideAny = false;

  // Inline point-in-poly with AABB and on-segment boundary inclusion.
  // We do an early “insideAny” probe; later phases may need inside checks again.
  for (let pi = 0; pi < polyCount; pi++) {
    const bb = aabbs[pi];
    if (
      px < bb.minX - eps ||
      px > bb.maxX + eps ||
      py < bb.minY - eps ||
      py > bb.maxY + eps
    ) {
      continue;
    }

    const poly = polys[pi];
    const n = nVerts[pi];

    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0];
      const yi = poly[i][1];
      const xj = poly[j][0];
      const yj = poly[j][1];

      // onSegment(xj,yj, xi,yi, px,py)
      // orient = (xi-xj)*(py-yj) - (yi-yj)*(px-xj)
      const ox = xi - xj;
      const oy = yi - yj;
      const opx = px - xj;
      const opy = py - yj;
      const orient = ox * opy - oy * opx;
      if (orient <= eps && orient >= -eps) {
        // within AABB of segment
        const minx = xj < xi ? xj : xi;
        const maxx = xj > xi ? xj : xi;
        const miny = yj < yi ? yj : yi;
        const maxy = yj > yi ? yj : yi;
        if (
          px >= minx - eps &&
          px <= maxx + eps &&
          py >= miny - eps &&
          py <= maxy + eps
        ) {
          insideAny = true; // boundary counts as inside/hit => resolve no-op/true
          break;
        }
      }

      // ray crossing
      const yiGt = yi > py;
      const yjGt = yj > py;
      if (yiGt !== yjGt) {
        const xInt = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (px < xInt) inside = !inside;
      }
    }

    if (insideAny || inside) {
      insideAny = true;
      break;
    }
  }

  if (!insideAny) return [px, py];

  // Common tiny pads
  const padBase = eps * 8;

  // -------- Swept resolution (prefer first boundary hit along p0->p) --------
  if (p0) {
    const p0x = p0[0];
    const p0y = p0[1];
    const mvX = px - p0x;
    const mvY = py - p0y;

    // avoid Math.hypot in hot path
    const mv2 = mvX * mvX + mvY * mvY;
    if (mv2 > eps * eps) {
      let bestT = Infinity;
      let bestPi = -1;
      let bestEi = -1;
      let bestU = 0;
      let bestIx = 0;
      let bestIy = 0;

      // seg-seg param for (p0->p) vs (a->b)
      // r = p - p0, s = b - a
      // den = cross(r,s)
      // t = cross((a-p0), s) / den   (on p0->p)
      // u = cross((a-p0), r) / den   (on a->b)
      for (let pi = 0; pi < polyCount; pi++) {
        const poly = polys[pi];
        const n = nVerts[pi];

        // Quick reject: if both endpoints are outside expanded AABB and segment doesn't cross?
        // (Keeping simple: AABB reject already helped above; add only minimal check here.)
        // You can add segment-AABB test if needed; omitted for branch/compute balance.

        let ax = poly[n - 1][0];
        let ay = poly[n - 1][1];
        for (let ei = 0; ei < n; ei++) {
          const bx = poly[ei][0];
          const by = poly[ei][1];

          const sX = bx - ax;
          const sY = by - ay;

          const den = mvX * sY - mvY * sX; // cross(r,s)
          if (den > -1e-12 && den < 1e-12) {
            ax = bx;
            ay = by;
            continue; // parallel
          }

          const qmpX = ax - p0x;
          const qmpY = ay - p0y;

          const t = (qmpX * sY - qmpY * sX) / den; // cross(qmp, s) / den
          // cheap bound check first
          if (t >= -1e-10 && t <= 1 + 1e-10 && t < bestT) {
            const u = (qmpX * mvY - qmpY * mvX) / den; // cross(qmp, r) / den
            if (u >= -1e-10 && u <= 1 + 1e-10) {
              bestT = t;
              bestPi = pi;
              bestEi = ei === 0 ? n - 1 : ei - 1; // edge index referencing (ax,ay)->(bx,by)
              bestU = u;
              bestIx = p0x + t * mvX;
              bestIy = p0y + t * mvY;
            }
          }

          ax = bx;
          ay = by;
        }
      }

      if (bestPi >= 0) {
        const poly = polys[bestPi];
        const n = nVerts[bestPi];
        const ccw = ccwArr[bestPi];

        // edge endpoints
        const a = poly[bestEi];
        const b = poly[(bestEi + 1) % n];

        const ex = b[0] - a[0];
        const ey = b[1] - a[1];

        // outward normal: for CCW, outward is right normal
        let nx = ccw ? ey : -ey;
        let ny = ccw ? -ex : ex;

        // If hit at a vertex, choose incident wall that opposes motion most
        if (bestU <= 1e-6 || bestU >= 1 - 1e-6) {
          const vi = bestU <= 1e-6 ? bestEi : (bestEi + 1) % n;

          const vPrev = poly[(vi - 1 + n) % n];
          const v = poly[vi];
          const vNext = poly[(vi + 1) % n];

          const t0x = v[0] - vPrev[0];
          const t0y = v[1] - vPrev[1];
          const t1x = vNext[0] - v[0];
          const t1y = vNext[1] - v[1];

          let n0x = ccw ? t0y : -t0y;
          let n0y = ccw ? -t0x : t0x;
          let n1x = ccw ? t1y : -t1y;
          let n1y = ccw ? -t1x : t1x;

          // pick by -dot(n, mv)
          const d0 = -(n0x * mvX + n0y * mvY);
          const d1 = -(n1x * mvX + n1y * mvY);
          if (d0 >= d1) {
            nx = n0x;
            ny = n0y;
          } else {
            nx = n1x;
            ny = n1y;
          }
        }

        // normalize (avoid Math.hypot)
        const n2 = nx * nx + ny * ny;
        const invNL = n2 > 0 ? 1 / Math.sqrt(n2) : 1;
        nx *= invNL;
        ny *= invNL;

        // pad: max(eps*8, |mv|*1e-6)
        const pad = Math.max(padBase, Math.sqrt(mv2) * 1e-6);

        // candidate just outside boundary at collision point
        let cx = bestIx + nx * pad;
        let cy = bestIy + ny * pad;

        // Escalate if still inside any polygon
        for (let tries = 0; tries < 10; tries++) {
          let ok = true;

          // check inside any poly (AABB first)
          for (let pi = 0; pi < polyCount; pi++) {
            const bb = aabbs[pi];
            if (
              cx < bb.minX - eps ||
              cx > bb.maxX + eps ||
              cy < bb.minY - eps ||
              cy > bb.maxY + eps
            ) {
              continue;
            }

            const poly2 = polys[pi];
            const n2v = nVerts[pi];

            let inside = false;
            for (let i = 0, j = n2v - 1; i < n2v; j = i++) {
              const xi = poly2[i][0];
              const yi = poly2[i][1];
              const xj = poly2[j][0];
              const yj = poly2[j][1];

              // boundary check (on segment)
              const ox = xi - xj;
              const oy = yi - yj;
              const opx = cx - xj;
              const opy = cy - yj;
              const orient = ox * opy - oy * opx;
              if (orient <= eps && orient >= -eps) {
                const minx = xj < xi ? xj : xi;
                const maxx = xj > xi ? xj : xi;
                const miny = yj < yi ? yj : yi;
                const maxy = yj > yi ? yj : yi;
                if (
                  cx >= minx - eps &&
                  cx <= maxx + eps &&
                  cy >= miny - eps &&
                  cy <= maxy + eps
                ) {
                  inside = true;
                  break;
                }
              }

              const yiGt = yi > cy;
              const yjGt = yj > cy;
              if (yiGt !== yjGt) {
                const xInt = ((xj - xi) * (cy - yi)) / (yj - yi) + xi;
                if (cx < xInt) inside = !inside;
              }
            }

            if (inside) {
              ok = false;
              break;
            }
          }

          if (ok) return [cx, cy];
          cx += nx * pad;
          cy += ny * pad;
        }
      }
    }
  }

  // -------- Fallback: nearest boundary for polygons that contain p --------

  // collect containing polygon indices (avoid allocations: do two passes)
  let containCount = 0;
  for (let pi = 0; pi < polyCount; pi++) {
    const bb = aabbs[pi];
    if (
      px < bb.minX - eps ||
      px > bb.maxX + eps ||
      py < bb.minY - eps ||
      py > bb.maxY + eps
    ) {
      continue;
    }

    const poly = polys[pi];
    const n = nVerts[pi];

    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0];
      const yi = poly[i][1];
      const xj = poly[j][0];
      const yj = poly[j][1];

      // boundary check
      const ox = xi - xj;
      const oy = yi - yj;
      const opx = px - xj;
      const opy = py - yj;
      const orient = ox * opy - oy * opx;
      if (orient <= eps && orient >= -eps) {
        const minx = xj < xi ? xj : xi;
        const maxx = xj > xi ? xj : xi;
        const miny = yj < yi ? yj : yi;
        const maxy = yj > yi ? yj : yi;
        if (
          px >= minx - eps &&
          px <= maxx + eps &&
          py >= miny - eps &&
          py <= maxy + eps
        ) {
          inside = true;
          break;
        }
      }

      const yiGt = yi > py;
      const yjGt = yj > py;
      if (yiGt !== yjGt) {
        const xInt = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (px < xInt) inside = !inside;
      }
    }

    if (inside) containCount++;
  }

  if (containCount === 0) {
    // Absolute fallback (should be rare)
    return [px - 1e-3, py];
  }

  // Find nearest boundary point among containing polys
  const TOL_T = 1e-7;
  let bestD2 = Infinity;
  let bestPi = -1;
  let bestEi = -1;
  let bestQx = 0;
  let bestQy = 0;
  let bestT = 0;

  for (let pi = 0; pi < polyCount; pi++) {
    const bb = aabbs[pi];
    if (
      px < bb.minX - eps ||
      px > bb.maxX + eps ||
      py < bb.minY - eps ||
      py > bb.maxY + eps
    ) {
      continue;
    }

    // confirm containing (repeat check, but avoids storing an index list)
    const poly = polys[pi];
    const n = nVerts[pi];

    let containing = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0];
      const yi = poly[i][1];
      const xj = poly[j][0];
      const yj = poly[j][1];

      // boundary check
      const ox = xi - xj;
      const oy = yi - yj;
      const opx = px - xj;
      const opy = py - yj;
      const orient = ox * opy - oy * opx;
      if (orient <= eps && orient >= -eps) {
        const minx = xj < xi ? xj : xi;
        const maxx = xj > xi ? xj : xi;
        const miny = yj < yi ? yj : yi;
        const maxy = yj > yi ? yj : yi;
        if (
          px >= minx - eps &&
          px <= maxx + eps &&
          py >= miny - eps &&
          py <= maxy + eps
        ) {
          containing = true;
          break;
        }
      }

      const yiGt = yi > py;
      const yjGt = yj > py;
      if (yiGt !== yjGt) {
        const xInt = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (px < xInt) containing = !containing;
      }
    }

    if (!containing) continue;

    // closest point on segment sweep
    for (let ei = 0; ei < n; ei++) {
      const ax = poly[ei][0];
      const ay = poly[ei][1];
      const b = poly[(ei + 1) % n];
      const bx = b[0];
      const by = b[1];

      const vx = bx - ax;
      const vy = by - ay;
      const wx = px - ax;
      const wy = py - ay;

      const vv = vx * vx + vy * vy;
      let t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const qx = ax + t * vx;
      const qy = ay + t * vy;

      const dx = qx - px;
      const dy = qy - py;

      // prefer edge interior slightly
      const interior = t > TOL_T && t < 1 - TOL_T;
      const d2 = dx * dx + dy * dy + (interior ? 0 : 1e-9);

      if (d2 < bestD2) {
        bestD2 = d2;
        bestPi = pi;
        bestEi = ei;
        bestQx = qx;
        bestQy = qy;
        bestT = t;
      }
    }
  }

  if (bestPi >= 0) {
    const poly = polys[bestPi];
    const n = nVerts[bestPi];
    const ccw = ccwArr[bestPi];

    let nx = 0;
    let ny = 0;

    if (bestT > TOL_T && bestT < 1 - TOL_T) {
      // edge interior
      const ax = poly[bestEi][0];
      const ay = poly[bestEi][1];
      const b = poly[(bestEi + 1) % n];
      const bx = b[0];
      const by = b[1];
      const ex = bx - ax;
      const ey = by - ay;
      nx = ccw ? ey : -ey;
      ny = ccw ? -ex : ex;

      const n2 = nx * nx + ny * ny;
      const inv = n2 > 0 ? 1 / Math.sqrt(n2) : 1;
      nx *= inv;
      ny *= inv;
    } else {
      // vertex: exterior-bisector
      const vi = bestT <= TOL_T ? bestEi : (bestEi + 1) % n;

      const vPrev = poly[(vi - 1 + n) % n];
      const v = poly[vi];
      const vNext = poly[(vi + 1) % n];

      const t0x = v[0] - vPrev[0];
      const t0y = v[1] - vPrev[1];
      const t1x = vNext[0] - v[0];
      const t1y = vNext[1] - v[1];

      let n0x = ccw ? t0y : -t0y;
      let n0y = ccw ? -t0x : t0x;
      let n1x = ccw ? t1y : -t1y;
      let n1y = ccw ? -t1x : t1x;

      const n0L2 = n0x * n0x + n0y * n0y;
      const n1L2 = n1x * n1x + n1y * n1y;

      const inv0 = n0L2 > 0 ? 1 / Math.sqrt(n0L2) : 1;
      const inv1 = n1L2 > 0 ? 1 / Math.sqrt(n1L2) : 1;

      n0x *= inv0;
      n0y *= inv0;
      n1x *= inv1;
      n1y *= inv1;

      nx = n0x + n1x;
      ny = n0y + n1y;

      const L2 = nx * nx + ny * ny;
      if (L2 < 1e-24) {
        nx = n0x;
        ny = n0y;
      } else {
        const inv = 1 / Math.sqrt(L2);
        nx *= inv;
        ny *= inv;
      }
    }

    const pad = Math.max(padBase, 1e-7);

    let cx = bestQx + nx * pad;
    let cy = bestQy + ny * pad;

    for (let tries = 0; tries < 10; tries++) {
      let ok = true;

      for (let pi = 0; pi < polyCount; pi++) {
        const bb = aabbs[pi];
        if (
          cx < bb.minX - eps ||
          cx > bb.maxX + eps ||
          cy < bb.minY - eps ||
          cy > bb.maxY + eps
        ) {
          continue;
        }

        const poly2 = polys[pi];
        const n2v = nVerts[pi];

        let inside = false;
        for (let i = 0, j = n2v - 1; i < n2v; j = i++) {
          const xi = poly2[i][0];
          const yi = poly2[i][1];
          const xj = poly2[j][0];
          const yj = poly2[j][1];

          // boundary check
          const ox = xi - xj;
          const oy = yi - yj;
          const opx = cx - xj;
          const opy = cy - yj;
          const orient = ox * opy - oy * opx;
          if (orient <= eps && orient >= -eps) {
            const minx = xj < xi ? xj : xi;
            const maxx = xj > xi ? xj : xi;
            const miny = yj < yi ? yj : yi;
            const maxy = yj > yi ? yj : yi;
            if (
              cx >= minx - eps &&
              cx <= maxx + eps &&
              cy >= miny - eps &&
              cy <= maxy + eps
            ) {
              inside = true;
              break;
            }
          }

          const yiGt = yi > cy;
          const yjGt = yj > cy;
          if (yiGt !== yjGt) {
            const xInt = ((xj - xi) * (cy - yi)) / (yj - yi) + xi;
            if (cx < xInt) inside = !inside;
          }
        }

        if (inside) {
          ok = false;
          break;
        }
      }

      if (ok) return [cx, cy];
      cx += nx * pad;
      cy += ny * pad;
    }
  }

  return [px - 1e-3, py];
}

// ---------------------------------------------
// Exports kept for compatibility (non-hot usage)
// ---------------------------------------------

export function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function almostEq(a, b, eps = DEFAULT_EPS) {
  return Math.abs(a - b) <= eps;
}

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

export function onSegment(ax, ay, bx, by, px, py, eps = DEFAULT_EPS) {
  if (Math.abs(orient(ax, ay, bx, by, px, py)) > eps) return false;
  return (
    Math.min(ax, bx) - eps <= px &&
    px <= Math.max(ax, bx) + eps &&
    Math.min(ay, by) - eps <= py &&
    py <= Math.max(ay, by) + eps
  );
}

/**
 * Compatibility: pointInPolygon(p, poly, eps, polyAABBOpt)
 * For hot-loop kickout() we inline a version to reduce calls.
 */
export function pointInPolygon(p, poly, eps = DEFAULT_EPS, polyAABBOpt = null) {
  const px = p[0];
  const py = p[1];

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
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];

    if (onSegment(xj, yj, xi, yi, px, py, eps)) return true;

    const yiGt = yi > py;
    const yjGt = yj > py;
    if (yiGt !== yjGt) {
      const xInt = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < xInt) inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------
// Internal: normalize once for params creation
// ---------------------------------------------

/**
 * Accepts:
 *  - [[x,y], ...]  OR  [ [[x,y], ...] ]
 * Converts to numbers, ensures open, returns array-of-polygons.
 * NOTE: only used in newKickoutParams().
 */
function normalizePolygonsOnce(multiPoly, eps) {
  const out = new Array(multiPoly.length);

  for (let i = 0; i < multiPoly.length; i++) {
    const entry = multiPoly[i];

    // entry is [ [[x,y],... ] ] form
    if (
      Array.isArray(entry) &&
      entry.length === 1 &&
      Array.isArray(entry[0]) &&
      Array.isArray(entry[0][0])
    ) {
      const poly0 = entry[0];
      const poly = new Array(poly0.length);
      for (let k = 0; k < poly0.length; k++) {
        const v = poly0[k];
        poly[k] = [Number(v[0]), Number(v[1])];
      }
      out[i] = ensureOpen(poly, eps);
      continue;
    }

    // entry is [[x,y], ...]
    const poly = new Array(entry.length);
    for (let k = 0; k < entry.length; k++) {
      const v = entry[k];
      poly[k] = [Number(v[0]), Number(v[1])];
    }
    out[i] = ensureOpen(poly, eps);
  }

  return out;
}

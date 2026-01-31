const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const crossZ = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a, l = len(a)) => (l === 0 ? [0, 0] : [a[0] / l, a[1] / l]);

const leftNormal = (d) => [-d[1], d[0]];
const rightNormal = (d) => [d[1], -d[0]];

const intersectLines = (p, r, q, s) => {
  const rxs = crossZ(r, s);
  if (Math.abs(rxs) < 1e-9) return null;
  const qp = sub(q, p);
  const t = crossZ(qp, s) / rxs;
  return add(p, mul(r, t));
};

/**
 * Convert polyline points -> drawable segments with curvature constraint.
 * Output segments:
 *  - { type:'line', to:[x,y] }
 *  - { type:'arc', c:[x,y], r:number, a0:number, a1:number, ccw:boolean, to:[x,y] }
 */
export function filletPolyline(points, R) {
  const n = points.length;
  if (n < 2) return [];

  const pts = [points[0]];
  for (let i = 1; i < n; i++)
    if (len(sub(points[i], pts[pts.length - 1])) > 1e-6) pts.push(points[i]);

  if (pts.length < 2) return [];

  const segs = [];
  let cur = pts[0];

  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1];
    const B = pts[i];
    const C = pts[i + 1];
    const d1 = sub(B, A);
    const d2 = sub(C, B);
    const L1 = len(d1);
    const L2 = len(d2);
    if (L1 < 1e-9 || L2 < 1e-9) continue;

    const u = norm(d1);
    const v = norm(d2);
    const cos = clamp(dot(u, v), -1, 1);
    const phi = Math.acos(cos);
    if (phi < 1e-3 || Math.abs(Math.PI - phi) < 1e-3) {
      if (len(sub(B, cur)) > 1e-9) segs.push({ type: "line", to: B });
      cur = B;
      continue;
    }

    let t = R * Math.tan(phi / 2);
    const tMax = 0.49 * Math.min(L1, L2);
    if (t > tMax) t = tMax;

    const rEff = t / Math.tan(phi / 2);
    if (rEff < 1e-6) {
      if (len(sub(B, cur)) > 1e-9) segs.push({ type: "line", to: B });
      cur = B;
      continue;
    }

    const P = sub(B, mul(u, t));
    const Q = add(B, mul(v, t));
    const z = crossZ(u, v);
    const ccw = z > 0;
    const nu = ccw ? leftNormal(u) : rightNormal(u);
    const nv = ccw ? leftNormal(v) : rightNormal(v);
    const center = intersectLines(P, nu, Q, nv);
    if (!center) {
      if (len(sub(B, cur)) > 1e-9) segs.push({ type: "line", to: B });
      cur = B;
      continue;
    }

    if (len(sub(P, cur)) > 1e-9) segs.push({ type: "line", to: P });
    const a0 = Math.atan2(P[1] - center[1], P[0] - center[0]);
    const a1 = Math.atan2(Q[1] - center[1], Q[0] - center[0]);
    segs.push({
      type: "arc",
      c: center,
      r: rEff,
      a0,
      a1,
      ccw,
      to: Q,
    });

    cur = Q;
  }

  const last = pts[pts.length - 1];
  if (len(sub(last, cur)) > 1e-9) segs.push({ type: "line", to: last });
  return { start: pts[0], segs };
}

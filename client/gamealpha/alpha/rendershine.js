import "./clipper.js";
// Requires the JS Clipper (ClipperLib) already loaded (from clipper.js).

/* ------------ small ring helpers (orientation, closing, dedupe) ------------ */
const _area = (ring) => {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const [x0, y0] = ring[j],
      [x1, y1] = ring[i];
    a += x0 * y1 - x1 * y0;
  }
  return 0.5 * a;
};
const _isClosed = (r) =>
  r.length > 2 &&
  r[0][0] === r[r.length - 1][0] &&
  r[0][1] === r[r.length - 1][1];

const _closeRing = (r) =>
  _isClosed(r) ? r.slice() : r.length ? [...r, r[0]] : r;
const _ensureOrientation = (ring, wantCCW) => {
  const ccw = _area(ring) > 0;
  return ccw === wantCCW ? ring : ring.slice().reverse();
};
const _dedupeConsecutive = (ring, eps = 1e-9) => {
  if (ring.length === 0) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = ring[i];
    if (Math.abs(ax - bx) > eps || Math.abs(ay - by) > eps) out.push(ring[i]);
  }
  return out;
};

/**
 * insetPolygon
 * @param {Array<[number,number]>} ring - simple (non self-intersecting) polygon (open or closed)
 * @param {number} distance - positive inset distance (we shrink by this)
 * @param {object} opts
 *    - scale (number, default 1e6)  integer scaling for Clipper
 *    - arcTolerance (number, default min(distance/8, 0.25))  controls round-arc smoothness (smaller = smoother)
 *    - miterLimit (number, default 2)
 *    - clean (number, default distance*1e-6)  pre-clean tolerance in your units
 * @returns {Array<Polygon>} MultiPolygon, where Polygon = Array<Ring>, Ring = Array<[x,y]> (closed)
 *          Orientation: outer CCW, holes CW (GeoJSON/Martinez friendly)
 */
export function insetPolygon(ring, distance, opts = {}) {
  if (!ring || ring.length < 3) return [];
  const dist = Math.abs(distance);

  const {
    scale = 1e6,
    arcTolerance = Math.min(dist / 8, 0.25),
    miterLimit = 2,
    clean = dist * 1e-6,
  } = opts;

  // zero distance → wrap as single polygon (no holes), closed & CCW
  if (dist === 0) {
    let r = _dedupeConsecutive(_closeRing(ring));
    r = _ensureOrientation(r, /*CCW*/ true);
    return [[r]];
  }

  const toIntPath = (r) =>
    r.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }));

  let intPath = toIntPath(ring);

  // optional pre-clean to avoid slivers on offset
  if (clean > 0 && ClipperLib?.JS?.Clean) {
    intPath = ClipperLib.JS.Clean(intPath, clean * scale);
  }

  // Offset inward with ROUND joins (concave vertices become arcs)
  const co = new ClipperLib.ClipperOffset(miterLimit, arcTolerance * scale);
  co.AddPath(
    intPath,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon
  );

  const insetPaths = new ClipperLib.Paths();
  co.Execute(insetPaths, -dist * scale);
  if (!insetPaths || insetPaths.length === 0) return [];

  // Union to resolve ring nesting and yield outers+holes (via PolyTree)
  const clip = new ClipperLib.Clipper();
  clip.AddPaths(insetPaths, ClipperLib.PolyType.ptSubject, true);
  const polyTree = new ClipperLib.PolyTree();
  clip.Execute(
    ClipperLib.ClipType.ctUnion,
    polyTree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );

  const exPolys = ClipperLib.JS.PolyTreeToExPolygons(polyTree);

  // Convert ExPolygons -> Martinez MultiPolygon [[[outer],[hole]...], ...]
  const down = (p) => p.map(({ X, Y }) => [X / scale, Y / scale]);
  const multi = [];
  for (const { outer, holes } of exPolys) {
    if (!outer || outer.length < 3) continue;
    let o = _ensureOrientation(_closeRing(down(outer)), true);
    o = _dedupeConsecutive(o);

    const hs = [];
    for (const h of holes || []) {
      if (!h || h.length < 3) continue;
      let r = _ensureOrientation(_closeRing(down(h)), false);
      r = _dedupeConsecutive(r);
      if (r.length >= 4) hs.push(r);
    }
    if (o.length >= 4) multi.push([o, ...hs]);
  }
  return multi;
}

/** Optional helper: wrap a single ring as a Martinez Polygon [[ring]] (closed + CCW) */
export function asMartinezPolygon(ring) {
  if (!ring || ring.length < 3) return [];
  let r = _dedupeConsecutive(_closeRing(ring));
  r = _ensureOrientation(r, /*CCW*/ true);
  return [r];
}

/* ------------------------- import-time self-test ------------------------- */
(() => {
  const inNode = typeof process !== "undefined" && process?.env;
  const inBrowser = typeof window !== "undefined";
  const disabledByEnv = inNode && process.env.INSET_SELF_TEST === "0";
  const disabledByWindow = inBrowser && window.__INSET_SELF_TEST_DISABLED__;
  if (disabledByEnv || disabledByWindow) return;

  try {
    // Inset a 10×6 rectangle by 1 → expect one polygon, no holes, bbox ≈ [1,1]-[9,5]
    const rect = [
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ];
    const mp = insetPolygon(rect, 1, { arcTolerance: 0.1, scale: 1e6 });

    if (!Array.isArray(mp))
      throw new Error("Result is not an array (MultiPolygon).");
    if (mp.length !== 1)
      throw new Error(`Expected 1 polygon, got ${mp.length}.`);

    const poly = mp[0];
    if (!Array.isArray(poly) || poly.length < 1) {
      throw new Error("First polygon is malformed.");
    }
    const outer = poly[0];
    const holesCount = poly.length - 1;

    if (!Array.isArray(outer) || outer.length < 4 || !_isClosed(outer)) {
      throw new Error("Outer ring invalid or not closed.");
    }
    if (holesCount !== 0) {
      throw new Error(`Expected no holes, got ${holesCount}.`);
    }

    // bbox of the outer ring
    let minx = +Infinity,
      miny = +Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (const [x, y] of outer) {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    }
    const tol = 5e-3;
    const bboxOk =
      Math.abs(minx - 1) <= tol &&
      Math.abs(miny - 1) <= tol &&
      Math.abs(maxx - 9) <= tol &&
      Math.abs(maxy - 5) <= tol;

    // quick min distance to original rectangle edges (~= 1)
    let minEdgeD = Infinity;
    for (const [x, y] of outer) {
      const d = Math.min(x - 0, y - 0, 10 - x, 6 - y);
      if (d < minEdgeD) minEdgeD = d;
    }
    const distOk = Math.abs(minEdgeD - 1) <= 5e-3 || minEdgeD > 1 - 5e-3;

    console.log("Inset self-test (MultiPolygon):");
    console.log("  polygons:", mp.length);
    console.log("  outer vertex count:", outer.length);
    console.log("  holes:", holesCount);
    console.log(
      "  bbox:",
      { minx, miny, maxx, maxy },
      "≈ [1,1]-[9,5]",
      "OK?",
      bboxOk
    );
    console.log(
      "  min distance to edges ~ 1:",
      minEdgeD.toFixed(4),
      "OK?",
      distOk
    );

    if (!bboxOk || !distOk)
      throw new Error("Sanity checks failed (bbox or distance).");
  } catch (err) {
    console.error("insetPolygon self-test FAILED:", err);
  }
})();

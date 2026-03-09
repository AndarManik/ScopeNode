/**
 * 2D vector or point.
 *
 * @typedef {[number, number]} Vec2
 */

/**
 * 3D vector or point.
 *
 * @typedef {[number, number, number]} Vec3
 */

/**
 * Axis-aligned bounding box (AABB).
 *
 * @typedef {Object} BBox
 * @property {number} minX Minimum x coordinate.
 * @property {number} minY Minimum y coordinate.
 * @property {number} maxX Maximum x coordinate.
 * @property {number} maxY Maximum y coordinate.
 */

/**
 * Minimal cone descriptor used for geometric visibility checks.
 *
 * Represents the oriented wedge formed by the two edges incident to a vertex.
 * Often used for interior-cone tests.
 *
 * @typedef {Object} VertexConeBasic
 * @property {Vec2} vPrev Vector from the vertex → previous vertex.
 * @property {Vec2} vNext Vector from the vertex → next vertex.
 * @property {number} s Orientation sign of the ring (+1 CCW, -1 CW).
 */

/**
 * Descriptor for the visibility cone at a polygon vertex.
 *
 * @typedef {Object} VertexCone
 * @property {Vec2} vPrev Vector from the vertex → previous vertex.
 * @property {Vec2} vNext Vector from the vertex → next vertex.
 * @property {number} s Ring orientation sign (+1 for CCW, -1 for CW).
 * @property {number} w Interior angle width in radians (0..2π).
 * @property {boolean} reflex True if the vertex is reflex (> π interior angle).
 * @property {number} aPrev Polar angle of `vPrev` (radians).
 * @property {number} aNext Polar angle of `vNext` (radians).
 */

/**
 * State object used for grid ray traversal (Amanatides–Woo DDA).
 *
 * Represents the current position of a ray walking through a uniform
 * spatial grid. The ray is parameterized as:
 *
 *   P(t) = (x0, y0) + t * (dx, dy)
 *
 * Fields:
 * - `(cx, cy)` : current grid cell indices
 * - `stepX/Y`  : direction of cell stepping (-1, 0, or 1)
 * - `tMaxX/Y`  : parametric t value where the ray next crosses a grid boundary
 * - `tDeltaX/Y`: parametric distance between successive grid crossings
 * - `tEnter`   : parametric t where the ray entered the current cell
 * - `tMax`     : maximum allowed t before traversal stops
 *
 * The object is **mutable** and intended to be repeatedly updated by
 * `advanceRayWalk`.
 *
 * @typedef {Object} RayWalkState
 * @property {number} x0 Ray origin x coordinate
 * @property {number} y0 Ray origin y coordinate
 * @property {number} dx Ray direction x component
 * @property {number} dy Ray direction y component
 * @property {number} cx Current grid cell x index
 * @property {number} cy Current grid cell y index
 * @property {number} stepX Grid step direction in x (-1,0,1)
 * @property {number} stepY Grid step direction in y (-1,0,1)
 * @property {number} tMaxX Parametric t where ray next crosses vertical grid line
 * @property {number} tMaxY Parametric t where ray next crosses horizontal grid line
 * @property {number} tDeltaX Parametric t distance between vertical crossings
 * @property {number} tDeltaY Parametric t distance between horizontal crossings
 * @property {number} tEnter Parametric t where the ray entered the current cell
 * @property {number} tMax Maximum parametric distance to walk
 */

/**
 * A polygon represented as an ordered list of 2D vertices.
 *
 * The polygon is *not required* to repeat the first vertex at the end.
 * Edges are implicitly defined between consecutive vertices:
 *
 *   v[i] → v[i+1]
 *
 * and optionally the closing edge:
 *
 *   v[n-1] → v[0]
 *
 * depending on the algorithm consuming the polygon.
 *
 * Orientation (CW/CCW) depends on the producing function.
 *
 * @typedef {Vec2[]} Polygon
 */

/**
 * A polygon whose boundary is explicitly closed.
 *
 * The final vertex is guaranteed to equal the first vertex:
 *
 *   poly[0] === poly[poly.length - 1]
 *
 * This representation is commonly used for:
 * - drawing paths
 * - geometric clipping
 * - rasterization
 * - algorithms that expect explicit boundary loops
 *
 * Minimum length is 4 for a triangle:
 *
 *   [v0, v1, v2, v0]
 *
 * @typedef {Vec2[]} ClosedPolygon
 */

/** Circle constant: τ = 2π (full turn in radians). */
const TAU = Math.PI * 2;

/**
 * Wrap an angle to the interval [-π, π).
 *
 * - Uses a double-mod trick to behave well for negative inputs.
 * - Note the range is **half-open**: returns -π but never +π.
 *
 * @param {number} x - Angle in radians.
 * @returns {number} Equivalent angle in [-Math.PI, Math.PI).
 */
const wrapToPi = (x) => ((((x + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/**
 * Signed orientation of the triple (p1, p2, p3), returned as -1/0/+1.
 *
 * - Equivalent to sign(cross(p2 - p1, p3 - p1)).
 * - Returns 0 when collinear.
 *
 * @param {Vec2} p1
 * @param {Vec2} p2
 * @param {Vec2} p3
 * @returns {-1|0|1}
 */
const deltaOrient = ([x1, y1], [x2, y2], [x3, y3]) =>
  Math.sign((y2 - y1) * x3 - (x2 - x1) * y3);

/**
 * 2D scalar cross product of vectors a=(ax,ay), b=(bx,by).
 *
 * - Positive if b is CCW from a, negative if CW, 0 if parallel.
 * - Magnitude equals |a||b|sin(theta).
 *
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

/**
 * 2D dot product of vectors a=(ax,ay), b=(bx,by).
 *
 * - Positive if acute angle, negative if obtuse.
 * - Equals |a||b|cos(theta).
 *
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
const dot = (ax, ay, bx, by) => ax * bx + ay * by;

/**
 * Minimal absolute angular distance between angles a and b (radians).
 *
 * - Treats angles modulo 2π.
 * - Result is in [0, π].
 *
 * @param {number} a - Angle in radians.
 * @param {number} b - Angle in radians.
 * @returns {number} |wrapToPi(a - b)| but implemented without calling wrapToPi.
 */
const minAngleDist = (a, b) => {
  let diff = (a - b) % (2 * Math.PI);
  if (diff < -Math.PI) diff += 2 * Math.PI;
  else if (diff > Math.PI) diff -= 2 * Math.PI;
  return Math.abs(diff);
};

/**
 * Determine whether a polygon vertex is "critical" w.r.t. a viewpoint.
 *
 * Here "critical" means the rays from `pos` to the two incident edges (via vPrev, vNext)
 * do not straddle the vertex normally (i.e., the corner is tangent/degenerate from `pos`),
 * which is exactly when disk-vs-point visibility can differ in your algorithm.
 *
 * Returns:
 * -  0 if non-critical (regular).
 * - +1 if critical and the viewpoint is "entering" the corner.
 * - -1 if critical and the viewpoint is "leaving" the corner.
 *
 * Notes:
 * - If either orientation test is collinear (0), the vertex is considered critical.
 * - `direction` defaults to +1 when prevOrient + nextOrient == 0 (degenerate tie).
 *
 * @param {Vec2} pos - Viewpoint.
 * @param {Vec2} vPrev - Previous vertex on the polygon ring.
 * @param {Vec2} vertex - The corner vertex being tested.
 * @param {Vec2} vNext - Next vertex on the polygon ring.
 * @returns {-1|0|1} Criticality classification.
 */
const checkCriticality = (pos, vPrev, vertex, vNext) => {
  const prevOrient = deltaOrient(pos, vertex, vPrev);
  const nextOrient = deltaOrient(pos, vertex, vNext);
  const isCritical = !prevOrient || !nextOrient || prevOrient === nextOrient;
  const direction = Math.sign(prevOrient + nextOrient) || 1;
  const criticality = isCritical ? direction : 0; // -1 = leaving, +1 = entering, 0 = regular
  return criticality;
};

/**
 * Approximate equality for scalars with absolute tolerance.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} eps - Absolute tolerance.
 * @returns {boolean}
 */
const almostEq = (a, b, eps) => Math.abs(a - b) <= eps;

/**
 * Approximate equality for 2D points with absolute tolerance per coordinate.
 *
 * @param {Vec2} p
 * @param {Vec2} q
 * @param {number} eps - Absolute tolerance.
 * @returns {boolean}
 */
const ptEq = (p, q, eps) =>
  almostEq(p[0], q[0], eps) && almostEq(p[1], q[1], eps);

/**
 * 2D oriented area (cross) of triangle (a,b,c): cross(b-a, c-a).
 *
 * - >0 if (a,b,c) is CCW, <0 if CW, 0 if collinear.
 *
 * @param {Vec2} a
 * @param {Vec2} b
 * @param {Vec2} c
 * @returns {number}
 */
const orient = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Test whether point p lies on the segment a->b, with tolerance eps.
 *
 * Behavior:
 * - First checks near-collinearity using |orient(a,b,p)| <= eps.
 * - Then checks that p is within the axis-aligned bounding box of a,b expanded by eps.
 * - This counts endpoints as "on segment".
 *
 * @param {Vec2} a
 * @param {Vec2} b
 * @param {Vec2} p
 * @param {number} eps
 * @returns {boolean}
 */
const onSegment = (a, b, p, eps) => {
  if (Math.abs(orient(a, b, p)) > eps) return false;
  return (
    Math.min(a[0], b[0]) - eps <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    Math.min(a[1], b[1]) - eps <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
};

/**
 * Check if two indices i and j are adjacent along a cyclic ring ordering `idxs`.
 *
 * - Treats idxs as a cycle: last is adjacent to first.
 * - Adjacency is undirected: (i next to j) or (j next to i).
 * - Indices are compared by strict equality (===) to the stored values.
 *
 * @param {number[]} idxs - Cyclic ordering of indices.
 * @param {number} i
 * @param {number} j
 * @returns {boolean}
 */
const areRingAdjacent = (idxs, i, j) => {
  const L = idxs.length;
  for (let k = 0; k < L; k++) {
    const a = idxs[k];
    const b = idxs[(k + 1) % L];
    if ((a === i && b === j) || (a === j && b === i)) return true;
  }
  return false;
};

/**
 * Axis-aligned bounding box (AABB) of a set of points, optionally seeded.
 *
 * Seeding behavior:
 * - You can pass an existing bounds (minX,minY,maxX,maxY) to expand it in-place style.
 * - Defaults are ±Infinity so `bboxOf(points)` computes from scratch.
 *
 * @param {Vec2[]} points
 * @param {number} [minX=Infinity]
 * @param {number} [minY=Infinity]
 * @param {number} [maxX=-Infinity]
 * @param {number} [maxY=-Infinity]
 * @returns {BBox}
 */
const bboxOf = (
  points,
  minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity,
) => {
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Pack signed 32-bit cell coordinates (cx, cy) into a single BigInt key.
 *
 * Behavior:
 * - `cx|0` and `cy|0` force 32-bit signed int conversion (wraps if out of range).
 * - Then each is masked with 0xffffffffn to interpret as unsigned 32-bit.
 * - Key layout: (uint32(cx) << 32) | uint32(cy)
 * - Suitable for Map/Set keys without collision across the 32-bit range.
 *
 * @param {number} cx
 * @param {number} cy
 * @returns {bigint}
 */
const spatialCellKey = (cx, cy) =>
  ((BigInt(cx | 0) & 0xffffffffn) << 32n) | (BigInt(cy | 0) & 0xffffffffn);

/**
 * Classify the intersection between segments AB and CD.
 *
 * Returns one of:
 * - "proper": strict crossing with endpoints on opposite sides (no collinearity).
 * - "endpoint": touches at an endpoint or a single collinear-on-segment endpoint case.
 * - "overlap": collinear overlap over a non-zero-length portion.
 * - "none": no intersection.
 *
 * Tolerance behavior:
 * - Collinearity / on-segment checks use `eps` via onSegment() and ptEq().
 * - The "proper" test uses Math.sign(orient(...)) without eps, so near-collinear
 *   cases are expected to fall through to the onSegment/overlap logic.
 *
 * @param {Vec2} a
 * @param {Vec2} b
 * @param {Vec2} c
 * @param {Vec2} d
 * @param {number} eps
 * @returns {"proper"|"endpoint"|"overlap"|"none"}
 */
const segSegIntersectKind = (a, b, c, d, eps) => {
  const o1 = Math.sign(orient(a, b, c));
  const o2 = Math.sign(orient(a, b, d));
  const o3 = Math.sign(orient(c, d, a));
  const o4 = Math.sign(orient(c, d, b));

  if (o1 * o2 < 0 && o3 * o4 < 0) return "proper";

  const onAC = onSegment(a, b, c, eps);
  const onAD = onSegment(a, b, d, eps);
  const onCA = onSegment(c, d, a, eps);
  const onCB = onSegment(c, d, b, eps);

  const touches =
    ptEq(a, c, eps) || ptEq(a, d, eps) || ptEq(b, c, eps) || ptEq(b, d, eps);

  if (onAC || onAD || onCA || onCB) {
    if (!touches && (onAC || onAD) && (onCA || onCB)) return "overlap";
    const overlap = (onAC && onAD) || (onCA && onCB);
    if (overlap) return "overlap";
    return "endpoint";
  }
  return "none";
};

/**
 * Strict point-in-polygon test (boundary excluded) using winding number.
 *
 * Behavior:
 * - If p lies on any polygon edge (within eps), returns false.
 * - Otherwise uses winding number with orient() sign:
 *   wn != 0 => inside, wn == 0 => outside.
 *
 * Assumptions:
 * - `poly` is a simple polygon (non-self-intersecting) in either CW or CCW order.
 *
 * @param {Vec2} p
 * @param {Vec2[]} poly
 * @param {number} eps
 * @returns {boolean} True iff p is strictly inside (not on boundary).
 */
const pointInPolygonStrict = (p, poly, eps) => {
  for (let i = 0, n = poly.length; i < n; i++)
    if (onSegment(poly[i], poly[(i + 1) % n], p, eps)) return false;

  let wn = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && orient(a, b, p) > 0) ++wn;
    } else if (b[1] <= p[1] && orient(a, b, p) < 0) --wn;
  }
  return wn !== 0;
};

/**
 * Ray/segment intersection returning the ray parameter t where O + t*d hits segment C->D.
 *
 * Returns:
 * - `t >= 0` for the first hit along the ray direction.
 * - `null` if there is no intersection in the forward ray direction.
 *
 * Behavior details:
 * - Non-parallel case: solves intersection using Cramer's rule and accepts u in [-eps, 1+eps].
 * - Parallel case:
 *   - If not collinear (distance from C to ray line > eps): no hit.
 *   - If collinear: projects endpoints onto the ray and returns the nearest forward endpoint.
 *     This intentionally models collinear "slides" as hitting the closest forward endpoint.
 *
 * Assumption:
 * - Comments imply |d| = 1 (unit direction), but correctness only needs consistent projection
 *   scaling; if d is not unit, returned t is still in "units of d" (i.e., distance scaled by |d|).
 *
 * @param {Vec2} O - Ray origin.
 * @param {Vec2} d - Ray direction (prefer unit length).
 * @param {Vec2} C - Segment start.
 * @param {Vec2} D - Segment end.
 * @param {number} eps - Tolerance for parallel/collinear decisions and segment bounds.
 * @returns {number|null}
 */
const raySegParamT = (O, d, C, D, eps) => {
  const ex = D[0] - C[0];
  const ey = D[1] - C[1]; // segment direction e
  const cxo = C[0] - O[0];
  const cyo = C[1] - O[1]; // C - O

  const denom = util.cross(d[0], d[1], ex, ey); // cross(d, e)

  // Non-parallel case: solve with 2x2 (Cramer's rule)
  if (Math.abs(denom) > eps) {
    const t = util.cross(cxo, cyo, ex, ey) / denom; // t = cross(C-O, e)/cross(d,e)
    const u = util.cross(cxo, cyo, d[0], d[1]) / denom; // u = cross(C-O, d)/cross(d,e)
    if (t >= 0 && u >= -eps && u <= 1 + eps) return t;
    return null;
  }

  // Parallel: check collinearity (ray lies on the line of the segment?)
  const col = Math.abs(util.cross(cxo, cyo, d[0], d[1])) <= eps;
  if (!col) return null;

  // Project endpoints onto the ray direction and take the nearest forward point.
  const tC = util.dot(C[0] - O[0], C[1] - O[1], d[0], d[1]); // since |d|=1
  const tD = util.dot(D[0] - O[0], D[1] - O[1], d[0], d[1]);
  const candidates = [];
  if (tC >= 0) candidates.push(tC);
  if (tD >= 0) candidates.push(tD);
  if (candidates.length === 0) return null;

  // If the ray overlaps the whole segment ahead, choose the nearer endpoint.
  return Math.min(...candidates);
};

/**
 * Computes the parametric entry and exit distances of a ray with an axis-aligned bounding box.
 *
 * The ray is defined as:
 *   R(t) = O + t * d,  with t ≥ 0
 *
 * This uses the classic slab intersection test. For each axis, the ray intersects a
 * pair of parallel planes ("slabs"), producing a parametric interval. The intersection
 * of the X and Y intervals yields the final intersection range.
 *
 * Special behaviors:
 * - If a ray component is nearly zero (|d| ≤ eps), its inverse is treated as Infinity.
 *   This effectively means the ray is parallel to that slab axis.
 * - Intersections that occur entirely behind the ray origin (tExit < 0) are rejected.
 * - If the ray starts inside the box, tEnter will be clamped to 0.
 *
 * @param {Vec2} O
 * Ray origin.
 *
 * @param {Vec2} d
 * Ray direction vector. Assumed to be normalized by the caller
 * (this is true for the `_raycast` caller in this codebase).
 *
 * @param {BBox} bbox
 * Axis-aligned bounding box.
 *
 * @param {number} [eps=1e-12]
 * Tolerance used to treat direction components as zero.
 *
 * @returns {{tEnter:number, tExit:number} | null}
 * Returns the parametric interval of intersection with the ray,
 * or `null` if the ray does not intersect the bounding box.
 */
const rayAABBEntryExit = (O, d, bbox, eps = 1e-12) => {
  const invDx = Math.abs(d[0]) <= eps ? Infinity : 1 / d[0];
  const invDy = Math.abs(d[1]) <= eps ? Infinity : 1 / d[1];

  let t1 = (bbox.minX - O[0]) * invDx;
  let t2 = (bbox.maxX - O[0]) * invDx;
  let tmin = Math.min(t1, t2);
  let tmax = Math.max(t1, t2);

  t1 = (bbox.minY - O[1]) * invDy;
  t2 = (bbox.maxY - O[1]) * invDy;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));

  if (!(tmax >= tmin) || tmax < 0) return null;

  const tEnter = Math.max(0, tmin);
  const tExit = tmax;
  return { tEnter, tExit };
};

/**
 * Tests whether the direction from `curr` toward `target` lies inside
 * (or very near) the interior cone defined at a polygon vertex.
 *
 * The cone is defined by two edge direction vectors:
 *   vPrev : direction toward the previous vertex
 *   vNext : direction toward the next vertex
 *
 * Orientation `s` encodes polygon winding:
 *   s = +1 → CCW polygon
 *   s = -1 → CW polygon
 *
 * This function performs a *loose* inclusion test:
 *   - directions on or slightly outside the boundary are accepted
 *   - tolerance is controlled by `eps`
 *
 * This predicate is typically used as a **fast admissibility test**
 * before performing more expensive visibility checks.
 *
 * Special behaviors:
 * - If `curr` and `target` are equal (within eps), returns false.
 * - Boundary rays are allowed (≥ -eps).
 *
 * @param {VertexConeBasic|null} cone
 * Precomputed cone descriptor for the vertex.
 *
 * @param {Vec2} curr
 * Vertex position where the cone is defined.
 *
 * @param {Vec2} target
 * Point defining the candidate direction.
 *
 * @param {number} eps
 * Numerical tolerance for boundary inclusion.
 *
 * @returns {boolean}
 * True if the direction lies inside or near the cone.
 */
const dirLooselyInsideInteriorCone = (cone, curr, target, eps) => {
  if (!cone) return false;

  if (ptEq(curr, target, eps)) return false;

  const { vPrev, vNext, s } = cone;
  const dx = target[0] - curr[0];
  const dy = target[1] - curr[1];

  const c1 = s * util.cross(vNext[0], vNext[1], dx, dy);
  const c2 = s * util.cross(dx, dy, vPrev[0], vPrev[1]);

  return c1 >= -eps && c2 >= -eps;
};

/**
 * Tests whether the direction from `curr` toward `target` lies
 * strictly inside the interior cone of a polygon vertex.
 *
 * The cone is defined by the two incident edges:
 *   vPrev : direction toward the previous vertex
 *   vNext : direction toward the next vertex
 *
 * The orientation parameter `s` encodes ring winding:
 *   s = +1 → CCW polygon
 *   s = -1 → CW polygon
 *
 * For convex vertices the interior is the narrow wedge between the edges.
 * For reflex vertices the interior corresponds to the complement of that wedge.
 * The sign convention with `s` ensures the same inequality works for both windings.
 *
 * Special behaviors:
 * - Directions exactly on the boundary are rejected.
 * - Zero-length directions (curr ≈ target) are rejected.
 *
 * This stricter predicate is used when exact interior membership is required,
 * for example when constructing visibility edges.
 *
 * @param {VertexConeBasic|null} cone
 * Precomputed cone descriptor for the vertex.
 *
 * @param {Vec2} curr
 * Vertex position where the cone is defined.
 *
 * @param {Vec2} target
 * Point defining the candidate direction.
 *
 * @param {number} eps
 * Numerical tolerance used to enforce strict interior checks.
 *
 * @returns {boolean}
 * True if the direction lies strictly inside the interior cone.
 */
const dirStrictlyInsideInteriorCone = (cone, curr, target, eps) => {
  if (!cone) return false;

  if (ptEq(curr, target)) return false;

  const { vPrev, vNext, s } = cone;
  const dx = target[0] - curr[0];
  const dy = target[1] - curr[1];

  const c1 = s * util.cross(vNext[0], vNext[1], dx, dy);
  const c2 = s * util.cross(dx, dy, vPrev[0], vPrev[1]);

  return c1 >= eps && c2 >= eps;
};

/**
 * Computes the axis-aligned bounding box of a line segment.
 *
 * This is typically used for:
 * - spatial hashing
 * - AABB pruning before exact segment intersection
 *
 * @param {Vec2} c
 * Segment start point.
 *
 * @param {Vec2} d
 * Segment end point.
 *
 * @returns {BBox}
 * Bounding box of the segment.
 */
const edgeBBox = (c, d) => {
  const minX = Math.min(c[0], d[0]);
  const maxX = Math.max(c[0], d[0]);
  const minY = Math.min(c[1], d[1]);
  const maxY = Math.max(c[1], d[1]);
  return { minX, minY, maxX, maxY };
};

/**
 * Removes consecutive duplicate vertices from a polygon ring.
 *
 * This is useful for cleaning polygon input where numeric precision
 * or editing operations may introduce repeated vertices.
 *
 * Special behaviors:
 * - Uses `ptEq` with tolerance `eps` to determine equality.
 * - Only consecutive duplicates are removed.
 * - The first vertex is compared against the final vertex to
 *   correctly handle closed rings.
 *
 * The returned ring preserves the original ordering.
 *
 * @param {Vec2[]} ring
 * Polygon vertex list.
 *
 * @param {number} eps
 * Equality tolerance used for point comparisons.
 *
 * @returns {Vec2[]}
 * A new ring with consecutive duplicates removed.
 */
const normalizeRing = (ring, eps) => {
  let previous = ring[ring.length - 1];
  let newRing = [];
  for (const p of ring) {
    if (!ptEq(previous, p, eps)) newRing.push(p);
    previous = p;
  }
  return newRing;
};

/**
 * Tests whether two closed line segments properly intersect.
 *
 * "Proper" here means the intersection occurs strictly within the
 * interior of both segments. Pure endpoint-only touches are treated
 * as non-intersections.
 *
 * Special handling:
 * - Collinear overlap between segments counts as an intersection
 *   (treated as occlusion).
 * - If the only contact occurs exactly at an endpoint of either
 *   segment, it is NOT considered an intersection.
 *
 * Numerical robustness:
 * - `eps` is used as the tolerance for orientation tests and
 *   on-segment checks.
 *
 * Dependencies:
 * - `orient(a,b,c)` should return the signed orientation value.
 * - `onSegment(a,b,p)` checks if `p` lies on segment `ab`.
 * - `isEndpointOf(p,a,b)` checks if `p` coincides with an endpoint.
 *
 * @param {Vec2} a Segment AB start
 * @param {Vec2} b Segment AB end
 * @param {Vec2} c Segment CD start
 * @param {Vec2} d Segment CD end
 * @param {number} [eps=1e-9] Numerical tolerance
 * @returns {boolean} True if the segments intersect in a way that
 * occludes visibility under the above rules.
 */
const segmentsProperlyIntersect = (a, b, c, d, eps = 1e-9) => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps))
    if ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps)) return true;

  if (Math.abs(o1) <= eps && onSegment(a, b, c, eps))
    return !isEndpointOf(c, a, b, eps);
  if (Math.abs(o2) <= eps && onSegment(a, b, d, eps))
    return !isEndpointOf(d, a, b, eps);
  if (Math.abs(o3) <= eps && onSegment(c, d, a, eps))
    return !isEndpointOf(a, c, d, eps);
  if (Math.abs(o4) <= eps && onSegment(c, d, b, eps))
    return !isEndpointOf(b, c, d, eps);

  return false;
};

/**
 * Tests whether point `p` coincides with either endpoint of segment AB.
 *
 * Used to treat endpoint touches as non-occluding in intersection tests.
 *
 * Numerical behavior:
 * - Uses Euclidean distance ≤ eps to determine equality.
 *
 * @param {Vec2} p Point to test
 * @param {Vec2} a Segment start
 * @param {Vec2} b Segment end
 * @param {number} eps Tolerance
 * @returns {boolean} True if `p` is approximately equal to `a` or `b`.
 */
const isEndpointOf = (p, a, b, eps) =>
  Math.hypot(p[0] - a[0], p[1] - a[1]) <= eps ||
  Math.hypot(p[0] - b[0], p[1] - b[1]) <= eps;

/**
 * Computes the signed area of a polygon ring.
 *
 * Behavior:
 * - Positive area ⇒ vertices are ordered counter-clockwise.
 * - Negative area ⇒ vertices are ordered clockwise.
 * - Degenerate polygons produce area ≈ 0.
 *
 * Implementation:
 * - Standard shoelace formula.
 * - The polygon is implicitly closed (last vertex connects to first).
 *
 * @param {Vec2[]} points Polygon vertices
 * @returns {number} Signed area of the polygon.
 */
const signedArea = (points) => {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    a += x1 * y2 - y1 * x2;
  }
  return 0.5 * a;
};

/**
 * Computes geometric "visibility cones" for each vertex of a polygon ring.
 *
 * For each vertex `v`, the cone describes the angular region of the polygon
 * interior as seen from the vertex.
 *
 * Behavior:
 * - Handles both convex and reflex vertices.
 * - The interior angle width `w` is returned explicitly.
 * - Reflex vertices produce angles greater than π.
 *
 * Orientation:
 * - `s` should be +1 for CCW rings and -1 for CW rings.
 * - Reflex detection uses the sign of cross(vPrev, vNext) adjusted by `s`.
 *
 * Notes:
 * - Zero-length edges degrade to π width.
 * - The small angle between edges is computed first, then expanded to
 *   the true interior angle for reflex vertices.
 *
 * @param {Vec2[]} ring Polygon vertex ring.
 * @param {number} s Orientation sign (+1 CCW, -1 CW).
 * @returns {VertexCone[]} Per-vertex cone descriptors.
 */
const computeVertexCones = (ring, s) => {
  const cones = [];
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const cur = ring[k];
    const prev = ring[(k - 1 + n) % n];
    const next = ring[(k + 1) % n];

    const vPrev = [prev[0] - cur[0], prev[1] - cur[1]];
    const vNext = [next[0] - cur[0], next[1] - cur[1]];

    const dot = vPrev[0] * vNext[0] + vPrev[1] * vNext[1];
    const lenP = Math.hypot(vPrev[0], vPrev[1]);
    const lenN = Math.hypot(vNext[0], vNext[1]);

    const wSmall =
      lenP > 0 && lenN > 0
        ? Math.acos(Math.max(-1, Math.min(1, dot / (lenP * lenN))))
        : Math.PI;

    const cross = vPrev[0] * vNext[1] - vPrev[1] * vNext[0];
    const reflex = s * cross > 0;

    const w = reflex ? Math.PI * 2 - wSmall : wSmall;

    const aPrev = Math.atan2(vPrev[1], vPrev[0]);
    const aNext = Math.atan2(vNext[1], vNext[0]);

    cones.push({ vPrev, vNext, s, w, reflex, aPrev, aNext });
  }

  return cones;
};

/**
 * Initializes a grid-based ray traversal state using
 * Amanatides–Woo style DDA stepping.
 *
 * The ray is parameterized as:
 *   P(t) = origin + t * dir
 *
 * Behavior:
 * - Computes the first grid boundary crossings.
 * - Precomputes per-cell stepping increments.
 * - `tEnter` tracks the parametric position along the ray.
 *
 * Grid:
 * - Cells are squares of size `cs`.
 * - Cell indices are computed via floor(x / cs).
 *
 * Termination:
 * - Traversal should stop when `tEnter > tMax`.
 *
 * @param {Vec2} origin Ray origin
 * @param {Vec2} dir Ray direction vector
 * @param {number} tMax Maximum parametric ray length
 * @param {number} cs Cell size
 * @returns {RayWalkState} Mutable traversal state.
 */
const beginRayWalk = (origin, dir, tMax, cs) => {
  const [x0, y0] = origin;
  const [dx, dy] = dir;

  let cx = Math.floor(x0 / cs);
  let cy = Math.floor(y0 / cs);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const invDx = dx !== 0 ? 1 / dx : 0;
  const invDy = dy !== 0 ? 1 / dy : 0;

  const tMaxX =
    stepX !== 0
      ? ((stepX > 0 ? (cx + 1) * cs : cx * cs) - x0) * invDx
      : Infinity;

  const tMaxY =
    stepY !== 0
      ? ((stepY > 0 ? (cy + 1) * cs : cy * cs) - y0) * invDy
      : Infinity;

  const tDeltaX = stepX !== 0 ? cs * stepX * invDx : Infinity;
  const tDeltaY = stepY !== 0 ? cs * stepY * invDy : Infinity;

  return {
    x0,
    y0,
    dx,
    dy,
    cx,
    cy,
    stepX,
    stepY,
    tMaxX,
    tMaxY,
    tDeltaX: Math.abs(tDeltaX),
    tDeltaY: Math.abs(tDeltaY),
    tEnter: 0,
    tMax,
  };
};

/**
 * Advances a ray traversal state to the next grid cell.
 *
 * Behavior:
 * - Steps across whichever axis-aligned cell boundary
 *   the ray intersects first.
 * - Updates `cx`, `cy`, and `tEnter`.
 *
 * Termination:
 * - Returns false once traversal exceeds `tMax`.
 *
 * @param {RayWalkState} st Ray traversal state
 * @returns {boolean} True if traversal should continue.
 */
const advanceRayWalk = (st) => {
  if (st.tEnter > st.tMax) return false;

  if (st.tMaxX < st.tMaxY) {
    st.cx += st.stepX;
    st.tEnter = st.tMaxX;
    st.tMaxX += st.tDeltaX;
  } else {
    st.cy += st.stepY;
    st.tEnter = st.tMaxY;
    st.tMaxY += st.tDeltaY;
  }
  return st.tEnter <= st.tMax;
};

/**
 * Iterates through all grid cells intersected by a line segment.
 *
 * Uses the same DDA traversal logic as grid ray marching.
 *
 * Behavior:
 * - Calls `visitCell(key)` for each visited grid cell.
 * - If `visitCell` returns `true`, traversal stops early.
 *
 * Safety:
 * - Includes a hard iteration cap (1e6) to guard against
 *   pathological floating-point behavior.
 *
 * Typical usage:
 * - Spatial hash lookups
 * - Obstacle intersection pruning
 * - Visibility graph edge queries
 *
 * @param {Vec2} a Segment start
 * @param {Vec2} b Segment end
 * @param {number} cs Cell size
 * @param {(key:number|string)=>boolean|void} visitCell Callback invoked per cell.
 */
const walkGridCells = (a, b, cs, visitCell) => {
  let x0 = a[0];
  let y0 = a[1];
  let x1 = b[0];
  let y1 = b[1];

  const dx = x1 - x0;
  const dy = y1 - y0;

  let cx = Math.floor(x0 / cs);
  let cy = Math.floor(y0 / cs);

  if (visitCell(spatialCellKey(cx, cy)) === true) return;

  const cx1 = Math.floor(x1 / cs);
  const cy1 = Math.floor(y1 / cs);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const invDx = dx !== 0 ? 1 / dx : 0;
  const invDy = dy !== 0 ? 1 / dy : 0;

  let tMaxX =
    stepX !== 0
      ? ((stepX > 0 ? (cx + 1) * cs : cx * cs) - x0) * invDx
      : Infinity;

  let tMaxY =
    stepY !== 0
      ? ((stepY > 0 ? (cy + 1) * cs : cy * cs) - y0) * invDy
      : Infinity;

  const tDeltaX = stepX !== 0 ? cs * stepX * invDx : Infinity;
  const tDeltaY = stepY !== 0 ? cs * stepY * invDy : Infinity;

  let iter = 0;
  while ((cx !== cx1 || cy !== cy1) && iter++ < 1e6) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += Math.abs(tDeltaX);
    } else {
      cy += stepY;
      tMaxY += Math.abs(tDeltaY);
    }
    if (visitCell(spatialCellKey(cx, cy)) === true) return;
  }
};

/**
 * Normalizes a 2D vector.
 *
 * Behavior:
 * - Returns a unit-length vector in the same direction as `v`.
 * - If `v` has zero length, returns `[0,0]`.
 *
 * @param {Vec2} v
 * Input vector.
 *
 * @returns {Vec2}
 * Unit vector pointing in the same direction as `v`,
 * or `[0,0]` if the input has zero length.
 */
const normalize = (v) => {
  const L = Math.hypot(v[0], v[1]);
  return L === 0 ? [0, 0] : [v[0] / L, v[1] / L];
};

/**
 * Computes the outward unit normal of a directed edge.
 *
 * The edge is defined from `a → b`.
 * The returned vector is perpendicular to the edge and rotated
 * 90° clockwise relative to the edge direction.
 *
 * Behavior:
 * - The edge direction is `t = b - a`.
 * - The raw normal is `[t_y, -t_x]`.
 * - The result is normalized to unit length.
 * - Zero-length edges return `[0,0]`.
 *
 * Typical usage:
 * - Polygon offsetting
 * - Minkowski sums
 * - edge extrusion operations
 *
 * @param {Vec2} a
 * Edge start vertex.
 *
 * @param {Vec2} b
 * Edge end vertex.
 *
 * @returns {Vec2}
 * Unit outward normal vector.
 */
const outwardNormal = (a, b) => {
  const tx = b[0] - a[0];
  const ty = b[1] - a[1];
  if (tx === 0 && ty === 0) return [0, 0];
  return normalize([ty, -tx]);
};

/**
 * Applies a rigid transform to a list of points.
 *
 * The transform consists of:
 * - rotation about the origin by angle `theta`
 * - translation by `(tx, ty)`
 *
 * Transformation:
 *   p' = R(theta) * p + t
 *
 * Behavior:
 * - Rotation is applied first.
 * - Translation is applied second.
 * - The input array is not modified.
 *
 * @param {Vec2[]} points
 * Input points.
 *
 * @param {Vec2} translation
 * Translation vector `[tx, ty]`.
 *
 * @param {number} theta
 * Rotation angle in radians.
 *
 * @returns {Vec2[]}
 * Transformed points.
 */
const transformPoints = (points, [tx, ty], theta) => {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  return points.map(([x, y]) => [
    x * cosT - y * sinT + tx,
    x * sinT + y * cosT + ty,
  ]);
};

/**
 * Computes the positive CCW angular difference from `a0` to `a1`.
 *
 * The result represents the amount of counter-clockwise rotation
 * required to move from angle `a0` to angle `a1`.
 *
 * Range:
 *   result ∈ (0, 2π]
 *
 * Behavior:
 * - Angles are first normalized to the unit circle.
 * - If `a1` lies clockwise from `a0`, the result wraps across `2π`.
 *
 * Example:
 *   a0 = 350° , a1 = 10°  →  20°
 *
 * @param {number} a0
 * Starting angle in radians.
 *
 * @param {number} a1
 * Target angle in radians.
 *
 * @returns {number}
 * Positive CCW angular difference.
 */
const ccwAngleDelta = (a0, a1) => {
  a0 = Math.atan2(Math.sin(a0), Math.cos(a0));
  a1 = Math.atan2(Math.sin(a1), Math.cos(a1));

  let d = a1 - a0;
  if (d <= 0) d += TAU;
  return d;
};

/**
 * Clamps a scalar value to the interval [0,1].
 *
 * @param {number} x
 * Input value.
 *
 * @returns {number}
 * Clamped value.
 */
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Cubic smoothstep interpolation function.
 *
 * Maps an input `u ∈ [0,1]` to a smooth curve that starts
 * and ends with zero derivative.
 *
 * Formula:
 *   f(u) = u² (3 − 2u)
 *
 * Properties:
 * - f(0) = 0
 * - f(1) = 1
 * - f'(0) = f'(1) = 0
 *
 * Widely used for:
 * - animation easing
 * - procedural generation
 * - interpolation weights
 *
 * @param {number} u
 * Input parameter.
 *
 * @returns {number}
 * Smoothstep interpolation value.
 */
const smoothstep = (u) => u * u * (3 - 2 * u);

/**
 * Linearly interpolates between two 3-component vectors.
 *
 * The interpolation parameter `t` is not clamped.
 *
 * Formula:
 *   mix(a,b,t) = (1−t)a + tb
 *
 * @param {Vec3} a
 * First vector.
 *
 * @param {Vec3} b
 * Second vector.
 *
 * @param {number} t
 * Interpolation parameter.
 *
 * @returns {Vec3}
 * Interpolated vector.
 */
const mix3 = (a, b, t) => [
  (1 - t) * a[0] + t * b[0],
  (1 - t) * a[1] + t * b[1],
  (1 - t) * a[2] + t * b[2],
];

/**
 * Builds an axis-aligned rectangular boundary polygon from its sides.
 *
 * The rectangle is returned in clockwise order starting from the
 * top-left corner:
 *   [left, top] → [right, top] → [right, bottom] → [left, bottom]
 *
 * The polygon is not explicitly closed; the first vertex is not repeated
 * at the end.
 *
 * @param {number} left
 * Left x-coordinate.
 *
 * @param {number} top
 * Top y-coordinate.
 *
 * @param {number} right
 * Right x-coordinate.
 *
 * @param {number} bottom
 * Bottom y-coordinate.
 *
 * @returns {Polygon}
 * Four-vertex rectangle polygon.
 */
const buildBoundaryRect = (left, top, right, bottom) => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
];

/**
 * Builds a closed axis-aligned square centered at a given point.
 *
 * The square extends `size` units in the positive and negative x/y
 * directions from the center, so its total width and height are `2 * size`.
 *
 * The returned polygon is explicitly closed by repeating the first
 * vertex as the final vertex.
 *
 * @param {Vec2} center
 * Center point of the square.
 *
 * @param {number} [size=1]
 * Half-size of the square.
 *
 * @returns {ClosedPolygon}
 * Closed square polygon.
 */
const squareAt = ([cx, cy], size = 1) => [
  [cx - size, cy - size],
  [cx + size, cy - size],
  [cx + size, cy + size],
  [cx - size, cy + size],
  [cx - size, cy - size],
];

/**
 * Builds a closed rectangle centered on the segment from `c` to `d`.
 *
 * The rectangle's long axis lies along the line from `c` to `d`, and its
 * short axis is perpendicular to that line. Its total thickness is `2`
 * units, i.e. half-height `1`.
 *
 * This is useful for drawing a "bar" or thick segment between two points.
 *
 * Degenerate case:
 * - If the input points coincide, the function returns `squareAt(c)`.
 *
 * The returned polygon is explicitly closed by repeating the first
 * vertex as the final vertex.
 *
 * @param {Vec2} c
 * Start point / first endpoint.
 *
 * @param {Vec2} d
 * End point / second endpoint.
 *
 * @returns {ClosedPolygon}
 * Closed rectangle polygon spanning the two points.
 */
const crossbarsAt = ([cx, cy], [dx, dy]) => {
  let vx = dx - cx;
  let vy = dy - cy;
  const len = Math.hypot(vx, vy);

  // Degenerate case: points coincide → just draw the 2x2 square
  if (len === 0) return squareAt([cx, cy]);

  // Unit direction from c → d
  vx /= len;
  vy /= len;

  // Perpendicular unit vector
  const nx = -vy;
  const ny = vx;

  // Rectangle parameters
  const halfWidth = len / 2; // along the line between the points
  const halfHeight = 1; // total height = 2

  // Center at midpoint between the two points
  const mx = (cx + dx) / 2;
  const my = (cy + dy) / 2;

  // Four corners (counter-clockwise) and close the polygon
  const p1 = [
    mx - vx * halfWidth - nx * halfHeight,
    my - vy * halfWidth - ny * halfHeight,
  ];
  const p2 = [
    mx + vx * halfWidth - nx * halfHeight,
    my + vy * halfWidth - ny * halfHeight,
  ];
  const p3 = [
    mx + vx * halfWidth + nx * halfHeight,
    my + vy * halfWidth + ny * halfHeight,
  ];
  const p4 = [
    mx - vx * halfWidth + nx * halfHeight,
    my - vy * halfWidth + ny * halfHeight,
  ];

  return [p1, p2, p3, p4, p1];
};

/**
 * Inclusive point-in-polygon test for an explicitly closed polygon.
 *
 * Behavior:
 * - Returns true if the point lies strictly inside the polygon.
 * - Returns true if the point lies on any boundary edge.
 * - Returns false only when the point is strictly outside.
 *
 * Assumptions:
 * - `poly` is a closed polygon, meaning `poly[0] === poly[poly.length - 1]`.
 * - Minimum valid closed polygon length is 4, e.g. `[v0, v1, v2, v0]`.
 *
 * Implementation:
 * - First checks each boundary segment using `onSegment`.
 * - Then applies an even-odd ray crossing test.
 *
 * @param {Vec2} p
 * Point to test.
 *
 * @param {ClosedPolygon} poly
 * Explicitly closed polygon boundary.
 *
 * @param {number} [eps=1e-9]
 * Numerical tolerance for boundary checks.
 *
 * @returns {boolean}
 * True iff the point is inside or on the boundary.
 */
const pointInClosedPolygonInclusive = (p, poly, eps = 1e-9) => {
  if (!poly || poly.length < 4) return false;

  for (let i = 0; i < poly.length - 1; i++) {
    if (onSegment(poly[i], poly[i + 1], p, eps)) return true;
  }

  const px = p[0];
  const py = p[1];
  let inside = false;

  for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];

    const intersects = yi > py !== yj > py;
    if (!intersects) continue;

    const xAtY = xj + ((py - yj) * (xi - xj)) / (yi - yj);
    if (xAtY > px) inside = !inside;
  }

  return inside;
};

/**
 * Computes the first intersection point between a line segment and a circle.
 *
 * The segment is parameterized as:
 *   P(t) = A + t(B - A),  t in [0,1]
 *
 * The circle is centered at `center` with squared radius `r2`.
 *
 * Returns:
 * - the first intersection encountered from `a` toward `b`
 * - `null` if the segment does not intersect the circle
 *
 * Degenerate case:
 * - If `a === b`, the segment is treated as a point.
 * - In that case, returns `a` if the point lies in or on the circle.
 *
 * Notes:
 * - Tangential contact counts as an intersection.
 * - The returned point is the smaller valid root (`t1`) if present,
 *   otherwise the larger valid root (`t2`).
 *
 * @param {Vec2} a
 * Segment start point.
 *
 * @param {Vec2} b
 * Segment end point.
 *
 * @param {Vec2} center
 * Circle center.
 *
 * @param {number} r2
 * Circle radius squared.
 *
 * @returns {Vec2|null}
 * First segment-circle intersection point, or `null`.
 */
const segmentCircleFirstIntersection = (a, b, center, r2) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - center[0];
  const fy = a[1] - center[1];

  const qa = dx * dx + dy * dy;
  const dist2 = fx * fx + fy * fy;

  if (qa === 0) return dist2 <= r2 ? [a[0], a[1]] : null;

  const qb = 2 * (fx * dx + fy * dy);
  const qc = dist2 - r2;
  const disc = qb * qb - 4 * qa * qc;

  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-qb - sqrtDisc) / (2 * qa);
  const t2 = (-qb + sqrtDisc) / (2 * qa);

  if (t1 >= 0 && t1 <= 1) return [a[0] + t1 * dx, a[1] + t1 * dy];
  if (t2 >= 0 && t2 <= 1) return [a[0] + t2 * dx, a[1] + t2 * dy];

  return null;
};

/**
 * Translates a point by a fixed distance along one of the two unit normals
 * of a line segment, choosing the result based on polygon containment.
 *
 * Behavior:
 * - Builds two candidate points, one along each segment normal.
 * - Tests each candidate against `poly` using inclusive containment.
 * - Chooses the candidate that is inside or outside depending on `wantInside`.
 *
 * Fallback behavior:
 * - If both candidates are inside, or both are outside, returns the first
 *   candidate deterministically.
 *
 * Degenerate cases:
 * - If `line` is invalid or zero-length, returns `from` unchanged.
 *
 * @param {Vec2} from
 * Point to translate.
 *
 * @param {[Vec2, Vec2] | null} line
 * Reference segment whose normals define the translation directions.
 *
 * @param {number} distance
 * Signed translation magnitude along the chosen unit normal.
 *
 * @param {ClosedPolygon} poly
 * Polygon used to classify the candidate points.
 *
 * @param {boolean} [wantInside=true]
 * If true, prefer the candidate inside the polygon.
 * If false, prefer the candidate outside the polygon.
 *
 * @param {number} [eps=1e-9]
 * Numerical tolerance used for polygon containment.
 *
 * @returns {Vec2}
 * Selected translated point.
 */
const translateNormalIntoPoly = (
  from,
  line,
  distance,
  poly,
  wantInside = true,
  eps = 1e-9,
) => {
  if (!line || line.length !== 2) return [from[0], from[1]];

  const a = line[0];
  const b = line[1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);

  if (len === 0) return [from[0], from[1]];

  const nx = -dy / len;
  const ny = dx / len;

  const p1 = [from[0] + nx * distance, from[1] + ny * distance];
  const p2 = [from[0] - nx * distance, from[1] - ny * distance];

  const in1 = pointInClosedPolygonInclusive(p1, poly, eps);
  const in2 = pointInClosedPolygonInclusive(p2, poly, eps);

  if (wantInside) {
    if (in1 && !in2) return p1;
    if (in2 && !in1) return p2;
    return p1;
  }

  if (!in1 && in2) return p1;
  if (!in2 && in1) return p2;
  return p1;
};

/**
 * Translates a point toward another point by a fixed distance.
 *
 * Behavior:
 * - Computes the unit direction from `from` to `to`.
 * - Returns `from + distance * dir`.
 * - Does not clamp to the target, so overshoot is allowed.
 *
 * Degenerate case:
 * - If `from === to`, returns `from`.
 *
 * @param {Vec2} from
 * Start point.
 *
 * @param {Vec2} to
 * Target point.
 *
 * @param {number} distance
 * Distance to move along the direction toward `to`.
 *
 * @returns {Vec2}
 * Translated point.
 */
const translateTowards = (from, to, distance) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);

  if (len === 0) return [from[0], from[1]];

  const t = distance / len;
  return [from[0] + dx * t, from[1] + dy * t];
};

/**
 * Translates a point directly away from another point by a fixed distance.
 *
 * Behavior:
 * - Computes the unit direction from `fromWhat` to `from`.
 * - Returns `from + distance * dir`.
 * - Does not clamp, so the result may move arbitrarily far away.
 *
 * Degenerate case:
 * - If `from === fromWhat`, returns `from`.
 *
 * @param {Vec2} from
 * Start point.
 *
 * @param {Vec2} fromWhat
 * Point to move away from.
 *
 * @param {number} distance
 * Distance to move away.
 *
 * @returns {Vec2}
 * Translated point.
 */
const translateAway = (from, fromWhat, distance) => {
  const dx = from[0] - fromWhat[0];
  const dy = from[1] - fromWhat[1];
  const len = Math.hypot(dx, dy);

  if (len === 0) return [from[0], from[1]];

  const t = distance / len;
  return [from[0] + dx * t, from[1] + dy * t];
};

/**
 * Computes the closest point on a closed line segment to a query point.
 *
 * Behavior:
 * - Orthogonally projects `p` onto segment `ab`.
 * - Clamps the projection parameter to [0,1].
 * - Returns the nearest point on the segment.
 *
 * Degenerate case:
 * - If `a === b`, returns `a`.
 *
 * @param {Vec2} p
 * Query point.
 *
 * @param {Vec2} a
 * Segment start point.
 *
 * @param {Vec2} b
 * Segment end point.
 *
 * @returns {Vec2}
 * Closest point on the segment.
 */
const closestPointOnSegment = (p, a, b) => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];

  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return [a[0], a[1]];

  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  return [a[0] + t * abx, a[1] + t * aby];
};

/**
 * Computes the closest point on a closed polygon boundary to a query point.
 *
 * Behavior:
 * - Iterates over each explicit polygon edge `poly[i] -> poly[i+1]`.
 * - Finds the closest point on each edge.
 * - Returns the closest boundary point, the supporting edge, and squared distance.
 *
 * Assumptions:
 * - `poly` is explicitly closed.
 * - The boundary is interpreted only through the explicit edges
 *   `poly[i] -> poly[i+1]` for `i = 0..length-2`.
 *
 * @param {Vec2} p
 * Query point.
 *
 * @param {ClosedPolygon} poly
 * Closed polygon boundary.
 *
 * @returns {{ line:[Vec2,Vec2], point:Vec2, dist2:number }}
 * Closest edge, closest point on that edge, and squared distance.
 */
const closestPointToPolygon = (p, poly) => {
  let bestX = 0;
  let bestY = 0;
  let bestD2 = Infinity;
  let bestA = [0, 0];
  let bestB = [0, 0];

  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const q = closestPointOnSegment(p, a, b);

    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const d2 = dx * dx + dy * dy;

    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = q[0];
      bestY = q[1];
      bestA = a;
      bestB = b;
      if (bestD2 === 0) break;
    }
  }

  return {
    line: [bestA, bestB],
    point: [bestX, bestY],
    dist2: bestD2,
  };
};

/**
 * Computes the closest point from a query point to a union of closed polygons.
 *
 * Behavior:
 * - Evaluates `closestPointToPolygon` for each polygon in `polys`.
 * - Returns the globally nearest result.
 * - Also returns which polygon produced that nearest point.
 *
 * Degenerate behavior:
 * - If `polys` is empty, the returned point/line/poly are `null`
 *   and `dist2` remains `Infinity`.
 *
 * @param {Vec2} p
 * Query point.
 *
 * @param {ClosedPolygon[]} polys
 * Collection of closed polygons.
 *
 * @returns {{ poly:ClosedPolygon|null, line:[Vec2,Vec2]|null, point:Vec2|null, dist2:number }}
 * Closest polygon, closest edge on that polygon, closest point, and squared distance.
 */
const closestPointToPolygonUnion = (p, polys) => {
  let bestPoly = null;
  let bestLine = null;
  let bestPoint = null;
  let bestD2 = Infinity;

  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    const { line, point, dist2 } = closestPointToPolygon(p, poly);

    if (dist2 < bestD2) {
      bestD2 = dist2;
      bestPoint = point;
      bestLine = line;
      bestPoly = poly;
      if (bestD2 === 0) break;
    }
  }

  return {
    poly: bestPoly,
    line: bestLine,
    point: bestPoint,
    dist2: bestD2,
  };
};

/**
 * Geometry and spatial utility helpers used throughout the visibility
 * and pathfinding systems.
 *
 * This module groups together:
 * - 2D vector math helpers
 * - orientation / intersection predicates
 * - polygon utilities
 * - visibility-cone tests
 * - spatial hashing helpers
 * - grid ray traversal (Amanatides–Woo)
 *
 * All functions are pure unless otherwise documented.
 *
 * @namespace util
 *
 */
export const util = {
  TAU,
  wrapToPi,
  deltaOrient,
  cross,
  dot,
  minAngleDist,
  checkCriticality,
  almostEq,
  ptEq,
  orient,
  onSegment,
  areRingAdjacent,
  bboxOf,
  spatialCellKey,
  segSegIntersectKind,
  pointInPolygonStrict,
  pointInClosedPolygonInclusive,
  raySegParamT,
  rayAABBEntryExit,
  dirLooselyInsideInteriorCone,
  dirStrictlyInsideInteriorCone,
  edgeBBox,
  normalizeRing,
  segmentsProperlyIntersect,
  isEndpointOf,
  signedArea,
  computeVertexCones,
  beginRayWalk,
  advanceRayWalk,
  walkGridCells,
  normalize,
  outwardNormal,
  transformPoints,
  ccwAngleDelta,
  clamp01,
  smoothstep,
  mix3,
  buildBoundaryRect,
  crossbarsAt,
  squareAt,
  segmentCircleFirstIntersection,
  translateNormalIntoPoly,
  translateTowards,
  translateAway,
  closestPointOnSegment,
  closestPointToPolygon,
  closestPointToPolygonUnion,
};

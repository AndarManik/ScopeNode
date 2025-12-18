// ---------- tiny helpers ----------
const EPS_DEFAULT = 1e-9;
const almostEq = (a, b, eps = EPS_DEFAULT) => Math.abs(a - b) <= eps;
const ptEq = (p, q, eps = EPS_DEFAULT) =>
  almostEq(p[0], q[0], eps) && almostEq(p[1], q[1], eps);

const orient = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const dedupPoints = (points, eps = 1e-10) => {
  // Works for negative coordinates too — rounding on signed numbers is fine.
  const key = (p) => `${Math.round(p[0] / eps)}:${Math.round(p[1] / eps)}`;
  const seen = new Map();
  const out = [];
  for (const p of points) {
    const k = key(p);
    if (!seen.has(k)) {
      seen.set(k, out.length);
      out.push(p);
    }
  }
  return out;
};

const onSegment = (a, b, p, eps = EPS_DEFAULT) => {
  if (Math.abs(orient(a, b, p)) > eps) return false;
  return (
    Math.min(a[0], b[0]) - eps <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    Math.min(a[1], b[1]) - eps <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
};

const segmentsProperlyIntersect = (a, b, c, d, eps = EPS_DEFAULT) => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -eps && o3 * o4 < -eps;
};

const segmentsIntersect = (a, b, c, d, eps = EPS_DEFAULT) => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < -eps && o3 * o4 < -eps) return true; // proper
  if (Math.abs(o1) <= eps && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= eps && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= eps && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= eps && onSegment(c, d, b)) return true;
  return false;
};

const buildUniqueRingEdgesForSinglePolygon = (poly, indexOfVertex) => {
  const ids = poly.map(indexOfVertex);
  const edges = [];
  for (let i = 0, n = ids.length; i < n; i++) {
    const a = ids[i],
      b = ids[(i + 1) % n];
    if (a !== b) edges.push(a < b ? [a, b] : [b, a]);
  }
  // dedup single polygon edges just in case input had duplicates
  edges.sort((e1, e2) => e1[0] - e2[0] || e1[1] - e2[1]);
  const uniq = [];
  for (const e of edges) {
    const last = uniq[uniq.length - 1];
    if (!last || last[0] !== e[0] || last[1] !== e[1]) uniq.push(e);
  }
  return uniq;
};

// Linear index lookup by coordinate equality
const indexOfVertex = (vertices, p) => {
  for (let i = 0; i < vertices.length; i++) if (ptEq(vertices[i], p)) return i;
  return -1;
};

// Adjacency helpers
const addEdgeUnique = (adj, i, j) => {
  if (i === j) return;
  const ai = adj[i];
  const aj = adj[j];
  if (!ai.includes(j)) ai.push(j);
  if (!aj.includes(i)) aj.push(i);
};
const haveEdge = (adj, i, j) => adj[i].includes(j);

// Map indices from prev.vertices → indices in deduped `vertices`
const mapPrevToNow = (prevVertices, vertices) => {
  const m = new Map();
  for (let i = 0; i < prevVertices.length; i++) {
    const idx = indexOfVertex(vertices, prevVertices[i]);
    if (idx !== -1) m.set(i, idx);
  }
  return m;
};

const pointInPolygonEx = (p, poly) => {
  // boundary?
  for (let i = 0, n = poly.length; i < n; i++)
    if (onSegment(poly[i], poly[(i + 1) % n], p))
      return { insideStrict: false, onBoundary: true };

  // ray cast strict
  let inside = false;
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    const inter =
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 0.0) + xi;
    if (inter) inside = !inside;
  }
  return { insideStrict: inside, onBoundary: false };
};

const strictlyInsideAny = (p, rings) =>
  rings.some((poly) => pointInPolygonEx(p, poly).insideStrict);

// Conservative interior hit test along a segment
const segmentPassesThroughStrictInterior = (a, b, rings) =>
  [0.25, 0.5, 0.75]
    .map((t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    .some((p) => strictlyInsideAny(p, rings));

// Collect all rings (existing + new)
const gatherRings = (prev, newPoly) =>
  prev ? [...prev.rings, newPoly.slice()] : [newPoly.slice()];

// Build ring edges (existing + new)
const gatherRingEdges = (prev, newPoly, vertices) => {
  const idxOf = (p) => indexOfVertex(vertices, p);
  const newRingEdges = buildUniqueRingEdgesForSinglePolygon(newPoly, idxOf);
  return {
    newRingEdges,
    allRingEdges: prev
      ? [...prev.ringEdges, ...newRingEdges]
      : [...newRingEdges],
  };
};

// Conservative “ring-side may be visible” check
const visibleForRingSide = (i, j, vertices, ringEdgesToTest, ringsAll) => {
  const A = vertices[i];
  const B = vertices[j];
  for (const [u, v] of ringEdgesToTest) {
    const sameSide = (i === u && j === v) || (i === v && j === u);
    if (sameSide) continue;
    const C = vertices[u];
    const D = vertices[v];
    if (segmentsProperlyIntersect(A, B, C, D)) return false;
  }
  if (segmentPassesThroughStrictInterior(A, B, ringsAll)) return false;
  return true;
};

// Check if an existing edge (i,j) becomes blocked by ONLY the newly inserted polygon
const edgeBlockedByNewPolygon = (
  i,
  j,
  vertices,
  newRingEdges,
  newPoly,
  eps = EPS_DEFAULT
) => {
  const A = vertices[i];
  const B = vertices[j];

  // Blocked by new polygon edges?
  for (const [u, v] of newRingEdges) {
    const C = vertices[u];
    const D = vertices[v];
    const sameSide = (i === u && j === v) || (i === v && j === u);

    if (segmentsProperlyIntersect(A, B, C, D)) return true;

    if (segmentsIntersect(A, B, C, D)) {
      if (sameSide) continue; // allow touching its own ring side
      const collinearCD =
        Math.abs(orient(A, B, C)) <= eps && Math.abs(orient(A, B, D)) <= eps;
      if (collinearCD) return true;
      const sharesEndpoint =
        ptEq(A, C) || ptEq(A, D) || ptEq(B, C) || ptEq(B, D);
      if (!sharesEndpoint) return true;
    }
  }

  // Or by its strict interior?
  if (segmentPassesThroughStrictInterior(A, B, [newPoly])) return true;
  return false;
};

// Fully conservative block test against ALL ring edges + ALL strict interiors
const edgeBlockedConservative = (
  i,
  j,
  vertices,
  allRingEdges,
  ringsAll,
  eps = EPS_DEFAULT
) => {
  const A = vertices[i];
  const B = vertices[j];

  for (const [u, v] of allRingEdges) {
    const sameSide = (i === u && j === v) || (i === v && j === u);
    if (sameSide) continue;
    const C = vertices[u];
    const D = vertices[v];

    if (segmentsProperlyIntersect(A, B, C, D)) return true;

    if (segmentsIntersect(A, B, C, D)) {
      const collinearCD =
        Math.abs(orient(A, B, C)) <= eps && Math.abs(orient(A, B, D)) <= eps;
      if (collinearCD) return true;
    }
  }

  if (segmentPassesThroughStrictInterior(A, B, ringsAll)) return true;
  return false;
};

// Get indices that are new (present now but not mapped from prev)
const computeNewIndices = (N, prevToNow) => {
  const isOldNow = new Array(N).fill(false);
  for (const idx of prevToNow.values()) isOldNow[idx] = true;
  const list = [];
  for (let i = 0; i < N; i++) if (!isOldNow[i]) list.push(i);
  return { isOldNow, newIndices: list };
};

// Try add if not blocked (uses conservative test)
const tryAddVisible = (i, j, adj, vertices, allRingEdges, ringsAll) => {
  if (!edgeBlockedConservative(i, j, vertices, allRingEdges, ringsAll)) {
    addEdgeUnique(adj, i, j);
    return true;
  }
  return false;
};

// ---------- main ----------

export function buildVisibilityGraph(newPoly, prev = null) {
  console.time("buildVisibilityGraph total");

  // ----- Dedup vertices (carry old if present)
  console.time("dedup vertices");
  const allRaw = prev ? [...prev.vertices, ...newPoly] : [...newPoly];
  const vertices = dedupPoints(allRaw);
  console.timeEnd("dedup vertices");

  const N = vertices.length;
  const edges = Array.from({ length: N }, () => []);

  // ----- First insertion: just permit valid ring sides of new polygon
  if (!prev) {
    console.time("first insertion ring setup");
    const rings = gatherRings(null, newPoly);
    const { newRingEdges } = gatherRingEdges(null, newPoly, vertices);
    for (const [i, j] of newRingEdges)
      if (visibleForRingSide(i, j, vertices, newRingEdges, rings))
        addEdgeUnique(edges, i, j);
    console.timeEnd("first insertion ring setup");

    console.timeEnd("buildVisibilityGraph total");
    return {
      vertices,
      edges,
      rings,
      ringEdges: newRingEdges,
    };
  }

  // ----- Subsequent insertions
  console.time("remap prev + gather rings/edges");
  const prevToNow = mapPrevToNow(prev.vertices, vertices);
  const rings = gatherRings(prev, newPoly);
  const { newRingEdges, allRingEdges } = gatherRingEdges(
    prev,
    newPoly,
    vertices
  );
  console.timeEnd("remap prev + gather rings/edges");

  // ----- REMOVE: copy prior edges while filtering ones blocked by the new polygon
  console.time("remove blocked edges (copy filtered)");
  for (let iPrev = 0; iPrev < prev.edges.length; iPrev++) {
    const iNow = prevToNow.get(iPrev);
    if (iNow == null) continue;
    for (const jPrev of prev.edges[iPrev]) {
      if (jPrev <= iPrev) continue; // undirected: only once
      const jNow = prevToNow.get(jPrev);
      if (jNow == null) continue;

      // keep only if NOT blocked by the new polygon
      if (
        !edgeBlockedByNewPolygon(iNow, jNow, vertices, newRingEdges, newPoly)
      ) {
        addEdgeUnique(edges, iNow, jNow);
      }
    }
  }
  console.timeEnd("remove blocked edges (copy filtered)");

  // ----- CONNECT: only touch pairs that involve the newly added vertices
  console.time("connect new vertices");
  const { isOldNow, newIndices } = computeNewIndices(N, prevToNow);

  // new ↔ old
  for (const i of newIndices) {
    for (let j = 0; j < N; j++) {
      if (j === i || !isOldNow[j]) continue;
      tryAddVisible(i, j, edges, vertices, allRingEdges, rings);
    }
  }

  // new ↔ new
  for (let a = 0; a < newIndices.length; a++) {
    for (let b = a + 1; b < newIndices.length; b++) {
      tryAddVisible(
        newIndices[a],
        newIndices[b],
        edges,
        vertices,
        allRingEdges,
        rings
      );
    }
  }
  console.timeEnd("connect new vertices");

  // Note: no separate "re-allow ring sides" phase:
  // ring sides that survived the removal pass remain; any needed new ones
  // get added during tryAddVisible above when appropriate.

  console.timeEnd("buildVisibilityGraph total");
  return {
    vertices,
    edges,
    rings,
    ringEdges: allRingEdges,
  };
}

//================================================================

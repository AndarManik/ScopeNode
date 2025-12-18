export class PathGraph {
  constructor(eps = 1e-9, cellSize = 64) {
    this.vertices = []; // [[x,y], ...]
    this.edges = []; // adjacency list: edges[i] = [j, ...]
    this._polygons = []; // internal: [{indices:[...], points:[[x,y],...], bbox:{minX,maxX,minY,maxY}, id:number}]
    this._EPS = eps;
    this._occluded = new Uint8Array(0); // length mirrors this.vertices.length

    // ---- spatial hash over polygon boundary edges ----
    this._cellSize = cellSize;
    this._edgeGrid = new Map(); // key -> Set(edgeId)
    this._edgeStore = new Map(); // edgeId -> {c:[x,y], d:[x,y], polyId:number, ei:number}
    this._nextPolyId = 0;
    this._vertexCone = []; // index -> { vPrev:[dx,dy], vNext:[dx,dy], s:+1|-1, w:number }
  }

  // --------------------- Public API ---------------------

  pushPolygon(ring) {
    if (!Array.isArray(ring) || ring.length < 3) {
      throw new Error("pushPolygon expects a ring of at least 3 points.");
    }

    // Step 1: append vertices
    const base = this.vertices.length;
    for (const p of ring) {
      this.vertices.push([p[0], p[1]]);
      this.edges.push([]);
    }
    // grow occlusion array for new vertices (new ones start as not occluded)
    if (this._occluded.length < this.vertices.length) {
      const next = new Uint8Array(this.vertices.length);
      next.set(this._occluded);
      // new entries default 0 (not occluded)
      this._occluded = next;
    }
    const idxs = Array.from({ length: ring.length }, (_, k) => base + k);

    // record polygon (w/ bbox) for occlusion + midpoint tests
    const bbox = this._bboxOf(ring);
    const polyId = this._nextPolyId++;
    this._polygons.push({
      id: polyId,
      indices: idxs.slice(),
      points: ring.map(([x, y]) => [x, y]),
      bbox,
    });

    this._markNewlyOccludedVertices(ring, idxs);

    const s = Math.sign(this._signedArea(ring)) || 1;
    this._computeAndStoreVertexCones(idxs, ring, s);

    // index its boundary edges into the spatial hash
    this._indexPolygonEdges(polyId, ring);

    // Step 2: remove old edges that intersect this new polygon
    this._removeEdgesBlockedByPolygon(idxs, ring, polyId);

    // Step 3: connect new vertices to visible old vertices
    this._connectNewVertices(idxs);

    // also (re)check boundary edges along the same polygon (new ring)
    this._reallowRingSides(idxs);
  }

  /**
   * Return all vertex indices visible from an arbitrary point [x,y].
   * Visibility uses the same grid-accelerated checks as vertex-to-vertex edges.
   * @param {[number, number]} pos
   * @returns {number[]} list of vertex indices visible from pos
   */
  visibleIndicesAt(pos) {
    const eps = this._EPS;
    const result = [];
    const N = this.vertices.length;

    // Build incident edge map once (lets rays slide across existing edges)
    const incident = this._buildIncidentEdgeMap();

    for (let j = 0; j < N; j++) {
      if (this._occluded[j]) continue; // skip permanently occluded vertices
      const V = this.vertices[j];

      // Quick reject: same point
      if (this._ptEq(pos, V, eps)) continue;

      // Use grid-based visibility test (adapted for point→vertex)
      if (this._visibleFromPointToVertex(pos, j, incident, eps)) {
        result.push(j);
      }
    }

    return result;
  }

  // --------------------- Internal helpers ---------------------

  _addEdge(i, j) {
    if (i === j) return;
    const a = this.edges[i];
    const b = this.edges[j];
    if (!a.includes(j)) a.push(j);
    if (!b.includes(i)) b.push(i);
  }

  _removeEdge(i, j) {
    const ai = this.edges[i];
    const aj = this.edges[j];
    if (!ai || !aj) return;
    const pi = ai.indexOf(j);
    if (pi >= 0) ai.splice(pi, 1);
    const pj = aj.indexOf(i);
    if (pj >= 0) aj.splice(pj, 1);
  }

  _removeEdgesBlockedByPolygon(newIdxs, newRing, newPolyId) {
    const eps = this._EPS;
    const N = this.vertices.length;
    const newSet = new Set(newIdxs);

    const toCheck = [];
    for (let i = 0; i < N; i++) {
      for (const j of this.edges[i]) {
        if (i < j) toCheck.push([i, j]);
      }
    }

    for (const [i, j] of toCheck) {
      // Keep boundary sides of the just-inserted ring for step 3 re-allow
      const bothOnNew = newSet.has(i) && newSet.has(j);
      if (bothOnNew && this._areRingAdjacent(newIdxs, i, j)) continue;
      if (this._occluded[i] || this._occluded[j]) {
        this._removeEdge(i, j);
        continue;
      }
      const A = this.vertices[i];
      const B = this.vertices[j];
      if (this._segmentBlockedBySpecificPolygon(A, B, newRing, newPolyId, eps))
        this._removeEdge(i, j);
    }
  }

  // Replaces the existing _connectNewVertices
  _connectNewVertices(newIdxs) {
    const eps = this._EPS;
    const N = this.vertices.length;
    const newSet = new Set(newIdxs);

    // Filter out new vertices that are already marked occluded
    const activeNew = [];
    for (const i of newIdxs) {
      if (!this._occluded[i]) activeNew.push(i);
    }
    if (activeNew.length === 0) return;

    // Build once (only if there is actual work to do)
    const incident = this._buildIncidentEdgeMap();

    for (const i of activeNew) {
      for (let j = 0; j < N; j++) {
        if (j === i || newSet.has(j)) continue; // only connect to OLD vertices
        if (this._occluded[j]) continue; // skip permanently occluded olds

        if (this._visibleViaGrid(i, j, incident, eps)) {
          this._addEdge(i, j);
        }
      }
    }
  }

  _reallowRingSides(newIdxs) {
    const eps = this._EPS;
    const L = newIdxs.length;
    for (let k = 0; k < L; k++) {
      const i = newIdxs[k];
      const j = newIdxs[(k + 1) % L];
      if (this._visibleViaGrid(i, j, null, eps, true)) this._addEdge(i, j);
      else this._removeEdge(i, j);
    }
  }

  _signedArea(points) {
    let a = 0;
    for (let i = 0, n = points.length; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % n];
      a += x1 * y2 - y1 * x2;
    }
    return 0.5 * a;
  }

  _computeAndStoreVertexCones(idxs, ring, s) {
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const cur = ring[k];
      const prev = ring[(k - 1 + n) % n];
      const next = ring[(k + 1) % n];

      const vPrev = [prev[0] - cur[0], prev[1] - cur[1]];
      const vNext = [next[0] - cur[0], next[1] - cur[1]];

      // interior angle width (optional – useful for metrics)
      const dot = vPrev[0] * vNext[0] + vPrev[1] * vNext[1];
      const lenP = Math.hypot(vPrev[0], vPrev[1]);
      const lenN = Math.hypot(vNext[0], vNext[1]);
      const w =
        lenP > 0 && lenN > 0
          ? Math.acos(Math.max(-1, Math.min(1, dot / (lenP * lenN))))
          : Math.PI;

      this._vertexCone[idxs[k]] = { vPrev, vNext, s, w };
    }
  }

  // Returns true iff direction curr->target lies STRICTLY inside interior cone at vertex i.
  // For CCW polygons (s=+1), the interior wedge is CCW from vNext to vPrev.
  // For CW (s=-1), inequalities flip.
  _dirStrictlyInsideInteriorCone(i, target, eps = this._EPS) {
    const cone = this._vertexCone[i];
    if (!cone) return false; // no owner? play safe: no cull

    const curr = this.vertices[i];
    const dx = target[0] - curr[0];
    const dy = target[1] - curr[1];

    // zero-length dir can't be "inside"
    if (Math.abs(dx) <= eps && Math.abs(dy) <= eps) return false;

    const { vPrev, vNext, s } = cone;

    // cross(u,v) helper inline
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;

    // For s=+1 (CCW): inside if cross(vNext, d) > 0 AND cross(d, vPrev) > 0.
    // For s=-1 (CW):  inside if cross(vNext, d) < 0 AND cross(d, vPrev) < 0.
    const c1 = s * cross(vNext[0], vNext[1], dx, dy);
    const c2 = s * cross(dx, dy, vPrev[0], vPrev[1]);

    // STRICT interior: allow exact boundary alignment (==0) to pass through
    // so ring sides and grazing rays aren't culled.
    return c1 > eps && c2 > eps;
  }

  // Replaces the existing _markNewlyOccludedVertices
  _markNewlyOccludedVertices(ring, newIdxs) {
    const eps = this._EPS;
    const newSet = new Set(newIdxs);

    // --- Pass 1: OLD vertices newly occluded by the NEW polygon ---
    const bbNew = this._bboxOf(ring);
    for (let j = 0; j < this.vertices.length; j++) {
      if (newSet.has(j)) continue; // only consider OLD vertices here
      if (this._occluded[j]) continue; // already permanently occluded

      const P = this.vertices[j];
      // bbox quick reject
      if (
        P[0] < bbNew.minX - eps ||
        P[0] > bbNew.maxX + eps ||
        P[1] < bbNew.minY - eps ||
        P[1] > bbNew.maxY + eps
      )
        continue;

      // Strict interior (boundary is *not* occluded)
      if (this._pointInPolygonStrict(P, ring, eps)) {
        this._occluded[j] = 1;
      }
    }

    // --- Pass 2: NEW vertices that are already inside any PRIOR polygon ---
    if (this._polygons.length > 0) {
      for (const vi of newIdxs) {
        if (this._occluded[vi]) continue; // already marked in pass 1 (rare), or earlier
        const P = this.vertices[vi];

        // Check only prior polygons (those inserted before this ring)
        // NOTE: this._polygons has not yet had the new polygon pushed when this runs.
        for (const poly of this._polygons) {
          const bb = poly.bbox;
          // bbox quick reject
          if (
            P[0] < bb.minX - eps ||
            P[0] > bb.maxX + eps ||
            P[1] < bb.minY - eps ||
            P[1] > bb.maxY + eps
          )
            continue;

          // Strict interior (boundary is *not* occluded)
          if (this._pointInPolygonStrict(P, poly.points, eps)) {
            this._occluded[vi] = 1;
            break; // no need to check other polygons
          }
        }
      }
    }
  }

  // --------------------- Grid-backed visibility ---------------------

  /**
   * Grid-accelerated visibility check for arbitrary source point → arbitrary source point.
   */
  _visibleFromPointToPoint(P, Q, eps = this._EPS) {
    // 1) boundary crossings via spatial hash
    const ignore = { A: new Set(), B: new Set() };

    const crosses = this._segmentCrossesAnyBoundaryGrid(
      P,
      Q,
      eps,
      ignore,
      null
    );
    if (crosses) return false;

    // 2) interior test (midpoint inside any polygon?)
    const mid = [(P[0] + Q[0]) * 0.5, (P[1] + Q[1]) * 0.5];
    for (const poly of this._polygons) {
      const bb = poly.bbox;
      if (
        mid[0] < bb.minX - eps ||
        mid[0] > bb.maxX + eps ||
        mid[1] < bb.minY - eps ||
        mid[1] > bb.maxY + eps
      ) {
        continue;
      }
      if (this._pointInPolygonStrict(mid, poly.points, eps)) return false;
    }
    return true;
  }

  /**
   * Grid-accelerated visibility check for arbitrary source point → vertex j.
   */
  _visibleFromPointToVertex(P, j, incident, eps) {
    const B = this.vertices[j];

    // 1) boundary crossings via spatial hash
    const ignore = { A: new Set(), B: new Set([j]) };
    if (incident) {
      for (const n of incident.get(j) || []) ignore.B.add(n);
    }
    const crosses = this._segmentCrossesAnyBoundaryGrid(
      P,
      B,
      eps,
      ignore,
      null
    );
    if (crosses) return false;

    // 2) interior test (midpoint inside any polygon?)
    const mid = [(P[0] + B[0]) * 0.5, (P[1] + B[1]) * 0.5];
    for (const poly of this._polygons) {
      const bb = poly.bbox;
      if (
        mid[0] < bb.minX - eps ||
        mid[0] > bb.maxX + eps ||
        mid[1] < bb.minY - eps ||
        mid[1] > bb.maxY + eps
      ) {
        continue;
      }
      if (this._pointInPolygonStrict(mid, poly.points, eps)) return false;
    }
    return true;
  }

  _visibleViaGrid(i, j, incidentOrNull, eps, skipPolyOwningEndpoints = false) {
    const A = this.vertices[i];
    const B = this.vertices[j];
    if (this._dirStrictlyInsideInteriorCone(i, B, eps)) return false;
    if (this._dirStrictlyInsideInteriorCone(j, A, eps)) return false;

    // Ignore sets to allow sliding along incident edges at endpoints
    const ignore = { A: new Set([i]), B: new Set([j]) };
    if (incidentOrNull) {
      for (const n of incidentOrNull.get(i) || []) ignore.A.add(n);
      for (const n of incidentOrNull.get(j) || []) ignore.B.add(n);
    }

    // 1) boundary crossings via spatial hash
    const crosses = this._segmentCrossesAnyBoundaryGrid(
      A,
      B,
      eps,
      ignore,
      skipPolyOwningEndpoints ? { i, j } : null
    );
    if (crosses) return false;

    // 2) interior test (midpoint) against only polygons whose AABB contains it
    const mid = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
    for (const poly of this._polygons) {
      const bb = poly.bbox;
      if (
        mid[0] < bb.minX - eps ||
        mid[0] > bb.maxX + eps ||
        mid[1] < bb.minY - eps ||
        mid[1] > bb.maxY + eps
      ) {
        continue;
      }
      if (this._pointInPolygonStrict(mid, poly.points, eps)) return false;
    }
    return true;
  }

  _segmentBlockedBySpecificPolygon(A, B, ringPoints, ringPolyId, eps) {
    // Use the grid for boundary crossings, but restrict candidates to this polygon's edges.
    if (this._segmentCrossesSpecificBoundaryGrid(A, B, ringPolyId, eps))
      return true;
    // If no boundary hit, interior containment is possible only if midpoint inside the ring
    const mid = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
    return this._pointInPolygonStrict(mid, ringPoints, eps);
  }

  _segmentCrossesAnyBoundaryGrid(A, B, eps, ignore, skipPolyOwnedBy = null) {
    const seenEdge = new Set();
    let hit = false;

    this._walkGridCells(A, B, (key) => {
      const bucket = this._edgeGrid.get(key);
      if (!bucket) return false; // keep walking
      for (const edgeId of bucket) {
        if (seenEdge.has(edgeId)) continue;
        seenEdge.add(edgeId);
        const ed = this._edgeStore.get(edgeId);
        if (!ed) continue;

        // Optionally skip polygons owning either endpoint (for ring-side re-allow)
        if (skipPolyOwnedBy) {
          const { i, j } = skipPolyOwnedBy;
          const ownsI = this._polyOwnsVertexIndex(ed.polyId, i);
          const ownsJ = this._polyOwnsVertexIndex(ed.polyId, j);
          if (ownsI || ownsJ) continue;
        }

        // incident-slide heuristic: if edge touches exactly at A or B, let it pass
        const touchesA = this._ptEq(A, ed.c, eps) || this._ptEq(A, ed.d, eps);
        const touchesB = this._ptEq(B, ed.c, eps) || this._ptEq(B, ed.d, eps);
        if (touchesA || touchesB) continue;

        const kind = this._segSegIntersectKind(A, B, ed.c, ed.d, eps);
        if (kind === "proper") {
          hit = true;
          return true;
        }
        if (kind === "endpoint" || kind === "overlap") {
          // If the touch is not exactly at our own endpoint, treat as blocking.
          const touchingAtOwnEndpoint = touchesA || touchesB;
          if (!touchingAtOwnEndpoint) {
            hit = true;
            return true;
          }
        }
      }
      return hit; // stop early if hit
    });

    return hit;
  }

  _segmentCrossesSpecificBoundaryGrid(A, B, polyId, eps) {
    const seenEdge = new Set();
    let hit = false;

    this._walkGridCells(A, B, (key) => {
      const bucket = this._edgeGrid.get(key);
      if (!bucket) return false;
      for (const edgeId of bucket) {
        const ed = this._edgeStore.get(edgeId);
        if (!ed || ed.polyId !== polyId) continue;
        if (seenEdge.has(edgeId)) continue;
        seenEdge.add(edgeId);

        const kind = this._segSegIntersectKind(A, B, ed.c, ed.d, eps);
        if (kind === "proper") {
          hit = true;
          return true;
        }
        if (kind === "endpoint" || kind === "overlap") {
          // if it's exactly touching at A/B we allow; otherwise block
          const touchingAtOwnEndpoint =
            this._ptEq(A, ed.c, eps) ||
            this._ptEq(A, ed.d, eps) ||
            this._ptEq(B, ed.c, eps) ||
            this._ptEq(B, ed.d, eps);
          if (!touchingAtOwnEndpoint) {
            hit = true;
            return true;
          }
        }
      }
      return hit;
    });

    return hit;
  }

  // --------------------- Grid building ---------------------

  _indexPolygonEdges(polyId, ring) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const c = ring[i];
      const d = ring[(i + 1) % n];
      const edgeId = `${polyId}:${i}`;
      this._edgeStore.set(edgeId, {
        c: [c[0], c[1]],
        d: [d[0], d[1]],
        polyId,
        ei: i,
      });
      this._rasterizeEdgeIntoGrid(edgeId, c, d);
    }
  }

  _rasterizeEdgeIntoGrid(edgeId, a, b) {
    // DDA across grid cells the edge passes through
    const add = (cx, cy) => {
      const key = this._cellKey(cx, cy);
      let bucket = this._edgeGrid.get(key);
      if (!bucket) {
        bucket = new Set();
        this._edgeGrid.set(key, bucket);
      }
      bucket.add(edgeId);
    };

    // Handle degenerate tiny segments
    if (
      this._almostEq(a[0], b[0], this._EPS) &&
      this._almostEq(a[1], b[1], this._EPS)
    ) {
      add(this._cellOf(a[0]), this._cellOf(a[1]));
      return;
    }

    // Amanatides & Woo style grid traversal
    const cs = this._cellSize;
    let x0 = a[0],
      y0 = a[1];
    let x1 = b[0],
      y1 = b[1];
    const dx = x1 - x0,
      dy = y1 - y0;

    let cx = this._cellOf(x0),
      cy = this._cellOf(y0);
    const cx1 = this._cellOf(x1),
      cy1 = this._cellOf(y1);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    const invDx = dx !== 0 ? 1 / dx : 0;
    const invDy = dy !== 0 ? 1 / dy : 0;

    const nextBoundaryX = (k) => k * cs + (stepX > 0 ? 0 : 0); // integer cell boundaries at multiples of cs
    const nextBoundaryY = (k) => k * cs + (stepY > 0 ? 0 : 0);

    let tMaxX, tMaxY;
    if (stepX !== 0) {
      const gx = stepX > 0 ? (cx + 1) * cs : cx * cs; // next vertical boundary
      tMaxX = (gx - x0) * invDx;
    } else tMaxX = Infinity;

    if (stepY !== 0) {
      const gy = stepY > 0 ? (cy + 1) * cs : cy * cs; // next horizontal boundary
      tMaxY = (gy - y0) * invDy;
    } else tMaxY = Infinity;

    const tDeltaX = stepX !== 0 ? cs * stepX * invDx : Infinity;
    const tDeltaY = stepY !== 0 ? cs * stepY * invDy : Infinity;

    // walk cells
    add(cx, cy);
    const maxIter = 1e6; // safety
    let iter = 0;
    while ((cx !== cx1 || cy !== cy1) && iter++ < maxIter) {
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += Math.abs(tDeltaX);
      } else {
        cy += stepY;
        tMaxY += Math.abs(tDeltaY);
      }
      add(cx, cy);
    }
  }

  _walkGridCells(a, b, visitCell /* (key) => stop? */) {
    const cs = this._cellSize;
    // DDA traversal identical to rasterize, but calls visitCell
    let x0 = a[0],
      y0 = a[1],
      x1 = b[0],
      y1 = b[1];
    const dx = x1 - x0,
      dy = y1 - y0;

    let cx = this._cellOf(x0),
      cy = this._cellOf(y0);
    const cx1 = this._cellOf(x1),
      cy1 = this._cellOf(y1);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    const invDx = dx !== 0 ? 1 / dx : 0;
    const invDy = dy !== 0 ? 1 / dy : 0;

    let tMaxX, tMaxY;
    if (stepX !== 0) {
      const gx = stepX > 0 ? (cx + 1) * cs : cx * cs;
      tMaxX = (gx - x0) * invDx;
    } else tMaxX = Infinity;

    if (stepY !== 0) {
      const gy = stepY > 0 ? (cy + 1) * cs : cy * cs;
      tMaxY = (gy - y0) * invDy;
    } else tMaxY = Infinity;

    const tDeltaX = stepX !== 0 ? cs * stepX * invDx : Infinity;
    const tDeltaY = stepY !== 0 ? cs * stepY * invDy : Infinity;

    const tryVisit = () => visitCell(this._cellKey(cx, cy)) === true;

    if (tryVisit()) return;
    const maxIter = 1e6;
    let iter = 0;
    while ((cx !== cx1 || cy !== cy1) && iter++ < maxIter) {
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += Math.abs(tDeltaX);
      } else {
        cy += stepY;
        tMaxY += Math.abs(tDeltaY);
      }
      if (tryVisit()) return;
    }
  }

  _cellOf(v) {
    return Math.floor(v / this._cellSize);
  }
  _cellKey(cx, cy) {
    return `${cx},${cy}`;
  }

  _polyOwnsVertexIndex(polyId, vi) {
    const p = this._polygons.find((p) => p.id === polyId);
    if (!p) return false;
    return p.indices.includes(vi);
  }

  // --------------------- Geometry utils (unchanged where possible) ---------------------

  _bboxOf(points) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  _buildIncidentEdgeMap() {
    const m = new Map();
    for (let i = 0; i < this.vertices.length; i++) m.set(i, new Set());
    for (let i = 0; i < this.vertices.length; i++) {
      for (const j of this.edges[i]) {
        m.get(i).add(j);
      }
    }
    return m;
  }

  _areRingAdjacent(idxs, i, j) {
    const L = idxs.length;
    for (let k = 0; k < L; k++) {
      const a = idxs[k];
      const b = idxs[(k + 1) % L];
      if ((a === i && b === j) || (a === j && b === i)) return true;
    }
    return false;
  }

  _almostEq(a, b, eps) {
    return Math.abs(a - b) <= eps;
  }
  _ptEq(p, q, eps) {
    return this._almostEq(p[0], q[0], eps) && this._almostEq(p[1], q[1], eps);
  }

  _orient(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  _onSegment(a, b, p, eps) {
    if (Math.abs(this._orient(a, b, p)) > eps) return false;
    return (
      Math.min(a[0], b[0]) - eps <= p[0] &&
      p[0] <= Math.max(a[0], b[0]) + eps &&
      Math.min(a[1], b[1]) - eps <= p[1] &&
      p[1] <= Math.max(a[1], b[1]) + eps
    );
  }

  /**
   * Segment-segment intersection kind:
   * - "none": no intersection
   * - "proper": interior-interior crossing
   * - "endpoint": touches at a single endpoint
   * - "overlap": collinear overlapping
   */
  _segSegIntersectKind(a, b, c, d, eps) {
    const o1 = Math.sign(this._orient(a, b, c));
    const o2 = Math.sign(this._orient(a, b, d));
    const o3 = Math.sign(this._orient(c, d, a));
    const o4 = Math.sign(this._orient(c, d, b));

    if (o1 * o2 < 0 && o3 * o4 < 0) return "proper";

    const onAC = this._onSegment(a, b, c, eps);
    const onAD = this._onSegment(a, b, d, eps);
    const onCA = this._onSegment(c, d, a, eps);
    const onCB = this._onSegment(c, d, b, eps);

    const touches =
      this._ptEq(a, c, eps) ||
      this._ptEq(a, d, eps) ||
      this._ptEq(b, c, eps) ||
      this._ptEq(b, d, eps);

    if (onAC || onAD || onCA || onCB) {
      const overlap = (onAC && onAD) || (onCA && onCB);
      if (!touches && (onAC || onAD) && (onCA || onCB)) return "overlap";
      if (overlap) return "overlap";
      return "endpoint";
    }
    return "none";
  }

  _pointInPolygonStrict(p, poly, eps) {
    for (let i = 0, n = poly.length; i < n; i++) {
      if (this._onSegment(poly[i], poly[(i + 1) % n], p, eps)) return false;
    }
    let wn = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i],
        b = poly[(i + 1) % n];
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && this._orient(a, b, p) > 0) ++wn;
      } else {
        if (b[1] <= p[1] && this._orient(a, b, p) < 0) --wn;
      }
    }
    return wn !== 0;
  }
}

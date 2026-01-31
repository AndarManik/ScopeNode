//  This is the first implementation of this algorithm and mostly all helper functions were AI generated. While those can be cleaned up, 'shineAt' may take advantage of strange properties and interactions of the helpers which I myself didn't realize. Rewriting shouldn't be super hard but i'll write a blog post on how to rewrite it.

const TAU = Math.PI * 2;

const wrapToPi = (x) => ((((x + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

const deltaOrient = ([x1, y1], [x2, y2], [x3, y3]) =>
  Math.sign((y2 - y1) * x3 - (x2 - x1) * y3);
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const dot = (ax, ay, bx, by) => ax * bx + ay * by;

const minAngleDist = (a, b) => {
  let diff = (a - b) % (2 * Math.PI);
  if (diff < -Math.PI) diff += 2 * Math.PI;
  else if (diff > Math.PI) diff -= 2 * Math.PI;
  return Math.abs(diff);
};

const checkCriticality = (pos, vPrev, vertex, vNext) => {
  const prevOrient = deltaOrient(pos, vertex, vPrev);
  const nextOrient = deltaOrient(pos, vertex, vNext);
  const isCritical = !prevOrient || !nextOrient || prevOrient === nextOrient;
  const direction = Math.sign(prevOrient + nextOrient) || 1;
  const criticality = isCritical ? direction : 0; // -1 = leaving, +1 = entering, 0 = regular
  return criticality;
};
export class LightGraph {
  constructor(game, eps = 1e-9, cellSize = 64) {
    this.radius = game.playerRadius;

    this.vertices = []; // [[x,y], ...]
    this.edges = []; // adjacency list: edges[i] = [j, ...]
    this.edgesMeta = [];
    this._polygons = []; // internal: [{indices:[...], points:[[x,y],...], bbox:{minX,maxX,minY,maxY}, id:number}]
    this._EPS = eps;
    this._occluded = new Uint8Array(0); // length mirrors this.vertices.length
    this._seenEdge = new Set();

    // ---- spatial hash over polygon boundary edges ----
    this._cellSize = cellSize;
    this._edgeGrid = new Map(); // key -> Set(edgeId)
    this._edgeStore = new Map(); // edgeId -> {c:[x,y], d:[x,y], polyId:number, ei:number}
    this._nextPolyId = 0;
    this._vertexCone = []; // index -> { vPrev:[dx,dy], vNext:[dx,dy], s:+1|-1, w:number }
    this._vertexVisibility = [];

    // persistent “seen” state without per-ray Set allocations
    this._edgeStamp = new Map(); // edgeId(string) -> uint32 stamp
    this._stamp = 1; // monotonically increasing visit id
  }

  // --------------------- Public API ---------------------

  pushPolygon(ring) {
    if (!Array.isArray(ring) || ring.length < 3) {
      throw new Error("pushPolygon expects a ring of at least 3 points.");
    }

    ring = this._normalizeRing(ring);

    // Step 1: append vertices
    const base = this.vertices.length;
    for (const p of ring) {
      this.vertices.push([p[0], p[1]]);
      this.edges.push([]);
      this.edgesMeta.push([]);
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

  shineAt(pos) {
    const pointPoly = [];
    const diskPoly = [];
    const visibleIndices = this.visibleIndicesAt(pos);
    if (!visibleIndices.length) return [[], []];

    const visible = visibleIndices.map((index) => {
      const vertex = this.vertices[index];
      const angle = Math.atan2(vertex[1] - pos[1], vertex[0] - pos[0]);
      const { vPrev, vNext } = this._vertexCone[index];
      const criticality = checkCriticality(pos, vPrev, vertex, vNext);
      return { index, vertex, angle, criticality };
    });

    visible.sort((a, b) => a.angle - b.angle);

    const diskConed = new Set();
    const toCone = [];

    const MAX_STEP = Math.PI / 2;
    for (let i = 0; i < visible.length; i++) {
      // pre angle safety check
      const a = visible[i];
      const b = visible[(i + 1) % visible.length];
      if (i === visible.length - 1 && b.angle <= a.angle) b.angle += TAU;

      const { index, vertex, angle, criticality } = a;
      if (criticality === -1) pointPoly.push(this._vertexRaycast(index, angle));
      pointPoly.push(vertex);
      if (criticality === +1) pointPoly.push(this._vertexRaycast(index, angle));
      if (criticality !== 0) toCone.push(index);

      // cast extra rays to fill polygon
      const delta = b.angle - a.angle;
      if (delta > MAX_STEP) {
        const angle = a.angle + delta / 2;
        const v = this._raycast(pos, angle);
        pointPoly.push(v);
      }
    }

    pointPoly.push(pointPoly[0]);

    while (toCone.length) {
      const index = toCone.pop();
      if (diskConed.has(index)) continue;
      const { diskCones, diskCascade } = this.diskConesAt(pos, index);
      diskPoly.push(...diskCones);
      toCone.push(...diskCascade);
      diskConed.add(index);
    }

    return [pointPoly, diskPoly];
  }

  // This calculates a polygon sourced at vertex[index] which is the region which
  // can see the disk at pos around the corner at vertex[index].

  // This works by treating the vertex as a pin hole which permits a point light
  // The angle of light extending out of the pinhole corresponds to the
  // angular width of the disk from that vertex.

  // A first angular sweep is done in the direction of the player 'opDirection'
  // with the relative angular width of the player clipped by the vertex cone.
  // A second angular sweep is done in the direction away from the player
  // 'diretion' with the same angle as the opposite.
  // A vertex shine is built in all angle which are not obstructed in the first

  // segment fusing is done to reduce number of vertex shine calls.

  diskConesAt(pos, index) {
    const vertex = this.vertices[index];
    const delta = [vertex[0] - pos[0], vertex[1] - pos[1]];
    const direction = Math.atan2(delta[1], delta[0]);
    const opDirection = wrapToPi(direction + Math.PI);
    const distance = Math.hypot(delta[0], delta[1]);

    const { aPrev, aNext } = this._vertexCone[index];

    const prevAngleDist = minAngleDist(aPrev, direction);
    const nextAngleDist = minAngleDist(aNext, direction);
    const minAngle = Math.min(prevAngleDist, nextAngleDist);
    const angleDelta = Math.min(minAngle, Math.asin(this.radius / distance));

    const relativeStart = opDirection - angleDelta + Math.PI;
    const sweepWidth = 2 * angleDelta;
    const opSweepStart = wrapToPi(opDirection - angleDelta);
    const opSweepEnd = wrapToPi(opDirection + angleDelta);
    const sweepStart = wrapToPi(direction - angleDelta);
    const sweepEnd = wrapToPi(direction + angleDelta);

    if (!this._vertexVisibility[index]) this.buildVertexVisibility(index);
    const vertexVisibility = this._vertexVisibility[index];

    // First sweep towards pos to see if any parts are occuded.
    const fullyInCones = [];
    const boundCones = {};

    vertexVisibility.forEach((cone) => {
      const { curr, next } = cone;
      const currAngle = wrapToPi(curr.angle - relativeStart) + Math.PI;
      const nextAngle = wrapToPi(next.angle - relativeStart) + Math.PI;
      const currInside = 0 <= currAngle && currAngle <= sweepWidth;
      const nextInside = 0 <= nextAngle && nextAngle <= sweepWidth;
      if (!currInside && !nextInside) return;

      const startAngle = currInside ? curr.angle : opSweepStart;
      const endAngle = nextInside ? next.angle : opSweepEnd;

      const rayAngle =
        startAngle < endAngle
          ? (startAngle + endAngle) / 2
          : (startAngle - 2 * Math.PI + endAngle) / 2;
      const rayHit = this._vertexRaycast(index, rayAngle);
      // rayDist does a hypot but we can pull the t out of this._vertexRaycast
      const rayDist = Math.hypot(rayHit[0] - vertex[0], rayHit[1] - vertex[1]);
      if (rayDist < distance) return;

      if (currInside && nextInside) fullyInCones.push(cone);
      if (!currInside && nextInside) boundCones.start = cone;
      if (currInside && !nextInside) boundCones.end = cone;
    });

    // Sweep away from pos rooted at vertex to build disk cone

    const diskCones = [];
    const diskCascade = [];
    const storeShine = (index, sweepStart, sweepEnd) => {
      const { poly, cascade } = this.vertexShineAt(index, sweepStart, sweepEnd);
      if (!poly || !cascade) return;
      diskCones.push(poly);
      diskCascade.push(...cascade);
    };

    // each vertex shine will return indexes to recurse later this is just first order disk cone

    if (!fullyInCones.length && !boundCones.start && !boundCones.end) {
      const rayAngle =
        sweepStart < sweepEnd
          ? (sweepStart + sweepEnd) / 2
          : (sweepStart - 2 * Math.PI + sweepEnd) / 2;
      const rayHit = this._vertexRaycast(index, rayAngle + Math.PI);
      // rayDist does a hypot but we can pull the t out of this._vertexRaycast
      const rayDist = Math.hypot(rayHit[0] - vertex[0], rayHit[1] - vertex[1]);
      if (rayDist > distance) storeShine(index, sweepStart, sweepEnd);
      return { diskCones, diskCascade };
    }

    // fullyInCones: Array<{ curr, next }>

    let prevLen = -1;
    let pass = fullyInCones;

    while (pass.length !== prevLen) {
      prevLen = pass.length;

      const fusedSegments = []; // target of this pass

      pass.forEach(({ curr, next }) => {
        let added = false;

        fusedSegments.forEach((fused) => {
          if (!added && next === fused.curr) {
            fused.curr = curr; // extend chain on the left
            added = true;
          } else if (!added && curr === fused.next) {
            fused.next = next; // extend chain on the right
            added = true;
          }
        });

        if (!added) fusedSegments.push({ curr, next });
      });

      // next pass uses the newly fused list
      pass = fusedSegments;
    }

    const fusedSegments = pass; // final result

    if (boundCones.start) {
      const next = boundCones.start.next;
      let added = false;
      fusedSegments.forEach((fused) => {
        if (added) return;
        if (next != fused.curr) return;
        fused.start = true;
        added = true;
      });
      if (!added) fusedSegments.push({ start: true, next });
    }

    if (boundCones.end) {
      const curr = boundCones.end.curr;
      let added = false;
      fusedSegments.forEach((fused) => {
        if (added) return;
        if (curr != fused.next) return;
        fused.end = true;
        added = true;
      });
      if (!added) fusedSegments.push({ end: true, curr });
    }

    fusedSegments.forEach(({ curr, next, start, end }) =>
      storeShine(
        index,
        start ? sweepStart : wrapToPi(curr.angle + Math.PI),
        end ? sweepEnd : wrapToPi(next.angle + Math.PI)
      )
    );

    return { diskCones, diskCascade };
  }

  vertexShineAt(index, start, end) {
    const EPS = 1e-6;

    const safeEnd = start > end ? end + 2 * Math.PI : end;
    const mid = wrapToPi((start + safeEnd) / 2);
    const half = (safeEnd - start) / 2;
    const relevantEdges = this.edgesMeta[index]
      .filter((a) => Math.abs(wrapToPi(a.angle - mid)) <= half + EPS)
      .sort((a, b) => wrapToPi(a.angle - mid) - wrapToPi(b.angle - mid));

    const poly = [this.vertices[index]];
    const cascade = [];
    poly.push(this._vertexRaycast(index, start));

    relevantEdges.forEach(({ criticality, index, angle }) => {
      if (criticality === -1) poly.push(this._vertexRaycast(index, angle));
      if (
        Math.abs(wrapToPi(angle - start)) > EPS &&
        Math.abs(wrapToPi(angle - end)) > EPS
      )
        poly.push(this.vertices[index]);
      if (criticality === +1) poly.push(this._vertexRaycast(index, angle));
      if (criticality !== 0) cascade.push(index);
    });

    poly.push(this._vertexRaycast(index, end));
    poly.push(this.vertices[index]);

    // remove duplicates
    let write = 1;
    for (let read = 1; read < poly.length; read++) {
      if (
        poly[read][0] !== poly[read - 1][0] ||
        poly[read][1] !== poly[read - 1][1]
      )
        poly[write++] = poly[read];
    }

    poly.length = write; // truncate extra elements

    if (poly.length < 4) return { cascade };

    return { poly, cascade };
  }

  pointPolyAt(pos, visibleIndices = null) {
    const pointPoly = [];
    if (!visibleIndices) visibleIndices = this.visibleIndicesAt(pos);
    if (!visibleIndices.length) return [];

    const visible = visibleIndices.map((index) => {
      const vertex = this.vertices[index];
      const angle = Math.atan2(vertex[1] - pos[1], vertex[0] - pos[0]);
      const { vPrev, vNext } = this._vertexCone[index];
      const criticality = checkCriticality(pos, vPrev, vertex, vNext);
      return { index, vertex, angle, criticality };
    });

    // Sort by angle around pos
    visible.sort((a, b) => a.angle - b.angle);

    const MAX_STEP = Math.PI / 2;

    for (let i = 0; i < visible.length; i++) {
      const a = visible[i];
      const b = visible[(i + 1) % visible.length];

      // Wrap the last-to-first transition
      if (i === visible.length - 1 && b.angle <= a.angle) b.angle += TAU;

      const { index, vertex, angle, criticality } = a;

      // Handle critical vertices with extra rays
      if (criticality === -1) pointPoly.push(this._vertexRaycast(index, angle));

      pointPoly.push(vertex);

      if (criticality === +1) pointPoly.push(this._vertexRaycast(index, angle));

      // Fill in large angular gaps with a midpoint ray
      const delta = b.angle - a.angle;
      if (delta > MAX_STEP) {
        const midAngle = a.angle + delta / 2;
        const v = this._raycast(pos, midAngle);
        pointPoly.push(v);
      }
    }

    // Close the polygon if we actually have points
    if (pointPoly.length) pointPoly.push(pointPoly[0]);

    return pointPoly;
  }

  buildVertexVisibility(index, maxDist = 4e4) {
    const origin = this.vertices[index];

    this._vertexVisibility[index] = [];
    const meta = this.edgesMeta[index];
    const angularSorted = meta.sort((a, b) => a.angle - b.angle);
    for (let i = 0; i < angularSorted.length; i++) {
      const curr = angularSorted[i];
      const next = angularSorted[(i + 1) % angularSorted.length];

      const minAngle = curr.angle;
      const maxAngle =
        curr.angle > next.angle ? next.angle + 2 * Math.PI : next.angle;
      const midAngle = (minAngle + maxAngle) / 2;
      const dir = [Math.cos(midAngle), Math.sin(midAngle)];

      // visit-stamp to avoid retesting the same edge
      let bestT = maxDist;
      let bestEd = null;
      const stamp =
        (this._stamp = (this._stamp + 1) >>> 0) || (this._stamp = 1);
      const st = this._beginRayWalk(origin, dir, bestT);
      const MAX_ITERS = 1e6; // safety cap
      for (let i = 0; i < MAX_ITERS && st.tEnter <= st.tMax; i++) {
        const key = this._cellKey(st.cx, st.cy);
        const tNext = Math.min(st.tMaxX, st.tMaxY);

        // Process this cell's edges (if any)
        const bucket = this._edgeGrid.get(key);
        if (bucket) {
          for (const edgeId of bucket) {
            if (this._edgeStamp.get(edgeId) === stamp) continue;
            this._edgeStamp.set(edgeId, stamp);

            const ed = this._edgeStore.get(edgeId);
            if (!ed) continue;

            const boxHit = this._rayAABBEntryExit(
              origin,
              dir,
              ed.bbox,
              this._EPS
            );
            if (!boxHit) continue;
            if (boxHit.tEnter >= bestT) continue;

            // some how we need to store the ed parameter in the endCap to use later
            const t = this._raySegParamT(origin, dir, ed.c, ed.d, this._EPS);
            if (t !== null && t > this._EPS && t < bestT) {
              bestT = t;
              bestEd = ed;
            }
          }
        }

        // Early-out: next cell starts after nearest hit -> no farther cell can help
        if (tNext > bestT) break;

        // Keep marching
        if (!this._advanceRayWalk(st)) break;
      }

      const cone = { curr, next };

      if (bestEd) cone.endCap = bestEd;
      else cone.endCap = { doesNotHit: true };

      this._vertexVisibility[index].push(cone);
    }
  }

  _vertexRaycast(index, angle, maxDist = 4e4) {
    const origin = this.vertices[index];

    const dir = [Math.cos(angle), Math.sin(angle)];
    const directionAt = [origin[0] + dir[0], origin[1] + dir[1]];
    if (this._dirLooselyInsideInteriorCone(index, directionAt)) return origin;

    if (!this._vertexVisibility[index]) this.buildVertexVisibility(index);

    const vertexVisibility = this._vertexVisibility[index];

    angle = wrapToPi(angle);
    let angularIndex = 0;
    while (angularIndex < vertexVisibility.length) {
      if (angle <= vertexVisibility[angularIndex].curr.angle) break;
      angularIndex++;
    }
    angularIndex += vertexVisibility.length - 1;
    angularIndex %= vertexVisibility.length;

    const endCap = vertexVisibility[angularIndex].endCap;

    if (endCap.doesNotHit)
      return [origin[0] + dir[0] * maxDist, origin[1] + dir[1] * maxDist];

    const t = this._raySegParamT(origin, dir, endCap.c, endCap.d, this._EPS);
    return [origin[0] + dir[0] * t, origin[1] + dir[1] * t];
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

    for (let j = 0; j < N; j++) {
      if (this._occluded[j]) continue; // skip permanently occluded vertices
      const V = this.vertices[j];

      // Quick reject: same point
      if (this._ptEq(pos, V, eps)) continue;

      // Use grid-based visibility test (adapted for point→vertex)
      if (this._visibleFromPointToVertex(pos, j)) {
        result.push(j);
      }
    }

    return result;
  }

  // --------------------- Internal helpers ---------------------

  // --- add this helper somewhere near other geometry utils
  _edgeBBox(c, d) {
    const minX = Math.min(c[0], d[0]),
      maxX = Math.max(c[0], d[0]);
    const minY = Math.min(c[1], d[1]),
      maxY = Math.max(c[1], d[1]);
    return { minX, minY, maxX, maxY };
  }

  _normalizeRing(ring) {
    let previous = ring[ring.length - 1];
    let newRing = [];
    for (const p of ring) {
      if (!this._ptEq(previous, p, this._EPS)) newRing.push(p);
      previous = p;
    }
    return newRing;
  }

  _addEdge(i, j) {
    if (i === j) return;
    const a = this.edges[i];
    const b = this.edges[j];
    const aMeta = this.edgesMeta[i];
    const bMeta = this.edgesMeta[j];
    const va = this.vertices[i];
    const vb = this.vertices[j];
    const delta = [vb[0] - va[0], vb[1] - va[1]];
    const aAngle = Math.atan2(delta[1], delta[0]);
    const bAngle = wrapToPi(aAngle + Math.PI);
    const distance = Math.hypot(delta[0], delta[1]);

    const aCone = this._vertexCone[i];
    const bCone = this._vertexCone[j];
    const aCrit = checkCriticality(va, bCone.vPrev, vb, bCone.vNext);
    const bCrit = checkCriticality(vb, aCone.vPrev, va, aCone.vNext);
    if (!a.includes(j)) {
      a.push(j);
      aMeta.push({ index: j, distance, angle: aAngle, criticality: aCrit });
    }
    if (!b.includes(i)) {
      b.push(i);
      bMeta.push({ index: i, distance, angle: bAngle, criticality: bCrit });
    }
  }

  _removeEdge(i, j) {
    const ai = this.edges[i];
    const aj = this.edges[j];
    const bi = this.edgesMeta[i];
    const bj = this.edgesMeta[j];
    if (!ai || !aj) return;
    const pi = ai.indexOf(j);
    if (pi >= 0) {
      ai.splice(pi, 1);
      bi.splice(pi, 1);
    }
    const pj = aj.indexOf(i);
    if (pj >= 0) {
      aj.splice(pj, 1);
      bj.splice(pj, 1);
    }
  }

  _removeEdgesBlockedByPolygon(newIdxs, newRing, newPolyId) {
    const eps = this._EPS;
    const N = this.vertices.length;
    const newSet = new Set(newIdxs);

    const toCheck = [];
    for (let i = 0; i < N; i++)
      for (const j of this.edges[i]) if (i < j) toCheck.push([i, j]);

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
    if (L < 2) return;

    for (let k = 0; k < L; k++) {
      const i = newIdxs[k];
      for (let l = k + 1; l < L; l++) {
        const j = newIdxs[l];

        // Adjacent along the ring (including wrap-around): always allow
        const adjacent = l === k + 1 || (k === 0 && l === L - 1);

        if (adjacent) {
          this._addEdge(i, j);
          continue;
        }

        // Reject if the chord crosses any edge of this ring (self-occlusion)
        if (this._segmentCrossesRingExceptAdj(i, j, newIdxs, eps)) {
          this._removeEdge(i, j);
          continue;
        }

        // Usual visibility test (still skip poly-owning endpoints if that's desired elsewhere)
        if (this._visibleViaGrid(i, j, null, eps, true)) this._addEdge(i, j);
        else this._removeEdge(i, j);
      }
    }
  }

  // Returns true if segment (i,j) intersects any edge of `ringIdxs`
  // except edges incident to i or j (the two adjacent sides).
  _segmentCrossesRingExceptAdj(i, j, ringIdxs, eps = 1e-9) {
    const A = this.vertices[i];
    const B = this.vertices[j];
    const L = ringIdxs.length;

    for (let t = 0; t < L; t++) {
      const u = ringIdxs[t];
      const v = ringIdxs[(t + 1) % L];

      // Skip the two edges that share endpoints with (i,j)
      const incident = u === i || v === i || u === j || v === j;
      if (incident) continue;

      const U = this.vertices[u];
      const V = this.vertices[v];

      if (this._segmentsProperlyIntersect(A, B, U, V, eps)) return true;
    }
    return false;
  }

  // Proper intersection test (no endpoint-only touch).
  _segmentsProperlyIntersect(a, b, c, d, eps = 1e-9) {
    const o1 = this._orient(a, b, c);
    const o2 = this._orient(a, b, d);
    const o3 = this._orient(c, d, a);
    const o4 = this._orient(c, d, b);

    // Strict crossings
    if ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) {
      if ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps)) return true;
    }

    // Collinear overlaps count as occlusion too (inside the boundary),
    // but exclude endpoint-only touches.
    const onSeg = (p, q, r) => this._onSegment(p, q, r, eps);
    if (Math.abs(o1) <= eps && onSeg(a, b, c))
      return !this._isEndpointOf(c, a, b, eps);
    if (Math.abs(o2) <= eps && onSeg(a, b, d))
      return !this._isEndpointOf(d, a, b, eps);
    if (Math.abs(o3) <= eps && onSeg(c, d, a))
      return !this._isEndpointOf(a, c, d, eps);
    if (Math.abs(o4) <= eps && onSeg(c, d, b))
      return !this._isEndpointOf(b, c, d, eps);

    return false;
  }

  // Helper to treat exact endpoint touches as non-occluding for the intended edges
  _isEndpointOf(p, a, b, eps = 1e-9) {
    return (
      Math.hypot(p[0] - a[0], p[1] - a[1]) <= eps ||
      Math.hypot(p[0] - b[0], p[1] - b[1]) <= eps
    );
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
  // Pre: ring is CCW when s = +1, CW when s = -1
  _computeAndStoreVertexCones(idxs, ring, s) {
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const cur = ring[k];
      const prev = ring[(k - 1 + n) % n];
      const next = ring[(k + 1) % n];

      const vPrev = [prev[0] - cur[0], prev[1] - cur[1]]; // cur->prev
      const vNext = [next[0] - cur[0], next[1] - cur[1]]; // cur->next

      // Small angle between vPrev and vNext (0..π)
      const dot = vPrev[0] * vNext[0] + vPrev[1] * vNext[1];
      const lenP = Math.hypot(vPrev[0], vPrev[1]);
      const lenN = Math.hypot(vNext[0], vNext[1]);
      const wSmall =
        lenP > 0 && lenN > 0
          ? Math.acos(Math.max(-1, Math.min(1, dot / (lenP * lenN))))
          : Math.PI;

      // Use cross to detect reflex. For CCW rings (s=+1),
      // reflex <=> cross(vPrev, vNext) > 0 (because vPrev = -e_in).
      const cross = vPrev[0] * vNext[1] - vPrev[1] * vNext[0];
      const reflex = s * cross > 0;

      // Interior angle width (actual interior, not just the small angle)
      const w = reflex ? Math.PI * 2 - wSmall : wSmall;

      const aPrev = Math.atan2(vPrev[1], vPrev[0]);
      const aNext = Math.atan2(vNext[1], vNext[0]);

      this._vertexCone[idxs[k]] = { vPrev, vNext, s, w, reflex, aPrev, aNext };
    }
  }

  // Returns true iff direction curr->target lies STRICTLY inside interior cone at vertex i.
  // For CCW rings (s=+1): the narrow wedge is CCW from vNext to vPrev.
  // For reflex vertices, the interior is the COMPLEMENT of that narrow wedge.
  _dirStrictlyInsideInteriorCone(i, target, eps = this._EPS) {
    const cone = this._vertexCone[i];
    if (!cone) return false;

    const curr = this.vertices[i];
    const dx = target[0] - curr[0];
    const dy = target[1] - curr[1];

    // Zero-length direction can't be "inside"
    if (Math.abs(dx) <= eps && Math.abs(dy) <= eps) return false;

    const { vPrev, vNext, s } = cone;

    // cross(u,v)
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;

    // For s=+1 (CCW): inside the NARROW wedge iff cross(vNext,d)>0 AND cross(d,vPrev)>0.
    // For s=-1 (CW): inequalities flip via multiplying by s.
    const c1 = s * cross(vNext[0], vNext[1], dx, dy);
    const c2 = s * cross(dx, dy, vPrev[0], vPrev[1]);

    return c1 >= eps && c2 >= eps;
  }

  _dirLooselyInsideInteriorCone(i, target, eps = this._EPS) {
    const cone = this._vertexCone[i];
    if (!cone) return false;

    const curr = this.vertices[i];
    const dx = target[0] - curr[0];
    const dy = target[1] - curr[1];

    if (Math.abs(dx) <= eps && Math.abs(dy) <= eps) return false;

    const { vPrev, vNext, s } = cone;

    const cross = (ax, ay, bx, by) => ax * by - ay * bx;

    // For s=+1 (CCW): inside or near the cone iff cross(vNext,d) > -eps AND cross(d,vPrev) > -eps
    // Multiply by s for general orientation
    const c1 = s * cross(vNext[0], vNext[1], dx, dy);
    const c2 = s * cross(dx, dy, vPrev[0], vPrev[1]);

    return c1 >= -eps && c2 >= -eps;
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
  // --- DDA iterator without callbacks ---------------------------------

  // Initialize a ray-walk state (no lambdas)
  _beginRayWalk(origin, dir, tMax) {
    const cs = this._cellSize;
    const [x0, y0] = origin;
    const [dx, dy] = dir;

    let cx = this._cellOf(x0);
    let cy = this._cellOf(y0);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    const invDx = dx !== 0 ? 1 / dx : 0;
    const invDy = dy !== 0 ? 1 / dy : 0;

    // First boundary hits from start position
    const tMaxX =
      stepX !== 0
        ? ((stepX > 0 ? (cx + 1) * cs : cx * cs) - x0) * invDx
        : Infinity;

    const tMaxY =
      stepY !== 0
        ? ((stepY > 0 ? (cy + 1) * cs : cy * cs) - y0) * invDy
        : Infinity;

    // Parametric delta per cell
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
  }

  // Advance to the next cell. Mutates state and returns false when done.
  _advanceRayWalk(st) {
    if (st.tEnter > st.tMax) return false;

    // Step by whichever boundary comes first.
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
  }

  // --- Raycast using the iterator -------------------------------------

  // Cast a ray from `origin` at `angle`; return first boundary hit (or the far endpoint).
  _raycast(origin, angle, maxDist = 4e4) {
    const dir = [Math.cos(angle), Math.sin(angle)];
    let bestT = maxDist;

    // visit-stamp to avoid retesting the same edge
    const stamp = (this._stamp = (this._stamp + 1) >>> 0) || (this._stamp = 1);

    const st = this._beginRayWalk(origin, dir, bestT);
    const MAX_ITERS = 1e6; // safety cap

    for (let i = 0; i < MAX_ITERS && st.tEnter <= st.tMax; i++) {
      const key = this._cellKey(st.cx, st.cy);
      const tNext = Math.min(st.tMaxX, st.tMaxY);

      // Process this cell's edges (if any)
      const bucket = this._edgeGrid.get(key);
      if (bucket) {
        for (const edgeId of bucket) {
          if (this._edgeStamp.get(edgeId) === stamp) continue;
          this._edgeStamp.set(edgeId, stamp);

          const ed = this._edgeStore.get(edgeId);
          if (!ed) continue;

          const boxHit = this._rayAABBEntryExit(
            origin,
            dir,
            ed.bbox,
            this._EPS
          );
          if (!boxHit) continue;
          if (boxHit.tEnter >= bestT) continue;

          const t = this._raySegParamT(origin, dir, ed.c, ed.d, this._EPS);
          if (t !== null && t > this._EPS && t < bestT) bestT = t;
        }
      }

      // Early-out: next cell starts after nearest hit -> no farther cell can help
      if (tNext > bestT) break;

      // Keep marching
      if (!this._advanceRayWalk(st)) break;
    }

    return [origin[0] + dir[0] * bestT, origin[1] + dir[1] * bestT];
  }

  // Returns {tEnter, tExit} if the ray O + t*d intersects bbox; otherwise null.
  // Assumes d is normalized (it is in _raycast).
  _rayAABBEntryExit(O, d, bbox, eps = 1e-12) {
    const inv = (v) => (Math.abs(v) <= eps ? Infinity : 1 / v);

    const invDx = inv(d[0]);
    const invDy = inv(d[1]);

    // X slabs
    let t1 = (bbox.minX - O[0]) * invDx;
    let t2 = (bbox.maxX - O[0]) * invDx;
    let tmin = Math.min(t1, t2);
    let tmax = Math.max(t1, t2);

    // Y slabs
    t1 = (bbox.minY - O[1]) * invDy;
    t2 = (bbox.maxY - O[1]) * invDy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    // No overlap or entirely behind the ray origin
    if (!(tmax >= tmin) || tmax < 0) return null;

    const tEnter = Math.max(0, tmin);
    const tExit = tmax;
    return { tEnter, tExit };
  }

  // Return param t (>=0) where O + t*d hits segment C->D, or null if no hit.
  // Handles proper crossings and collinear "slides" by taking the nearest forward endpoint.
  _raySegParamT(O, d, C, D, eps) {
    const ex = D[0] - C[0],
      ey = D[1] - C[1]; // segment direction e
    const cxo = C[0] - O[0],
      cyo = C[1] - O[1]; // C - O

    const denom = cross(d[0], d[1], ex, ey); // cross(d, e)

    // Non-parallel case: solve with 2x2 (Cramer's rule)
    if (Math.abs(denom) > eps) {
      const t = cross(cxo, cyo, ex, ey) / denom; // t = cross(C-O, e)/cross(d,e)
      const u = cross(cxo, cyo, d[0], d[1]) / denom; // u = cross(C-O, d)/cross(d,e)
      if (t >= 0 && u >= -eps && u <= 1 + eps) return t;
      return null;
    }

    // Parallel: check collinearity (ray lies on the line of the segment?)
    const col = Math.abs(cross(cxo, cyo, d[0], d[1])) <= eps;
    if (!col) return null;

    // Project endpoints onto the ray direction and take the nearest forward point.
    const tC = dot(C[0] - O[0], C[1] - O[1], d[0], d[1]); // since |d|=1
    const tD = dot(D[0] - O[0], D[1] - O[1], d[0], d[1]);
    const candidates = [];
    if (tC >= 0) candidates.push(tC);
    if (tD >= 0) candidates.push(tD);
    if (candidates.length === 0) return null;

    // If the ray overlaps the whole segment ahead, choose the nearer endpoint.
    return Math.min(...candidates);
  }

  /**
   * Grid-accelerated visibility check for arbitrary source point → vertex j.
   */
  _visibleFromPointToVertex(P, j) {
    const vertex = this.vertices[j];
    const delta = [P[0] - vertex[0], P[1] - vertex[1]];
    const distance = Math.hypot(delta[0], delta[1]);
    const angle = Math.atan2(delta[1], delta[0]);
    const rayHit = this._vertexRaycast(j, angle);
    const rayDistance = Math.hypot(
      rayHit[0] - vertex[0],
      rayHit[1] - vertex[1]
    );
    return rayDistance >= distance;
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

  _segmentCrossesAnyBoundaryGrid(A, B, eps, skipPolyOwnedBy = null) {
    const edgeGrid = this._edgeGrid;
    const edgeStore = this._edgeStore;
    const polyOwnsVertexIndex = this._polyOwnsVertexIndex.bind(this);
    const ptEq = this._ptEq.bind(this);
    const segSegIntersectKind = this._segSegIntersectKind.bind(this);

    const seenEdge = this._seenEdge;
    seenEdge.clear();

    let hit = false;

    const useSkip = !!skipPolyOwnedBy;
    const skipI = useSkip ? skipPolyOwnedBy.i : 0;
    const skipJ = useSkip ? skipPolyOwnedBy.j : 0;

    this._walkGridCells(A, B, (key) => {
      const bucket = edgeGrid.get(key);
      if (!bucket) return false; // keep walking

      for (const edgeId of bucket) {
        if (seenEdge.has(edgeId)) continue;
        seenEdge.add(edgeId);

        const ed = edgeStore.get(edgeId);
        if (!ed) continue;

        if (useSkip) {
          const ownsI = polyOwnsVertexIndex(ed.polyId, skipI);
          const ownsJ = polyOwnsVertexIndex(ed.polyId, skipJ);
          if (ownsI || ownsJ) continue;
        }

        const touchesA = ptEq(A, ed.c, eps) || ptEq(A, ed.d, eps);
        const touchesB = ptEq(B, ed.c, eps) || ptEq(B, ed.d, eps);
        if (touchesA || touchesB) continue;

        const kind = segSegIntersectKind(A, B, ed.c, ed.d, eps);
        if (kind === "proper") {
          hit = true;
          return true;
        }
        if (kind === "endpoint" || kind === "overlap") {
          const touchingAtOwnEndpoint = touchesA || touchesB;
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

  _segmentBlockedBySpecificPolygon(A, B, ringPoints, ringPolyId, eps) {
    // Use the grid for boundary crossings, but restrict candidates to this polygon's edges.
    if (this._segmentCrossesSpecificBoundaryGrid(A, B, ringPolyId, eps))
      return true;
    // If no boundary hit, interior containment is possible only if midpoint inside the ring
    const mid = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
    return this._pointInPolygonStrict(mid, ringPoints, eps);
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

  _walkGridCells(a, b, visitCell /* (key) => stop? */) {
    const cs = this._cellSize;
    let x0 = a[0],
      y0 = a[1];
    let x1 = b[0],
      y1 = b[1];
    const dx = x1 - x0;
    const dy = y1 - y0;

    let cx = this._cellOf(x0);
    let cy = this._cellOf(y0);
    const cx1 = this._cellOf(x1);
    const cy1 = this._cellOf(y1);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    // Single-cell segment: visit once and return.
    if (cx === cx1 && cy === cy1) {
      if (visitCell(this._cellKey(cx, cy)) === true) return;
      return;
    }

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

    const cellKeyFn = this._cellKey.bind(this);

    // first cell
    if (visitCell(cellKeyFn(cx, cy)) === true) return;

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
      if (visitCell(cellKeyFn(cx, cy)) === true) return;
    }
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
        bbox: this._edgeBBox(c, d),
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
  // Mix (cx, cy) into a single 32-bit key. Works for reasonably bounded grids.
  // If your grid can be very large/negative, switch to a better mixer (see note below).
  _cellKey(cx, cy) {
    // Thomas Wang’s 32-bit mix on each, then combine
    let x = cx | 0,
      y = cy | 0;

    x = x ^ 61 ^ (x >>> 16);
    x = (x + (x << 3)) | 0;
    x = x ^ (x >>> 4);
    x = (x * 0x27d4eb2d) | 0;
    x = x ^ (x >>> 15);

    y = y ^ 61 ^ (y >>> 16);
    y = (y + (y << 3)) | 0;
    y = y ^ (y >>> 4);
    y = (y * 0x27d4eb2d) | 0;
    y = y ^ (y >>> 15);

    // Combine; use a large odd to spread.
    return (x + 0x9e3779b1 + ((y << 6) | 0) + (y >>> 2)) | 0;
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
    if (this.incidentEdgeMapBuilt) return this.incidentEdgeMapBuilt;
    const m = new Map();
    for (let i = 0; i < this.vertices.length; i++) m.set(i, new Set());
    for (let i = 0; i < this.vertices.length; i++) {
      for (const j of this.edges[i]) {
        m.get(i).add(j);
      }
    }
    this.incidentEdgeMapBuilt = m;
    return this.incidentEdgeMapBuilt;
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
}

import { util } from "./util.js";

// This is the first implementation of this algorithm and mostly
// all helper functions were AI generated.
// While those can be cleaned up, 'shineAt' may take advantage
// of strange properties and interactions of the helpers which I myself
// didn't realize. Rewriting shouldn't be super hard but i'll write a
// blog post on how to rewrite it.

export class VisibilityGraph {
  constructor(game, eps = 1e-9, cellSize = 64) {
    this.radius = game.playerRadius;

    this.vertices = []; // [[x,y], ...]
    this.edges = []; // adjacency list: edges[i] = [j, ...]
    this.edgesMeta = [];
    this._polygons = []; // internal: [{indices:[...], points:[[x,y],...], bbox:{minX,maxX,minY,maxY}, id:number}]
    this._EPS = eps;
    this._occluded = new Uint8Array(0); // length mirrors this.vertices.length
    this._seenEdge = new Set();
    this._cellSize = cellSize;
    this._edgeGrid = new Map(); // key -> Set(edgeId)
    this._edgeStore = new Map(); // edgeId -> {c:[x,y], d:[x,y], polyId:number, ei:number}
    this._nextPolyId = 0;
    this._vertexCone = []; // index -> { vPrev:[dx,dy], vNext:[dx,dy], s:+1|-1, w:number }
    this._vertexVisibility = [];
    this._edgeStamp = new Map(); // edgeId(string) -> uint32 stamp
    this._stamp = 1; // monotonically increasing visit id
  }

  pushPolygon(ring) {
    if (!Array.isArray(ring) || ring.length < 3)
      throw new Error("pushPolygon expects a ring of at least 3 points.");

    ring = util.normalizeRing(ring, this._EPS);

    const base = this.vertices.length;
    for (const p of ring) {
      this.vertices.push([p[0], p[1]]);
      this.edges.push([]);
      this.edgesMeta.push([]);
    }

    if (this._occluded.length < this.vertices.length) {
      const next = new Uint8Array(this.vertices.length);
      next.set(this._occluded);
      this._occluded = next;
    }

    const idxs = Array.from({ length: ring.length }, (_, k) => base + k);
    const bbox = util.bboxOf(ring);
    const polyId = this._nextPolyId++;
    this._polygons.push({
      id: polyId,
      indices: idxs.slice(),
      points: ring.map(([x, y]) => [x, y]),
      bbox,
    });

    this._markNewlyOccludedVertices(ring, idxs);
    const s = Math.sign(util.signedArea(ring)) || 1;
    this._computeAndStoreVertexCones(idxs, ring, s);
    this._indexPolygonEdges(polyId, ring);
    this._removeEdgesBlockedByPolygon(idxs, ring, polyId);
    this._connectNewVertices(idxs);
    this._reallowRingSides(idxs);
  }

  shineAt(pos, radius = this.radius) {
    const pointPoly = [];
    const diskPoly = [];
    const visibleIndices = this.visibleIndicesAt(pos);
    if (!visibleIndices.length) return [[], []];

    const visible = visibleIndices.map((index) => {
      const vertex = this.vertices[index];
      const angle = Math.atan2(vertex[1] - pos[1], vertex[0] - pos[0]);
      const { vPrev, vNext } = this._vertexCone[index];
      const criticality = util.checkCriticality(pos, vPrev, vertex, vNext);
      return { index, vertex, angle, criticality };
    });

    visible.sort((a, b) => a.angle - b.angle);

    const toCone = [];

    for (let i = 0; i < visible.length; i++) {
      const a = visible[i];
      const b = visible[(i + 1) % visible.length];
      if (i === visible.length - 1 && b.angle <= a.angle) b.angle += util.TAU;

      const { index, vertex, angle, criticality } = a;
      if (criticality === -1) pointPoly.push(this.vertexRaycast(index, angle));
      pointPoly.push(vertex);
      if (criticality === +1) pointPoly.push(this.vertexRaycast(index, angle));
      if (criticality !== 0) toCone.push(index);

      // cast extra rays to fill polygon
      const delta = b.angle - a.angle;
      if (delta > Math.PI / 2) {
        const angle = a.angle + delta / 2;
        const v = this.raycast(pos, angle);
        pointPoly.push(v);
      }
    }

    pointPoly.push(pointPoly[0]);

    const diskConed = new Set();
    while (toCone.length) {
      const index = toCone.pop();
      if (diskConed.has(index)) continue;
      const { diskCones, diskCascade } = this.diskConesAt(pos, index, radius);
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

  diskConesAt(pos, index, radius) {
    const wrapToPi = util.wrapToPi;
    const vertex = this.vertices[index];
    const delta = [vertex[0] - pos[0], vertex[1] - pos[1]];
    const direction = Math.atan2(delta[1], delta[0]);
    const opDirection = wrapToPi(direction + Math.PI);
    const distance = Math.hypot(delta[0], delta[1]);

    const { aPrev, aNext } = this._vertexCone[index];

    const prevAngleDist = util.minAngleDist(aPrev, direction);
    const nextAngleDist = util.minAngleDist(aNext, direction);
    const minAngle = Math.min(prevAngleDist, nextAngleDist);
    const angleDelta = Math.min(minAngle, Math.asin(radius / distance));

    const relativeStart = opDirection - angleDelta + Math.PI;
    const sweepWidth = 2 * angleDelta;
    const opSweepStart = wrapToPi(opDirection - angleDelta);
    const opSweepEnd = wrapToPi(opDirection + angleDelta);
    const sweepStart = wrapToPi(direction - angleDelta);
    const sweepEnd = wrapToPi(direction + angleDelta);

    const vertexVisibility = this.getVertexVisibility(index);

    // First sweep towards pos to see if any parts are occuded.
    const fullyInCones = [];
    const boundCones = {};

    for (const cone of vertexVisibility) {
      const { curr, next } = cone;
      const currAngle = wrapToPi(curr.angle - relativeStart) + Math.PI;
      const nextAngle = wrapToPi(next.angle - relativeStart) + Math.PI;
      const currInside = 0 <= currAngle && currAngle <= sweepWidth;
      const nextInside = 0 <= nextAngle && nextAngle <= sweepWidth;
      if (!currInside && !nextInside) continue;

      const startAngle = currInside ? curr.angle : opSweepStart;
      const endAngle = nextInside ? next.angle : opSweepEnd;

      const rayAngle =
        startAngle < endAngle
          ? (startAngle + endAngle) / 2
          : (startAngle - 2 * Math.PI + endAngle) / 2;
      const rayHit = this.vertexRaycast(index, rayAngle);
      const rayDist = Math.hypot(rayHit[0] - vertex[0], rayHit[1] - vertex[1]);
      if (rayDist < distance) continue;

      if (currInside && nextInside) fullyInCones.push(cone);
      if (!currInside && nextInside) boundCones.start = cone;
      if (currInside && !nextInside) boundCones.end = cone;
    }

    // Sweep away from pos rooted at vertex to build disk cone
    const diskCones = [];
    const diskCascade = [];

    // No internal segments during the pinhole sweep
    if (!fullyInCones.length && !boundCones.start && !boundCones.end) {
      const rayAngle =
        sweepStart < sweepEnd
          ? (sweepStart + sweepEnd) / 2
          : (sweepStart - 2 * Math.PI + sweepEnd) / 2;
      const rayHit = this.vertexRaycast(index, rayAngle + Math.PI);
      const rayDist = Math.hypot(rayHit[0] - vertex[0], rayHit[1] - vertex[1]);
      if (rayDist <= distance) return { diskCones, diskCascade };

      const { poly, cascade } = this.vertexShineAt(index, sweepStart, sweepEnd);
      if (!poly || !cascade) return { diskCones, diskCascade };

      diskCones.push(poly);
      diskCascade.push(...cascade);
      return { diskCones, diskCascade };
    }

    // There are internal segment which could be adjacent. Fuse them for effeciency
    const fusedSegments = this.fuseVisibilitySegments(fullyInCones, boundCones);

    for (const { curr, next, start, end } of fusedSegments) {
      const shineStart = start ? sweepStart : wrapToPi(curr.angle + Math.PI);
      const shineEnd = end ? sweepEnd : wrapToPi(next.angle + Math.PI);
      const { poly, cascade } = this.vertexShineAt(index, shineStart, shineEnd);
      if (!poly || !cascade) continue;
      diskCones.push(poly);
      diskCascade.push(...cascade);
    }

    return { diskCones, diskCascade };
  }

  fuseVisibilitySegments(fullyInCones, boundCones) {
    let prevLen = -1;
    let pass = fullyInCones;

    while (pass.length !== prevLen) {
      prevLen = pass.length;
      const fusedSegments = [];
      for (const { curr, next } of pass) {
        let added = false;
        for (const fused of fusedSegments) {
          if (next !== fused.curr && curr !== fused.next) continue;
          if (next === fused.curr) fused.curr = curr;
          if (curr === fused.next) fused.next = next;
          added = true;
          break;
        }
        if (!added) fusedSegments.push({ curr, next });
      }
      pass = fusedSegments;
    }

    const fusedSegments = pass;

    if (boundCones.start) {
      const next = boundCones.start.next;
      let added = false;
      for (const fused of fusedSegments) {
        if (added) continue;
        if (next !== fused.curr) continue;
        fused.start = true;
        added = true;
      }
      if (!added) fusedSegments.push({ start: true, next });
    }

    if (boundCones.end) {
      const curr = boundCones.end.curr;
      let added = false;
      for (const fused of fusedSegments) {
        if (added) continue;
        if (curr !== fused.next) continue;
        fused.end = true;
        added = true;
      }
      if (!added) fusedSegments.push({ end: true, curr });
    }

    return fusedSegments;
  }

  vertexShineAt(index, start, end) {
    const { wrapToPi } = util;
    const poly = [this.vertices[index]];
    poly.push(this.vertexRaycast(index, start));

    const safeEnd = start > end ? end + 2 * Math.PI : end;
    const mid = wrapToPi((start + safeEnd) / 2);
    const half = (safeEnd - start) / 2;

    const cascade = [];
    this.edgesMeta[index]
      .filter((a) => Math.abs(wrapToPi(a.angle - mid)) <= half + this._EPS)
      .sort((a, b) => wrapToPi(a.angle - mid) - wrapToPi(b.angle - mid))
      .forEach(({ criticality, index, angle }) => {
        if (criticality === -1) poly.push(this.vertexRaycast(index, angle));
        const startWrap = wrapToPi(angle - start);
        const endWrap = wrapToPi(angle - end);
        if (Math.abs(startWrap) > this._EPS && Math.abs(endWrap) > this._EPS)
          poly.push(this.vertices[index]);
        if (criticality === +1) poly.push(this.vertexRaycast(index, angle));
        if (criticality !== 0) cascade.push(index);
      });

    poly.push(this.vertexRaycast(index, end));
    poly.push(this.vertices[index]);

    // remove duplicates
    let write = 1;
    for (let read = 1; read < poly.length; read++)
      if (!util.ptEq(poly[read], poly[read])) poly[write++] = poly[read];

    poly.length = write; // truncate extra elements
    if (poly.length < 4) return { cascade };
    return { poly, cascade };
  }

  // used when you just want the point poly and not both
  pointPolyAt(pos, visibleIndices = null) {
    const pointPoly = [];
    if (!visibleIndices) visibleIndices = this.visibleIndicesAt(pos);
    if (!visibleIndices.length) return [];

    const visible = visibleIndices.map((index) => {
      const vertex = this.vertices[index];
      const angle = Math.atan2(vertex[1] - pos[1], vertex[0] - pos[0]);
      const { vPrev, vNext } = this._vertexCone[index];
      const criticality = util.checkCriticality(pos, vPrev, vertex, vNext);
      return { index, vertex, angle, criticality };
    });

    visible.sort((a, b) => a.angle - b.angle);

    for (let i = 0; i < visible.length; i++) {
      const a = visible[i];
      const b = visible[(i + 1) % visible.length];
      if (i === visible.length - 1 && b.angle <= a.angle) b.angle += util.TAU;

      const { index, vertex, angle, criticality } = a;
      if (criticality === -1) pointPoly.push(this.vertexRaycast(index, angle));
      pointPoly.push(vertex);
      if (criticality === +1) pointPoly.push(this.vertexRaycast(index, angle));

      const delta = b.angle - a.angle;
      if (delta > Math.PI / 2)
        pointPoly.push(this.raycast(pos, a.angle + delta / 2));
    }

    // Close the polygon if we actually have points
    if (pointPoly.length) pointPoly.push(pointPoly[0]);
    return pointPoly;
  }

  getVertexVisibility(index, maxDist = 4e4) {
    if (this._vertexVisibility[index]) return this._vertexVisibility[index];

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
      const st = util.beginRayWalk(origin, dir, bestT, this._cellSize);
      const MAX_ITERS = 1e6; // safety cap
      for (let i = 0; i < MAX_ITERS && st.tEnter <= st.tMax; i++) {
        const key = util.spatialCellKey(st.cx, st.cy);
        const tNext = Math.min(st.tMaxX, st.tMaxY);

        // Process this cell's edges (if any)
        const bucket = this._edgeGrid.get(key);
        if (bucket) {
          for (const edgeId of bucket) {
            if (this._edgeStamp.get(edgeId) === stamp) continue;
            this._edgeStamp.set(edgeId, stamp);

            const ed = this._edgeStore.get(edgeId);
            if (!ed) continue;

            const boxHit = util.rayAABBEntryExit(
              origin,
              dir,
              ed.bbox,
              this._EPS,
            );
            if (!boxHit) continue;
            if (boxHit.tEnter >= bestT) continue;

            // some how we need to store the ed parameter in the endCap to use later
            const t = util.raySegParamT(origin, dir, ed.c, ed.d, this._EPS);
            if (t !== null && t > this._EPS && t < bestT) {
              bestT = t;
              bestEd = ed;
            }
          }
        }

        if (tNext > bestT) break;
        if (!util.advanceRayWalk(st)) break;
      }

      const cone = { curr, next };
      if (bestEd) cone.endCap = bestEd;
      else cone.endCap = { doesNotHit: true };
      this._vertexVisibility[index].push(cone);
    }

    return this._vertexVisibility[index];
  }

  vertexRaycast(index, angle, maxDist = 4e4) {
    const origin = this.vertices[index];

    const dir = [Math.cos(angle), Math.sin(angle)];
    const directionAt = [origin[0] + dir[0], origin[1] + dir[1]];
    const cone = this._vertexCone[index];
    if (util.dirLooselyInsideInteriorCone(cone, origin, directionAt, this._EPS))
      return origin;

    const vertexVisibility = this.getVertexVisibility(index);

    angle = util.wrapToPi(angle);
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

    const t = util.raySegParamT(origin, dir, endCap.c, endCap.d, this._EPS);
    return [origin[0] + dir[0] * t, origin[1] + dir[1] * t];
  }

  // Cast a ray from `origin` at `angle`; return first boundary hit (or the far endpoint).
  raycast(origin, angle, maxDist = 4e4) {
    const dir = [Math.cos(angle), Math.sin(angle)];
    let bestT = maxDist;
    const stamp = (this._stamp = (this._stamp + 1) >>> 0) || (this._stamp = 1);
    const st = util.beginRayWalk(origin, dir, bestT, this._cellSize);
    const MAX_ITERS = 1e6;

    for (let i = 0; i < MAX_ITERS && st.tEnter <= st.tMax; i++) {
      const key = util.spatialCellKey(st.cx, st.cy);
      const tNext = Math.min(st.tMaxX, st.tMaxY);

      const bucket = this._edgeGrid.get(key);
      if (bucket) {
        for (const edgeId of bucket) {
          if (this._edgeStamp.get(edgeId) === stamp) continue;
          this._edgeStamp.set(edgeId, stamp);

          const ed = this._edgeStore.get(edgeId);
          if (!ed) continue;

          const boxHit = util.rayAABBEntryExit(origin, dir, ed.bbox, this._EPS);
          if (!boxHit) continue;
          if (boxHit.tEnter >= bestT) continue;

          const t = util.raySegParamT(origin, dir, ed.c, ed.d, this._EPS);
          if (t !== null && t > this._EPS && t < bestT) bestT = t;
        }
      }

      if (tNext > bestT) break;
      if (!util.advanceRayWalk(st)) break;
    }

    return [origin[0] + dir[0] * bestT, origin[1] + dir[1] * bestT];
  }

  visibleIndicesAt(pos) {
    const result = [];
    for (let j = 0; j < this.vertices.length; j++) {
      if (this._occluded[j]) continue;
      if (util.ptEq(pos, this.vertices[j], this._EPS)) continue;
      if (this.visibleFromPointToVertex(pos, j)) result.push(j);
    }
    return result;
  }

  visibleFromPointToVertex(P, j) {
    const vertex = this.vertices[j];
    const dx = P[0] - vertex[0];
    const dy = P[1] - vertex[1];
    const distanceSq = dx * dx + dy * dy;
    const angle = Math.atan2(dy, dx);
    const rayHit = this.vertexRaycast(j, angle);
    const rdx = rayHit[0] - vertex[0];
    const rdy = rayHit[1] - vertex[1];
    const rayDistanceSq = rdx * rdx + rdy * rdy;
    return rayDistanceSq >= distanceSq;
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
    const bAngle = util.wrapToPi(aAngle + Math.PI);
    const distance = Math.hypot(delta[0], delta[1]);

    const aCone = this._vertexCone[i];
    const bCone = this._vertexCone[j];
    const aCrit = util.checkCriticality(va, bCone.vPrev, vb, bCone.vNext);
    const bCrit = util.checkCriticality(vb, aCone.vPrev, va, aCone.vNext);
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
      if (bothOnNew && util.areRingAdjacent(newIdxs, i, j)) continue;
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
    const N = this.vertices.length;
    const newSet = new Set(newIdxs);

    const activeNew = [];
    for (const i of newIdxs) if (!this._occluded[i]) activeNew.push(i);

    if (activeNew.length === 0) return;

    const incident = this._buildIncidentEdgeMap();
    for (const i of activeNew)
      for (let j = 0; j < N; j++) {
        if (j === i || newSet.has(j)) continue; // only connect to OLD vertices
        if (this._occluded[j]) continue; // skip permanently occluded olds
        if (this._visibleViaGrid(i, j, incident, this._EPS))
          this._addEdge(i, j);
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
      if (util.segmentsProperlyIntersect(A, B, U, V, eps)) return true;
    }
    return false;
  }

  // Pre: ring is CCW when s = +1, CW when s = -1
  _computeAndStoreVertexCones(idxs, ring, s) {
    const cones = util.computeVertexCones(ring, s);
    for (let k = 0; k < ring.length; k++) this._vertexCone[idxs[k]] = cones[k];
  }

  _markNewlyOccludedVertices(ring, newIdxs) {
    const eps = this._EPS;
    const newSet = new Set(newIdxs);

    const bbNew = util.bboxOf(ring);
    for (let j = 0; j < this.vertices.length; j++) {
      const P = this.vertices[j];
      if (newSet.has(j)) continue; // only consider OLD vertices here
      if (this._occluded[j]) continue; // already permanently occluded
      if (P[0] < bbNew.minX - eps) continue;
      if (P[0] > bbNew.maxX + eps) continue;
      if (P[1] < bbNew.minY - eps) continue;
      if (P[1] > bbNew.maxY + eps) continue;
      // Strict interior (boundary is *not* occluded)
      if (util.pointInPolygonStrict(P, ring, eps)) this._occluded[j] = 1;
    }

    if (this._polygons.length > 0) {
      for (const vi of newIdxs) {
        if (this._occluded[vi]) continue; // already marked in pass 1 (rare), or earlier
        const P = this.vertices[vi];
        for (const poly of this._polygons) {
          const bb = poly.bbox;
          if (P[0] < bb.minX - eps) continue;
          if (P[0] > bb.maxX + eps) continue;
          if (P[1] < bb.minY - eps) continue;
          if (P[1] > bb.maxY + eps) continue;
          if (!util.pointInPolygonStrict(P, poly.points, eps)) continue;

          this._occluded[vi] = 1;
          break; // no need to check other polygons
        }
      }
    }
  }

  _visibleViaGrid(i, j, incidentOrNull, eps, skipPolyOwningEndpoints = false) {
    const ACone = this._vertexCone[i];
    const BCone = this._vertexCone[j];
    const A = this.vertices[i];
    const B = this.vertices[j];
    if (util.dirStrictlyInsideInteriorCone(ACone, A, B, eps)) return false;
    if (util.dirStrictlyInsideInteriorCone(BCone, B, A, eps)) return false;

    const ignore = { A: new Set([i]), B: new Set([j]) };
    if (incidentOrNull) {
      for (const n of incidentOrNull.get(i) || []) ignore.A.add(n);
      for (const n of incidentOrNull.get(j) || []) ignore.B.add(n);
    }

    const skipOwnedBy = skipPolyOwningEndpoints ? { i, j } : null;
    const crosses = this._segmentCrossesAnyBoundaryGrid(A, B, eps, skipOwnedBy);
    if (crosses) return false;

    const mid = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
    for (const poly of this._polygons) {
      const bb = poly.bbox;
      if (mid[0] < bb.minX - eps) continue;
      if (mid[0] > bb.maxX + eps) continue;
      if (mid[1] < bb.minY - eps) continue;
      if (mid[1] > bb.maxY + eps) continue;

      if (util.pointInPolygonStrict(mid, poly.points, eps)) return false;
    }
    return true;
  }

  _segmentCrossesAnyBoundaryGrid(A, B, eps, skipPolyOwnedBy = null) {
    this._seenEdge.clear();

    let hit = false;
    const useSkip = !!skipPolyOwnedBy;
    const skipI = useSkip ? skipPolyOwnedBy.i : 0;
    const skipJ = useSkip ? skipPolyOwnedBy.j : 0;

    util.walkGridCells(A, B, this._cellSize, (key) => {
      const bucket = this._edgeGrid.get(key);
      if (!bucket) return false; // keep walking

      for (const edgeId of bucket) {
        if (this._seenEdge.has(edgeId)) continue;
        this._seenEdge.add(edgeId);

        const ed = this._edgeStore.get(edgeId);
        if (!ed) continue;

        if (useSkip) {
          const ownsI = this._polyOwnsVertexIndex(ed.polyId, skipI);
          const ownsJ = this._polyOwnsVertexIndex(ed.polyId, skipJ);
          if (ownsI || ownsJ) continue;
        }

        const touchesA = util.ptEq(A, ed.c, eps) || util.ptEq(A, ed.d, eps);
        const touchesB = util.ptEq(B, ed.c, eps) || util.ptEq(B, ed.d, eps);
        if (touchesA || touchesB) continue;

        const kind = util.segSegIntersectKind(A, B, ed.c, ed.d, eps);
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
    if (this._segmentCrossesSpecificBoundaryGrid(A, B, ringPolyId, eps))
      return true;
    const mid = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
    return util.pointInPolygonStrict(mid, ringPoints, eps);
  }

  _segmentCrossesSpecificBoundaryGrid(A, B, polyId, eps) {
    const seenEdge = new Set();
    let hit = false;

    util.walkGridCells(A, B, this._cellSize, (key) => {
      const bucket = this._edgeGrid.get(key);
      if (!bucket) return false;
      for (const edgeId of bucket) {
        const ed = this._edgeStore.get(edgeId);
        if (!ed || ed.polyId !== polyId) continue;
        if (seenEdge.has(edgeId)) continue;
        seenEdge.add(edgeId);

        const kind = util.segSegIntersectKind(A, B, ed.c, ed.d, eps);
        if (kind === "proper") {
          hit = true;
          return true;
        }
        if (kind === "endpoint" || kind === "overlap") {
          // if it's exactly touching at A/B we allow; otherwise block
          const touchingAtOwnEndpoint =
            util.ptEq(A, ed.c, eps) ||
            util.ptEq(A, ed.d, eps) ||
            util.ptEq(B, ed.c, eps) ||
            util.ptEq(B, ed.d, eps);
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
        bbox: util.edgeBBox(c, d),
      });
      this._rasterizeEdgeIntoGrid(edgeId, c, d);
    }
  }

  _rasterizeEdgeIntoGrid(edgeId, a, b) {
    // DDA across grid cells the edge passes through
    const add = (cx, cy) => {
      const key = util.spatialCellKey(cx, cy);
      let bucket = this._edgeGrid.get(key);
      if (!bucket) {
        bucket = new Set();
        this._edgeGrid.set(key, bucket);
      }
      bucket.add(edgeId);
    };

    // Handle degenerate tiny segments
    if (util.ptEq(a, b, this._EPS))
      return add(
        Math.floor(a[0] / this._cellSize),
        Math.floor(a[1] / this._cellSize),
      );

    // Amanatides & Woo style grid traversal
    const cs = this._cellSize;
    let x0 = a[0];
    let y0 = a[1];
    let x1 = b[0];
    let y1 = b[1];
    const dx = x1 - x0;
    const dy = y1 - y0;

    let cx = Math.floor(x0 / this._cellSize);
    let cy = Math.floor(y0 / this._cellSize);
    const cx1 = Math.floor(x1 / this._cellSize);
    const cy1 = Math.floor(y1 / this._cellSize);

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

  _polyOwnsVertexIndex(polyId, vi) {
    const p = this._polygons.find((p) => p.id === polyId);
    if (!p) return false;
    return p.indices.includes(vi);
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
}

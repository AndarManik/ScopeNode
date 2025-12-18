/**
 * Build a lazy all-pairs shortest path query over a weighted graph.
 * Weights default to Euclidean distance between vertex coordinates.
 *
 * @param {{ vertices: Array<[number,number]>, edges: number[][] }} graph
 * @param {(uIdx:number, vIdx:number, u:[number,number], v:[number,number])=>number} [weightFn]
 * @returns {(source:number, target:number)=>{distance:number, path:Array<[number,number]>}}
 *
 * Conventions:
 * - edges[i] is a list of neighbor indices for vertex i (directed or undirected).
 * - If (source===target), distance = 0 and path = [vertices[source]].
 * - If unreachable, distance = Infinity and path = [].
 * - Returns paths as a list of vertex *coordinates* (not indices).
 */
export function makeLazyAPSP(graph, weightFn) {
  const { vertices, edges } = graph;
  const n = vertices.length;

  if (!Array.isArray(vertices) || !Array.isArray(edges) || edges.length !== n) {
    throw new Error("Invalid graph: vertices/edges mismatch.");
  }

  // Default weight: Euclidean distance between coordinates
  const w = typeof weightFn === "function"
    ? weightFn
    : (uIdx, vIdx, u, v) => {
        const dx = u[0] - v[0];
        const dy = u[1] - v[1];
        return Math.hypot(dx, dy);
      };

  // Cache: source -> { dist: Float64Array, prev: Int32Array }
  const cache = new Map();

  // Minimal binary heap for Dijkstra
  class MinHeap {
    constructor() { this.a = []; }
    size() { return this.a.length; }
    push(item) {
      this.a.push(item);
      this._siftUp(this.a.length - 1);
    }
    pop() {
      if (this.a.length === 0) return undefined;
      const top = this.a[0];
      const last = this.a.pop();
      if (this.a.length) {
        this.a[0] = last;
        this._siftDown(0);
      }
      return top;
    }
    _siftUp(i) {
      const a = this.a;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].key <= a[i].key) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    _siftDown(i) {
      const a = this.a;
      const n = a.length;
      while (true) {
        let l = i * 2 + 1, r = l + 1, s = i;
        if (l < n && a[l].key < a[s].key) s = l;
        if (r < n && a[r].key < a[s].key) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
  }

  function dijkstraFrom(source) {
    const dist = new Float64Array(n);
    const prev = new Int32Array(n);
    for (let i = 0; i < n; i++) { dist[i] = Infinity; prev[i] = -1; }

    dist[source] = 0;
    const pq = new MinHeap();
    pq.push({ key: 0, v: source });

    while (pq.size() > 0) {
      const { key: d, v: uIdx } = pq.pop();
      if (d !== dist[uIdx]) continue; // stale entry
      const u = vertices[uIdx];

      const nbrs = edges[uIdx] || [];
      for (let k = 0; k < nbrs.length; k++) {
        const vIdx = nbrs[k];
        if (vIdx < 0 || vIdx >= n) continue; // ignore invalid neighbor indices
        const v = vertices[vIdx];
        const wt = w(uIdx, vIdx, u, v);
        if (wt < 0) throw new Error("Negative edge weight encountered; Dijkstra requires nonnegative weights.");
        const alt = d + wt;
        if (alt < dist[vIdx]) {
          dist[vIdx] = alt;
          prev[vIdx] = uIdx;
          pq.push({ key: alt, v: vIdx });
        }
      }
    }

    cache.set(source, { dist, prev });
    return { dist, prev };
  }

  function reconstructPath(prev, source, target) {
    if (source === target) return [vertices[source]];
    const pathIdx = [];
    for (let v = target; v !== -1; v = prev[v]) pathIdx.push(v);
    if (pathIdx[pathIdx.length - 1] !== source) return []; // unreachable
    pathIdx.reverse();
    return pathIdx.map(i => vertices[i]);
  }

  return function query(source, target) {
    // Basic validations
    if (!Number.isInteger(source) || !Number.isInteger(target) ||
        source < 0 || target < 0 || source >= n || target >= n) {
      throw new Error("source/target out of range.");
    }

    if (source === target) {
      return { distance: 0, path: [vertices[source]] };
    }

    const entry = cache.get(source) || dijkstraFrom(source);
    const { dist, prev } = entry;
    const distance = dist[target];
    if (!Number.isFinite(distance)) return { distance: Infinity, path: [] };

    const path = reconstructPath(prev, source, target);
    return { distance, path };
  };
}

// ────────────────────────────
// Example usage:
/*
const graph = {
  vertices: [
    [0,0],   // 0
    [1,0],   // 1
    [2,0],   // 2
    [2,1],   // 3
  ],
  edges: [
    [1],     // 0 -> 1
    [0,2],   // 1 -> 0,2
    [1,3],   // 2 -> 1,3
    []       // 3
  ]
};

const apsp = buildLazyAPSP(graph); // Euclidean default
console.log(apsp(0,3));
// { distance: ~3.0, path: [ [0,0], [1,0], [2,0], [2,1] ] }

const apspManhattan = buildLazyAPSP(graph, (uIdx, vIdx, [ux,uy],[vx,vy]) => Math.abs(ux-vx)+Math.abs(uy-vy));
console.log(apspManhattan(0,3));
// { distance: 3, path: [ [0,0], [1,0], [2,0], [2,1] ] }
*/

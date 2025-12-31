export const packState = (uuidToInt, uuid, state) => {
  const intid = uuidToInt[uuid];
  if (intid < 0 || intid > 255)
    throw new Error("intid not integer in [0, 255]");

  const [startTick, endTick] = state.tick;
  const [x, y] = state.position;
  const vector = state.vector || [];

  // ticks are int32 now
  if (!Number.isInteger(startTick) || !Number.isInteger(endTick))
    throw new Error("tick must be [int32, int32]");
  // optional: clamp/validate int32 range
  if (startTick < -2147483648 || startTick > 2147483647)
    throw new Error("startTick out of int32 range");
  if (endTick < -2147483648 || endTick > 2147483647)
    throw new Error("endTick out of int32 range");

  const vectorLength = vector.length;
  if (vectorLength < 0) throw new Error("vector length must be >= 0");
  if (vectorLength > 9) throw new Error("vector length must be <= 9");

  // ---- light normalization / validation ----
  // Expected: [poly0, polys]
  // poly0: [ [x,y], ... ]
  // polys: [ poly1, poly2, ... ] (may be empty)
  const light = state.light ?? [[], []];
  if (!Array.isArray(light) || light.length !== 2)
    throw new Error("light must be [poly, [polys...]]");

  const poly0 = Array.isArray(light[0]) ? light[0] : null;
  const polys = Array.isArray(light[1]) ? light[1] : null;
  if (!poly0 || !polys) throw new Error("light must be [poly, [polys...]]");

  const poly0PointCount = poly0.length >>> 0;
  const polysCount = polys.length >>> 0;

  // Count points to size buffer; also validate numeric types.
  let lightPointTotal = 0;

  // validate poly0
  for (let i = 0; i < poly0.length; i++) {
    const p = poly0[i];
    if (!Array.isArray(p) || p.length !== 2)
      throw new Error("light poly0 point must be [x,y]");
    const px = Number(p[0]);
    const py = Number(p[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py))
      throw new Error("light poly0 point coords must be finite numbers");
  }
  lightPointTotal += poly0.length;

  // validate polys
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    if (!Array.isArray(poly))
      throw new Error("light polys must be an array of polys");
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j];
      if (!Array.isArray(p) || p.length !== 2)
        throw new Error("light inner poly point must be [x,y]");
      const px = Number(p[0]);
      const py = Number(p[1]);
      if (!Number.isFinite(px) || !Number.isFinite(py))
        throw new Error("light inner poly point coords must be finite numbers");
    }
    lightPointTotal += poly.length;
  }

  // ---- path normalization / validation ----
  // Expected: [ [x,y], ... ] where x,y are float32 (JS numbers)
  const path = state.path ?? [];
  if (!Array.isArray(path)) throw new Error("path must be an array of points");

  const pathPointCount = path.length >>> 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!Array.isArray(p) || p.length !== 2)
      throw new Error("path point must be [x,y]");
    const px = Number(p[0]);
    const py = Number(p[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py))
      throw new Error("path point coords must be finite numbers");
  }

  // ---- sizing ----
  // per-vector entry: uuidInt (uint8) + tick (int32)
  const entrySize = 1 + 4;

  // intid + startTick(i32) + endTick(i32) + x(f32) + y(f32) + vectorLength(u8)
  const headerSize = 1 + 4 + 4 + 4 + 4 + 1;

  // light encoding size:
  // lightOuterCount (u32) +
  // poly0PointCount (u32) + poly0 points (N * 8) +
  // polysCount (u32) +
  // each poly: polyPointCount (u32) + points (M * 8)
  //
  // Total u32 counts:
  // 1 (outerCount) + 1 (poly0Count) + 1 (polysCount) + polysCount*(1 each poly count)
  const lightU32Count = 3 + polysCount;
  const lightSize = lightU32Count * 4 + lightPointTotal * 8;

  // path encoding size:
  // pathPointCount (u32) + points (N * 8)
  const pathSize = 4 + pathPointCount * 8;

  const buffer = new ArrayBuffer(
    headerSize + lightSize + pathSize + vectorLength * entrySize
  );
  const view = new DataView(buffer);

  let offset = 0;

  // main intid
  view.setUint8(offset++, intid);

  // ticks (int32)
  view.setInt32(offset, startTick | 0, true);
  offset += 4;
  view.setInt32(offset, endTick | 0, true);
  offset += 4;

  // position (float32)
  view.setFloat32(offset, x, true);
  offset += 4;
  view.setFloat32(offset, y, true);
  offset += 4;

  // vector length
  view.setUint8(offset++, vectorLength);

  // ---- light payload ----
  // outer count is always 2 because light is [poly0, polys]
  view.setUint32(offset, 2, true);
  offset += 4;

  // poly0
  view.setUint32(offset, poly0PointCount, true);
  offset += 4;
  for (let i = 0; i < poly0.length; i++) {
    const p = poly0[i];
    view.setFloat32(offset, Number(p[0]), true);
    offset += 4;
    view.setFloat32(offset, Number(p[1]), true);
    offset += 4;
  }

  // polys
  view.setUint32(offset, polysCount, true);
  offset += 4;
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    view.setUint32(offset, poly.length >>> 0, true);
    offset += 4;
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j];
      view.setFloat32(offset, Number(p[0]), true);
      offset += 4;
      view.setFloat32(offset, Number(p[1]), true);
      offset += 4;
    }
  }

  // ---- path payload ----
  view.setUint32(offset, pathPointCount, true);
  offset += 4;
  for (let i = 0; i < pathPointCount; i++) {
    const p = path[i];
    view.setFloat32(offset, Number(p[0]), true);
    offset += 4;
    view.setFloat32(offset, Number(p[1]), true);
    offset += 4;
  }

  // ---- vector entries ----
  for (let i = 0; i < vectorLength; i++) {
    const vIntid = uuidToInt[vector[i][0]];
    const vTick = vector[i][1];

    if (!Number.isInteger(vIntid) || vIntid < 0 || vIntid > 255)
      throw new Error("vector intid must be an integer in [0, 255]");

    if (!Number.isInteger(vTick)) throw new Error("vector tick must be int32");
    if (vTick < -2147483648 || vTick > 2147483647)
      throw new Error("vector tick out of int32 range");

    view.setUint8(offset++, vIntid);
    view.setInt32(offset, vTick | 0, true);
    offset += 4;
  }

  const compressed = compress(buffer);

  return compressed;
};

export const unpackState = (intToUUID, buffer) => {
  const view = new DataView(decompress(buffer));
  let offset = 0;

  // main uuid
  const uuid = intToUUID[view.getUint8(offset++)];

  // ticks (int32)
  const startTick = view.getInt32(offset, true);
  offset += 4;
  const endTick = view.getInt32(offset, true);
  offset += 4;

  // position (float32)
  const x = view.getFloat32(offset, true);
  offset += 4;
  const y = view.getFloat32(offset, true);
  offset += 4;

  // vector length
  const vectorLength = view.getUint8(offset++);
  if (vectorLength < 0) throw new Error("vector length must be >= 0");
  if (vectorLength > 9) throw new Error("vector length must be <= 9");

  // ---- light payload ----
  const lightOuterCount = view.getUint32(offset, true);
  offset += 4;
  if (lightOuterCount !== 2) throw new Error("light outer count must be 2");

  // poly0
  const poly0PointCount = view.getUint32(offset, true);
  offset += 4;
  const poly0 = new Array(poly0PointCount);
  for (let i = 0; i < poly0PointCount; i++) {
    const px = view.getFloat32(offset, true);
    offset += 4;
    const py = view.getFloat32(offset, true);
    offset += 4;
    poly0[i] = [px, py];
  }

  // polys
  const polysCount = view.getUint32(offset, true);
  offset += 4;
  const polys = new Array(polysCount);
  for (let i = 0; i < polysCount; i++) {
    const pointCount = view.getUint32(offset, true);
    offset += 4;
    const poly = new Array(pointCount);
    for (let j = 0; j < pointCount; j++) {
      const px = view.getFloat32(offset, true);
      offset += 4;
      const py = view.getFloat32(offset, true);
      offset += 4;
      poly[j] = [px, py];
    }
    polys[i] = poly;
  }

  const light = [poly0, polys];

  // ---- path payload ----
  const pathPointCount = view.getUint32(offset, true);
  offset += 4;
  const path = new Array(pathPointCount);
  for (let i = 0; i < pathPointCount; i++) {
    const px = view.getFloat32(offset, true);
    offset += 4;
    const py = view.getFloat32(offset, true);
    offset += 4;
    path[i] = [px, py];
  }

  // ---- vector entries ----
  const vector = [];
  for (let i = 0; i < vectorLength; i++) {
    const vUuid = intToUUID[view.getUint8(offset++)];
    const vTick = view.getInt32(offset, true);
    offset += 4;
    vector.push([vUuid, vTick]);
  }

  return {
    uuid,
    state: {
      tick: [startTick, endTick],
      position: [x, y],
      vector,
      light,
      path,
    },
  };
};

// ---------------------------------------------------------------------------
// Obstacle packing (index is int32, may be -1)
// ---------------------------------------------------------------------------

export const packObstacle = (obstacle) => {
  if (!obstacle || typeof obstacle !== "object")
    throw new Error("obstacle must be an object");

  const pos = obstacle.position;
  if (!Array.isArray(pos) || pos.length !== 2)
    throw new Error("obstacle.position must be [x,y]");

  const x = Number(pos[0]);
  const y = Number(pos[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error("obstacle.position coords must be finite numbers");

  const angle = Number(obstacle.angle);
  const alpha = Number(obstacle.alpha);
  if (!Number.isFinite(angle)) throw new Error("obstacle.angle must be finite");
  if (!Number.isFinite(alpha)) throw new Error("obstacle.alpha must be finite");

  const index = obstacle.index;
  if (!Number.isInteger(index))
    throw new Error("obstacle.index must be an integer");
  if (index < -2147483648 || index > 2147483647)
    throw new Error("obstacle.index out of int32 range");

  const buffer = new ArrayBuffer(28);
  const view = new DataView(buffer);
  let offset = 0;

  view.setFloat32(offset, x, true);
  offset += 4;
  view.setFloat32(offset, y, true);
  offset += 4;

  view.setFloat64(offset, angle, true);
  offset += 8;
  view.setFloat64(offset, alpha, true);
  offset += 8;

  // int32 index (allows -1)
  view.setInt32(offset, index | 0, true);
  offset += 4;

  return compress(buffer);
};

export const unpackObstacle = (buffer) => {
  const view = new DataView(decompress(buffer));
  if (view.byteLength !== 28) return;

  let offset = 0;

  const x = view.getFloat32(offset, true);
  offset += 4;
  const y = view.getFloat32(offset, true);
  offset += 4;

  const angle = view.getFloat64(offset, true);
  offset += 8;
  const alpha = view.getFloat64(offset, true);
  offset += 8;

  // int32 index (may be -1)
  const index = view.getInt32(offset, true);
  offset += 4;

  return {
    position: [x, y],
    angle,
    alpha,
    index,
  };
};

// ---------------------------------------------------------------------------
// Synchronous LZ4-like compressor for ArrayBuffer <-> Uint8Array
// Header format (little-endian):
//   0..3  : magic "SNZ1" (0x53 0x4E 0x5A 0x31)
//   4..7  : uncompressed byteLength (u32)
//   8..11 : compressed payload byteLength (u32)
//   12..  : compressed payload
// ---------------------------------------------------------------------------

const SNZ_MAGIC = 0x315a4e53; // "SNZ1" little-endian bytes: 53 4E 5A 31

function _u32LE_get(u8, o) {
  return (
    (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0
  );
}
function _u32LE_set(u8, o, v) {
  u8[o] = v & 255;
  u8[o + 1] = (v >>> 8) & 255;
  u8[o + 2] = (v >>> 16) & 255;
  u8[o + 3] = (v >>> 24) & 255;
}

function _growU8(out, needed) {
  if (out.length >= needed) return out;
  let n = out.length;
  while (n < needed) n = (n * 2) | 0;
  const next = new Uint8Array(n);
  next.set(out);
  return next;
}

// LZ4-style constants
const MIN_MATCH = 4;
const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;
const MAX_OFFSET = 0xffff; // 64KB window

function _hash4(a, i) {
  // read 4 bytes little-ish, multiply by prime, take top bits
  const v =
    (a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24)) >>> 0;
  // Knuth-ish multiplicative hash
  return ((v * 2654435761) >>> (32 - HASH_BITS)) & (HASH_SIZE - 1);
}

function _readU16LE(a, i) {
  return a[i] | (a[i + 1] << 8);
}
function _writeU16LE(out, o, v) {
  out[o] = v & 255;
  out[o + 1] = (v >>> 8) & 255;
}

// ---------------------------------------------------------------------------
// compress(ArrayBuffer | Uint8Array) -> Uint8Array (with header)
// ---------------------------------------------------------------------------
export function compress(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const srcLen = src.length >>> 0;

  // For very small payloads, compression can expand; still produce valid output.
  // Preallocate output ~ srcLen + srcLen/255 + 16 (typical LZ4 worst-ish).
  let out = new Uint8Array((srcLen + ((srcLen / 255) | 0) + 32) | 0);
  let op = 12; // reserve header

  const dict = new Int32Array(HASH_SIZE);
  dict.fill(-1);

  let anchor = 0;
  let i = 0;

  const lastLiteralsStart = srcLen - MIN_MATCH;

  while (i <= lastLiteralsStart) {
    const h = _hash4(src, i);
    const ref = dict[h];
    dict[h] = i;

    // Check candidate match
    if (ref >= 0 && i - ref <= MAX_OFFSET) {
      // quick compare 4 bytes
      if (
        src[ref] === src[i] &&
        src[ref + 1] === src[i + 1] &&
        src[ref + 2] === src[i + 2] &&
        src[ref + 3] === src[i + 3]
      ) {
        // Extend match backwards a little (optional); keep simple & safe
        // Emit token: [litLenNibble | matchLenNibble]
        const litLen = (i - anchor) >>> 0;

        // Find full match length
        let matchLen = MIN_MATCH;
        const srcEnd = srcLen;
        while (
          i + matchLen < srcEnd &&
          src[ref + matchLen] === src[i + matchLen]
        ) {
          matchLen++;
        }

        // Ensure output capacity: token + litlen ext + literals + offset(2) + matchlen ext
        // pessimistic add: literals + 1 + 8 + 2 + 8
        out = _growU8(out, op + litLen + 1 + 16 + 2 + 16);

        // Write token placeholder
        const tokenPos = op++;
        let token = 0;

        // Literal length encoding
        if (litLen < 15) {
          token |= litLen << 4;
        } else {
          token |= 15 << 4;
          let n = litLen - 15;
          while (n >= 255) {
            out[op++] = 255;
            n -= 255;
          }
          out[op++] = n;
        }

        // Copy literals
        for (let k = anchor; k < i; k++) out[op++] = src[k];

        // Offset
        const off = (i - ref) >>> 0;
        _writeU16LE(out, op, off);
        op += 2;

        // Match length encoding (stored as matchLen - 4)
        const ml = (matchLen - MIN_MATCH) >>> 0;
        if (ml < 15) {
          token |= ml;
        } else {
          token |= 15;
          let n = ml - 15;
          while (n >= 255) {
            out[op++] = 255;
            n -= 255;
          }
          out[op++] = n;
        }

        out[tokenPos] = token;

        // Move forward
        i += matchLen;
        anchor = i;

        // Update dictionary for positions we skipped (helps compression a bit)
        // Keep it cheap: add a couple of hashes inside the match.
        if (i <= lastLiteralsStart) {
          const t1 = i - 2;
          if (t1 >= 0 && t1 <= lastLiteralsStart) dict[_hash4(src, t1)] = t1;
          const t2 = i - 1;
          if (t2 >= 0 && t2 <= lastLiteralsStart) dict[_hash4(src, t2)] = t2;
        }
        continue;
      }
    }

    i++;
  }

  // Emit last literals
  const lastLitLen = (srcLen - anchor) >>> 0;
  out = _growU8(out, op + 1 + lastLitLen + 16);

  // Token: literals only, match len = 0
  const tokenPos = op++;
  let token = 0;

  if (lastLitLen < 15) {
    token |= lastLitLen << 4;
  } else {
    token |= 15 << 4;
    let n = lastLitLen - 15;
    while (n >= 255) {
      out[op++] = 255;
      n -= 255;
    }
    out[op++] = n;
  }

  for (let k = anchor; k < srcLen; k++) out[op++] = src[k];
  out[tokenPos] = token;

  const payloadLen = (op - 12) >>> 0;

  // Write header
  _u32LE_set(out, 0, SNZ_MAGIC);
  _u32LE_set(out, 4, srcLen);
  _u32LE_set(out, 8, payloadLen);

  return out.subarray(0, op);
}

// ---------------------------------------------------------------------------
// decompress(Uint8Array | ArrayBuffer) -> ArrayBuffer (original bytes)
// ---------------------------------------------------------------------------
export function decompress(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (src.length < 12) throw new Error("SNZ: buffer too small");

  const magic = _u32LE_get(src, 0);
  if (magic !== SNZ_MAGIC) throw new Error("SNZ: bad magic");

  const outLen = _u32LE_get(src, 4);
  const payloadLen = _u32LE_get(src, 8);
  if (12 + payloadLen > src.length) throw new Error("SNZ: truncated payload");

  const out = new Uint8Array(outLen);
  let ip = 12;
  const ipEnd = 12 + payloadLen;
  let op = 0;

  while (ip < ipEnd) {
    const token = src[ip++];

    // literals
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b;
      do {
        if (ip >= ipEnd) throw new Error("SNZ: literal length overrun");
        b = src[ip++];
        litLen += b;
      } while (b === 255);
    }

    if (op + litLen > outLen) throw new Error("SNZ: output overrun (literals)");
    if (ip + litLen > ipEnd) throw new Error("SNZ: input overrun (literals)");

    // copy literals
    out.set(src.subarray(ip, ip + litLen), op);
    ip += litLen;
    op += litLen;

    // If we consumed all payload, we are done (last block has no match).
    if (ip >= ipEnd) break;

    // offset
    if (ip + 2 > ipEnd) throw new Error("SNZ: input overrun (offset)");
    const off = _readU16LE(src, ip);
    ip += 2;
    if (off === 0 || off > op) throw new Error("SNZ: invalid offset");

    // match length
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b;
      do {
        if (ip >= ipEnd) throw new Error("SNZ: match length overrun");
        b = src[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += MIN_MATCH;

    if (op + matchLen > outLen) throw new Error("SNZ: output overrun (match)");

    // copy match (handles overlap)
    let ref = op - off;
    for (let n = 0; n < matchLen; n++) out[op++] = out[ref++];

    if (op === outLen) break;
  }

  if (op !== outLen) throw new Error("SNZ: decompressed length mismatch");
  return out.buffer;
}

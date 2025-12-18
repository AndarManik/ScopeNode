export const pack = (uuidToInt, uuid, state) => {
  const intid = uuidToInt[uuid];
  if (intid < 0 || intid > 255)
    throw new Error("intid not integer in [0, 255]");

  const [startTick, endTick] = state.tick;
  const [x, y] = state.position;
  const vector = state.vector || [];

  // pack isClicking as a single byte: 0/1
  const isClicking = state.isClicking ? 1 : 0;

  const vectorLength = vector.length;
  if (vectorLength < 1) throw new Error("vector length must be between >=1");
  if (vectorLength > 9) throw new Error("vector length must be <= 9 ");

  const entrySize = 1 + 8; // intid (uint8) + tick (float64)

  // intid + start + end + x + y + isClicking + vectorLength
  const headerSize = 1 + 8 + 8 + 8 + 8 + 1 + 1;

  const buffer = new ArrayBuffer(headerSize + vectorLength * entrySize);
  const view = new DataView(buffer);

  let offset = 0;

  // main intid
  view.setUint8(offset++, intid);

  // ticks
  view.setFloat64(offset, startTick, true);
  offset += 8;
  view.setFloat64(offset, endTick, true);
  offset += 8;

  // position
  view.setFloat64(offset, x, true);
  offset += 8;
  view.setFloat64(offset, y, true);
  offset += 8;

  // isClicking
  view.setUint8(offset++, isClicking);

  // vector length
  view.setUint8(offset++, vectorLength);

  // vector entries: [uuidInt, tick]
  for (let i = 0; i < vectorLength; i++) {
    const vIntid = uuidToInt[vector[i][0]];
    const vTick = vector[i][1];

    if (vIntid < 0 || vIntid > 255 || !Number.isInteger(vIntid))
      throw new Error("vector intid must be an integer in [0, 255]");

    view.setUint8(offset++, vIntid);
    view.setFloat64(offset, vTick, true);
    offset += 8;
  }

  return buffer;
};

export const unpack = (intToUUID, buffer) => {
  const view = new DataView(buffer);
  let offset = 0;

  // main uuid
  const uuid = intToUUID[view.getUint8(offset++)];

  // ticks
  const startTick = view.getFloat64(offset, true);
  offset += 8;
  const endTick = view.getFloat64(offset, true);
  offset += 8;

  // position
  const x = view.getFloat64(offset, true);
  offset += 8;
  const y = view.getFloat64(offset, true);
  offset += 8;

  // isClicking
  const isClicking = view.getUint8(offset++) === 1;

  // vector length
  const vectorLength = view.getUint8(offset++);
  if (vectorLength < 1) throw new Error("vector length must be between >=1");
  if (vectorLength > 9) throw new Error("vector length must be <= 9 ");

  const vector = [];

  // vector entries
  for (let i = 0; i < vectorLength; i++) {
    const vUuid = intToUUID[view.getUint8(offset++)];
    const vTick = view.getFloat64(offset, true);
    offset += 8;
    vector.push([vUuid, vTick]);
  }

  return {
    uuid,
    state: {
      tick: [startTick, endTick],
      position: [x, y],
      isClicking,
      vector,
    },
  };
};

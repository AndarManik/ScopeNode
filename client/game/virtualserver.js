import { pack, unpack } from "./binary.js";

const VTICK = 64;
export const newVirtualServer = (game, socket, team1, team2) => {
  let HZ = 64;

  const all = [...team1, ...team2];
  all.sort();
  const allInv = {};
  all.forEach((uuid, index) => (allInv[uuid] = index));

  let localState = buildInitialState(game, all, team1, game.userId);
  const localHistory = [localState];
  const globalStates = new Map();
  const globalHistories = new Map();

  const virtualServer = { globalStates, globalHistories };

  all.forEach((uuid) => {
    if (uuid === game.userId) return;
    const state = buildInitialState(game, all, team1, uuid);
    globalStates.set(uuid, state);
    globalHistories.set(uuid, [state]);
  });

  virtualServer.addState = (packedState) => {
    const { uuid, state } = unpack(all, packedState);
    const userHistory = globalHistories.get(uuid);
    const tick = state.tick[0];
    if (
      !userHistory.length ||
      userHistory[userHistory.length - 1].tick[0] < tick
    ) {
      globalStates.set(uuid, state);
      userHistory.push(state);
    } else {
      let low = 0;
      let high = userHistory.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (userHistory[mid].tick[0] < tick) low = mid + 1;
        else high = mid;
      }
      userHistory.splice(low, 0, state);
    }
  };

  const alpha = 0.01;
  const invalpha = 1 - alpha;

  let tick = 0;
  let lamportExp = 0;
  let speculExp = 0;
  let headroomExp = 0;
  let stretchExp = 0;
  let expAvg = 0;

  let lStretch = true;
  let sStretch = true;
  let hStretch = true;
  const nextTick = () => {
    if (game.isDead) return;

    const startTick = ++tick;
    const lamportTick = getLamportTick(startTick);
    lamportExp = invalpha * lamportExp + alpha * (lamportTick - startTick);

    const speculativeTick = getSpeculativeTick(startTick);
    speculExp = invalpha * speculExp + alpha * (speculativeTick - startTick);

    if (lStretch && tick < lamportTick) tick = lamportTick;
    if (sStretch && tick < speculativeTick) tick = speculativeTick;

    // this comes after l and s because we want to add it ontop
    const headroomTick = getHeadroomTick(tick);
    headroomExp = invalpha * headroomExp + alpha * (headroomTick - tick);
    if (hStretch && tick < headroomTick) tick = headroomTick;

    stretchExp = invalpha * stretchExp + alpha * (tick - startTick);

    const vector = [];
    for (const [uuid, { tick }] of globalStates.entries())
      vector.push([uuid, tick[0]]);

    localState = {
      tick: [startTick, tick],
      vector,
      position: [...game.playerPosition],
      isClicking: game.isClicking,
    };

    localHistory.push(localState);

    if (game.isMultiPlayer) socket.send(pack(allInv, game.userId, localState));

    while (processHistory());

    const lag = tick - (localHistory[0]?.tick[0] || tick);
    expAvg = invalpha * expAvg + alpha * lag;

    setTimeout(nextTick, 1000 / HZ);
  };

  const getLamportTick = (lamportTick) => {
    for (const { tick } of globalStates.values())
      lamportTick = tick[0] > lamportTick ? tick[0] : lamportTick;
    return lamportTick;
  };

  let lastSpeculativeTick = 0;
  const getSpeculativeTick = (speculativeTick) => {
    let speculativeLag = 0;
    for (const { tick, vector } of globalStates.values()) {
      let self;
      let avg = tick[0];
      for (const [uuid, tick] of vector) {
        avg += tick;
        if (uuid !== game.userId) continue;
        avg += 2 * tick;
        self = tick;
      }
      speculativeLag += avg / (vector.length + 3) - self;
      if (self < lastSpeculativeTick) return speculativeTick;
    }
    if (speculativeLag <= 0) return speculativeTick;

    speculativeLag = Math.floor(speculativeLag / globalStates.size);
    lastSpeculativeTick = speculativeTick + speculativeLag;

    return speculativeTick + speculativeLag;
  };

  let lastHeadroomTime = Number.MAX_VALUE;
  const getHeadroomTick = (headroomTick) => {
    const now = performance.now();
    const headroomLag = (now - lastHeadroomTime) / (1000 / VTICK) - 1;
    lastHeadroomTime = now;
    if (headroomLag < 0) return headroomTick;
    if (headroomLag < 1) return headroomTick + (Math.random() < headroomLag);
    return headroomTick + Math.round(headroomLag);
  };

  let processedTick = 0;
  const processHistory = () => {
    // Make sure each clients start tick is before or at proccessedTick
    if (!localHistory.length || localHistory[0].tick[0] > processedTick)
      return false;
    for (const history of globalHistories.values())
      if (!history.length || history[0].tick[0] > processedTick) return false;

    const tickSlice = [[game.userId, localHistory[0]]];
    for (const [uuid, history] of globalHistories.entries())
      tickSlice.push([uuid, history[0]]);

    // Get the earliest end tick of each client
    let min = Number.MAX_SAFE_INTEGER;
    for (const [_, state] of tickSlice) min = Math.min(state.tick[1], min);

    if (localHistory[0].tick[1] === min) localHistory.shift();
    for (const history of globalHistories.values())
      if (history[0].tick[1] === min) history.shift();

    processedTick = min + 1;

    game.processStates(tickSlice, processedTick, tick);

    return true;
  };

  const stats = document.getElementById("Stats");
  const logTick = () => {
    if (game.isDead) return;
    stats.innerText =
      "PING: " +
      Math.round((expAvg * 1000) / (HZ * (1 + stretchExp))) +
      "\nL vTICK: " +
      Math.round(10 * HZ * (1 + lamportExp)) / 10 +
      "\nS vTICK: " +
      Math.round(10 * HZ * (1 + speculExp)) / 10 +
      "\nH vTICK: " +
      Math.round(10 * HZ * (1 + headroomExp)) / 10 +
      "\nT vTICK: " +
      Math.round(10 * HZ * (1 + stretchExp)) / 10;
    setTimeout(logTick, 1500);
  };

  virtualServer.start = () => {
    nextTick();
    if (game.isMultiPlayer) logTick();
  };

  window.HZ = (hz) => (HZ = hz);
  window.L = () => (lStretch = !lStretch);
  window.S = () => (sStretch = !sStretch);
  window.H = () => (hStretch = !hStretch);

  return virtualServer;
};

const buildInitialState = (game, all, team1, uuid) => ({
  tick: [0, 0],
  vector: all
    .filter((otherUUID) => otherUUID !== uuid)
    .map((uuid) => [uuid, 0]),
  position: team1.has(uuid) ? game.team1Spawn : game.team2Spawn,
});

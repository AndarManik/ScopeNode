import { packState, unpackState } from "./binary.js";
import { registerHit, registerTeamHits } from "./hitreg.js";

export const newVirtualServer = (game, app, team1, team2) => {
  const { socket, stats } = app;
  const HZ = 32;

  const all = [...team1, ...team2];
  all.sort();
  const allInv = {};
  all.forEach((uuid, index) => (allInv[uuid] = index));

  const localHistory = [];
  const globalDead = new Set();
  const globalStates = new Map();
  const globalHistories = new Map();

  const shots = new Set();

  const virtualServer = { globalStates, shots, isStopped: true };

  all.forEach((uuid) => {
    if (uuid === game.userId) return;
    globalStates.set(uuid, buildInitialState(game, all, team1, uuid));
    globalHistories.set(uuid, []);
  });

  // idempotent
  virtualServer.addState = (packedState) => {
    const { uuid, state } = unpackState(all, packedState);
    if (globalDead.has(uuid)) return;
    const tick = state.tick[1];
    if (tick < processedTick) return;
    const userHistory = globalHistories.get(uuid);
    const n = userHistory.length;
    if (n === 0) {
      Object.assign(globalStates.get(uuid), structuredClone(state));
      globalStates.get(uuid).seen = 0;
      userHistory.push(state);
      return;
    }
    const lastTick = userHistory[n - 1].tick[1];
    if (lastTick < tick) {
      Object.assign(globalStates.get(uuid), structuredClone(state));
      globalStates.get(uuid).seen = 0;
      userHistory.push(state);
      return;
    }
    if (lastTick === tick) return;
    let low = 0;
    let high = n;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midTick = userHistory[mid].tick[1];
      if (midTick < tick) low = mid + 1;
      else high = mid;
    }
    if (low < n && userHistory[low].tick[1] === tick) return;
    userHistory.splice(low, 0, state);
  };

  const alpha = 0.05;
  const invalpha = 1 - alpha;

  let tick = 0;
  let headroomExp = 0;
  let lamportExp = 0;
  let speculExp = 0;
  let stretchExp = 0;
  let expAvg = 0;
  const nextTick = () => {
    if (game.isDead) return;
    if (virtualServer.isStopped) return;

    const headroomTick = getHeadroomTick();
    if (headroomTick) {
      const startTick = tick + 1;
      const lamportTick = getLamportTick(startTick);
      const speculativeTick = getSpeculativeTick(startTick);
      tick = Math.max(lamportTick, speculativeTick) + headroomTick - 1;

      lamportExp = invalpha * lamportExp + alpha * (lamportTick - startTick);
      speculExp = invalpha * speculExp + alpha * (speculativeTick - startTick);
      headroomExp = invalpha * headroomExp + alpha * headroomTick;
      stretchExp = invalpha * stretchExp + alpha * (tick - startTick);

      const vector = [];
      for (const [uuid, { tick }] of globalStates.entries())
        vector.push([uuid, tick[0]]);

      const time = performance.now() - virtualServer.startTime;

      const localState = {
        tick: [startTick, tick],
        vector,
        position: [...game.playerPosition],
        path: game.preRound ? [] : game.path,
        light: [game.playerLight[0], game.playerLight[1]],
        time,
      };

      if (!game.playerIsDead) localHistory.push(localState);

      if (!game.playerIsDead && game.isMultiPlayer)
        socket.send(packState(allInv, game.userId, localState));
    }

    while (processHistory());

    const lag =
      (localHistory[localHistory.length - 1]?.time ?? 0) -
      (localHistory[0]?.time ?? 0);
    expAvg = invalpha * expAvg + alpha * lag;

    const log = stats.log;
    log.set("PING", expAvg);
    log.set("vTick| ", HZ * (1 + stretchExp));
    log.set("vTick|H", HZ * headroomExp);
    log.set("vTick|S", HZ * (speculExp + headroomExp));

    setTimeout(nextTick, 1000 / HZ);
  };

  let lastHeadroomTime;
  const getHeadroomTick = () => {
    const now = performance.now();
    const headroomLag = (now - lastHeadroomTime) / (1000 / HZ);
    if (Math.random() > headroomLag) return 0;
    lastHeadroomTime = now;
    return Math.max(1, Math.round(headroomLag));
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

  let processedTick = 1;
  const processHistory = () => {
    if (
      !game.playerIsDead &&
      (!localHistory.length || localHistory[0].tick[0] > processedTick)
    )
      return false;
    for (const history of globalHistories.values())
      if (!history.length || history[0].tick[0] > processedTick) return false;

    if (!localHistory.length && !globalHistories.size) return false;

    const tickSlice = [];
    if (!game.playerIsDead)
      tickSlice.push({ ...localHistory[0], uuid: game.userId });

    for (const [uuid, history] of globalHistories.entries())
      tickSlice.push({ ...history[0], uuid });

    // Get the earliest end tick of each client
    let min = Number.MAX_SAFE_INTEGER;
    for (const state of tickSlice) min = Math.min(state.tick[1], min);

    if (!game.playerIsDead && localHistory[0].tick[1] === min)
      localHistory.shift();
    for (const history of globalHistories.values())
      if (history[0].tick[1] === min) history.shift();

    processedTick = min + 1;

    processStates(tickSlice, min);

    return true;
  };

  const processStates = (tickSlice, tick) => {
    // tickSlice: array of states, each with .uuid
    const team1States = tickSlice.filter((state) => team1.has(state.uuid));
    const team2States = tickSlice.filter((state) => team2.has(state.uuid));

    // deterministic in that all clients will get the same time here
    // sum of monotonic functions is a monotonic function
    let time = 0;
    for (const state of tickSlice) time += state.time;
    time /= tickSlice.length * 1000;

    const newShots = registerTeamHits(game, team1States, team2States, time);
    if (!newShots.length) return;

    for (const shot of newShots) {
      shots.add(shot);
      if (shot.killed === game.userId) {
        localHistory.length = 0;
        game.playerIsDead = true;
        return;
      }
      globalStates.delete(shot.killed);
      globalHistories.delete(shot.killed);
      globalDead.add(shot.killed);
    }

    socket.json({ command: "new shots", newShots, tick });
  };

  virtualServer.updatePlayers = (team1, team2) => {
    const currentPlayers = Array.from(globalStates.keys());
    for (const player of currentPlayers) {
      if (team1.has(player)) continue;
      if (team2.has(player)) continue;
      globalStates.delete(player);
      globalHistories.delete(player);
      globalDead.add(player);
    }
  };

  virtualServer.start = () => {
    virtualServer.startTime = performance.now();
    lastHeadroomTime = virtualServer.startTime;
    virtualServer.isStopped = false;
    nextTick();
  };

  return virtualServer;
};

const buildInitialState = (game, all, team1, uuid) => ({
  tick: [0, 0],
  vector: all
    .filter((otherUUID) => otherUUID !== uuid)
    .map((uuid) => [uuid, 0]),
  position: team1.has(uuid) ? [...game.spawn1] : [...game.spawn2],
  path: [],
  light: [[], []],
});

import { packState, unpackState } from "./binary.js";
import { registerTeamHits } from "./hitreg.js";

export const newVirtualServer = (game, app) => {
  const { socket, stats } = app;
  const HZ = 64;
  const { team1, team2, all, allInv, userId, player, players, playersMap } =
    game;

  const globalHistories = new Map(all.map((uuid) => [uuid, []]));

  const virtualServer = { isStopped: true };

  // idempotent
  virtualServer.addState = (packedState) => {
    if (!player.isAlive) return;
    const { uuid, state } = unpackState(all, packedState);
    const tick = state.tick[1];
    if (tick < processedTick) return;
    const userHistory = globalHistories.get(uuid);
    const lastHistory = userHistory[userHistory.length - 1];
    const lastTick = lastHistory ? lastHistory.tick[1] : -Infinity;
    if (tick < lastTick) spliceOnlinePlayerState(uuid, state);
    if (tick > lastTick) updateOnlinePlayerState(uuid, state);
  };

  const spliceOnlinePlayerState = (uuid, state) => {
    const userHistory = globalHistories.get(uuid);
    const n = userHistory.length;
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

  const updateOnlinePlayerState = (uuid, state) => {
    globalHistories.get(uuid).push(state);
    const player = playersMap.get(uuid);
    Object.assign(player, state);
    player.position = [...player.position];
    player.seen = 0;
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
      for (const { type, tick, uuid } of players)
        if (type === "online") vector.push([uuid, tick[0]]);

      const time = performance.now() - game.startTime;

      const localState = {
        tick: [startTick, tick],
        vector,
        position: [...player.position],
        path: player.path,
        light: [player.light[0], player.light[1]],
        moveSpeed: player.moveSpeed,
        time,
      };

      if (player.isAlive) globalHistories.get(userId).push(localState);

      if (player.isAlive && game.isMultiPlayer)
        socket.send(packState(allInv, userId, localState));
    }

    while (processHistory());

    const localHistory = globalHistories.get(userId);

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
    for (const { tick, type } of players)
      if (type === "online")
        lamportTick = tick[0] > lamportTick ? tick[0] : lamportTick;
    return lamportTick;
  };

  let lastSpeculativeTick = 0;
  const getSpeculativeTick = (speculativeTick) => {
    let speculativeLag = 0;
    for (const { tick, vector, type } of players) {
      if (type !== "online") continue;
      let self;
      let avg = tick[0];
      for (const [uuid, tick] of vector) {
        avg += tick;
        if (uuid !== userId) continue;
        avg += 2 * tick;
        self = tick;
      }
      speculativeLag += avg / (vector.length + 3) - self;
      if (self < lastSpeculativeTick) return speculativeTick;
    }
    if (speculativeLag <= 0) return speculativeTick;

    speculativeLag = Math.floor(speculativeLag / (players.length - 1));
    lastSpeculativeTick = speculativeTick + speculativeLag;
    return speculativeTick + speculativeLag;
  };

  let processedTick = 1;
  const processHistory = () => {
    if (!globalHistories.size) return false;
    for (const history of globalHistories.values())
      if (!history.length || history[0].tick[0] > processedTick) return false;

    const tickSlice = [];
    for (const [uuid, history] of globalHistories.entries())
      tickSlice.push({ ...history[0], uuid });

    // Get the earliest end tick of each client
    let min = Number.MAX_SAFE_INTEGER;
    for (const state of tickSlice) min = Math.min(state.tick[1], min);

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
      game.shots.add(shot);
      playersMap.get(shot.killed).isAlive = false;
      globalHistories.delete(shot.killed);
    }

    socket.json({ command: "new shots", newShots, tick });
  };

  virtualServer.updatePlayers = (team1, team2) => {
    const currentPlayers = all;
    for (const player of currentPlayers) {
      if (team1.has(player)) continue;
      if (team2.has(player)) continue;
      globalHistories.delete(player);
    }
  };

  virtualServer.start = () => {
    lastHeadroomTime = game.startTime;
    virtualServer.isStopped = false;
    nextTick();
  };

  return virtualServer;
};

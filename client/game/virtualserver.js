import { packState, unpackState } from "./binary.js";
import { registerHit } from "./hitreg.js";

export const newVirtualServer = (game, app, team1, team2) => {
  const { socket, stats } = app;
  let HZ = 32;

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
      globalStates.get(uuid).seen = false;
      userHistory.push(state);
      return;
    }
    const lastTick = userHistory[n - 1].tick[1];
    if (lastTick < tick) {
      Object.assign(globalStates.get(uuid), structuredClone(state));
      globalStates.get(uuid).seen = false;
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
  virtualServer.nextTick = () => {
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
    // Make sure each clients start tick is before or at proccessedTick
    if (
      !game.playerIsDead &&
      (!localHistory.length || localHistory[0].tick[0] > processedTick)
    )
      return false;
    for (const history of globalHistories.values())
      if (!history.length || history[0].tick[0] > processedTick) return false;

    if (!localHistory.length && !globalHistories.size) return false;

    const tickSlice = game.playerIsDead ? [] : [[game.userId, localHistory[0]]];
    for (const [uuid, history] of globalHistories.entries())
      tickSlice.push([uuid, history[0]]);

    // Get the earliest end tick of each client
    let min = Number.MAX_SAFE_INTEGER;
    for (const [_, state] of tickSlice) min = Math.min(state.tick[1], min);

    if (!game.playerIsDead && localHistory[0].tick[1] === min)
      localHistory.shift();
    for (const history of globalHistories.values())
      if (history[0].tick[1] === min) history.shift();

    processedTick = min + 1;

    processStates(tickSlice, min);

    return true;
  };

  const processStates = (tickSlice, tick) => {
    const team1States = tickSlice.filter(([uuid]) => team1.has(uuid));
    const team2States = tickSlice.filter(([uuid]) => team2.has(uuid));

    const newShots = [];
    const playerRadius = game.playerRadius;
    // team1 kills team2
    for (const [uuid1, team1Player] of team1States) {
      const losPoly = team1Player.light[0];
      for (const [uuid2, team2Player] of team2States) {
        const hit = registerHit(team2Player.position, playerRadius, losPoly);
        if (!hit) continue;
        newShots.push({
          team1: true,
          killer: uuid1,
          killed: uuid2,
          killerPosition: team1Player.position,
          killedPosition: team2Player.position,
          hit,
        });
      }
    }
    // team2 kills team1
    for (const [uuid2, team2Player] of team2States) {
      const losPoly = team2Player.light[0];
      for (const [uuid1, team1Player] of team1States) {
        const hit = registerHit(team1Player.position, playerRadius, losPoly);
        if (!hit) continue;
        newShots.push({
          team2: true,
          killer: uuid2,
          killed: uuid1,
          killerPosition: team2Player.position,
          killedPosition: team1Player.position,
          hit,
        });
      }
    }

    let time = 0;
    for (const [_, state] of tickSlice) time += state.time;
    time /= tickSlice.length * 1000;
    const timeAlpha = Math.max(0, (time - 30) / 30) ** 3;

    const obstacleRadius =
      (1 - timeAlpha) * playerRadius +
      timeAlpha * Math.hypot(game.mapWidth, game.mapHeight);

    for (const [uuid1, team1Player] of team1States) {
      const dx = team1Player.position[0] - game.centerObjective[0];
      const dy = team1Player.position[1] - game.centerObjective[1];
      const dist = Math.sqrt(dx * dx + dy * dy) - playerRadius;
      if (dist < obstacleRadius) {
        for (const [uuid2, team2Player] of team2States) {
          newShots.push({
            team1: true,
            killer: uuid1,
            killed: uuid2,
            killerPosition: team1Player.position,
            killedPosition: team2Player.position,
            hit: team2Player.position,
          });
        }
      }
    }

    for (const [uuid2, team2Player] of team2States) {
      const dx = team2Player.position[0] - game.centerObjective[0];
      const dy = team2Player.position[1] - game.centerObjective[1];
      const dist = Math.sqrt(dx * dx + dy * dy) - playerRadius;
      if (dist < obstacleRadius) {
        for (const [uuid1, team1Player] of team1States) {
          newShots.push({
            team2: true,
            killer: uuid2,
            killed: uuid1,
            killerPosition: team2Player.position,
            killedPosition: team1Player.position,
            hit: team1Player.position,
          });
        }
      }
    }

    newShots.forEach(killPlayer);
    if (newShots.length) socket.json({ command: "new shots", newShots, tick });
  };

  const killPlayer = (shot) => {
    shots.add(shot);
    if (shot.killed === game.userId) {
      localHistory.length = 0;
      game.playerIsDead = true;
      return;
    }
    globalStates.delete(shot.killed);
    globalHistories.delete(shot.killed);
    globalDead.add(shot.killed);
  };

  virtualServer.start = () => {
    virtualServer.startTime = performance.now();
    lastHeadroomTime = virtualServer.startTime;
    virtualServer.isStopped = false;
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

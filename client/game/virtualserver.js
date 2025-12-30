import { pack, unpack } from "./binary.js";
import { registerHit } from "./hitreg.js";

let count = 0;
const VTICK = 64;
export const newVirtualServer = (game, app, team1, team2) => {
  count++;
  const { socket, stats } = app;
  let HZ = 64;

  const all = [...team1, ...team2];
  all.sort();
  const allInv = {};
  all.forEach((uuid, index) => (allInv[uuid] = index));

  const localHistory = [buildInitialState(game, all, team1, game.userId)];

  const globalDead = new Set();
  const globalStates = new Map();
  const globalHistories = new Map();

  const shots = new Set();

  const virtualServer = { globalStates, shots };

  all.forEach((uuid) => {
    if (uuid === game.userId) return;
    const state = buildInitialState(game, all, team1, uuid);
    globalStates.set(uuid, state);
    globalHistories.set(uuid, [state]);
  });

  // idempotent
  virtualServer.addState = (packedState) => {
    const { uuid, state } = unpack(all, packedState);
    if (globalDead.has(uuid)) return;
    const tick = state.tick[1];
    if (tick < processedTick) return;
    const userHistory = globalHistories.get(uuid);
    const n = userHistory.length;
    if (n === 0) {
      globalStates.set(uuid, state);
      userHistory.push(state);
      return;
    }
    const lastTick = userHistory[n - 1].tick[1];
    if (lastTick < tick) {
      globalStates.set(uuid, state);
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

  const alpha = 0.1;
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
    if (virtualServer.isStopped) return;

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

    const localState = {
      tick: [startTick, tick],
      vector,
      position: [...game.playerPosition],
      path: game.preRound ? [] : game.path,
      light: game.playerLight,
    };

    if (!game.playerIsDead) localHistory.push(localState);

    if (!game.playerIsDead && game.isMultiPlayer)
      socket.send(pack(allInv, game.userId, localState));

    while (processHistory());

    const lag = tick - (localHistory[0]?.tick[0] || tick);
    expAvg = invalpha * expAvg + alpha * lag;

    const log = stats.log;
    log.set("PING", (expAvg * 1000) / (HZ * (1 + stretchExp)));
    log.set("L vTick", HZ * (1 + lamportExp));
    log.set("S vTick", HZ * (1 + speculExp));
    log.set("H vTick", HZ * (1 + headroomExp));
    log.set("T vTick", HZ * (1 + stretchExp));
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

    for (const [uuid1, team1Player] of team1States) {
      const dx = team1Player.position[0] - game.centerObjective[0];
      const dy = team1Player.position[1] - game.centerObjective[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2 * playerRadius) {
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
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2 * playerRadius) {
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
    console.log(
      "player killed",
      count,
      shot.killerPosition,
      shot.killedPosition,
      tick
    );
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
    nextTick();
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
  position: team1.has(uuid) ? [...game.spawn1] : [...game.spawn2],
  path: [],
  light: [[], []],
});

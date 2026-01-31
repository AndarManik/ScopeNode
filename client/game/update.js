import { newObstaclePreview } from "./arena.js";
import {
  allDieTargets,
  allKillTargets,
  registerTarget,
  registerTeamHits,
} from "./hitreg.js";
import {
  makeDistancePathToPolys,
  moveAlongPath,
  planPath,
  planPathSafe,
} from "./pathing.js";

// There are a few abstactions here that are wrong.
// The same thing happens to each player yet theres a function for each player,
// depending on where it is.

export const update = (game, app, delta, team1) => {
  game.xSwap = false;
  if (game.renderSettings.preferredSide === "left" && !game.isTeam1)
    game.xSwap = true;
  if (game.renderSettings.preferredSide === "right" && game.isTeam1)
    game.xSwap = true;

  if (game.previewingObstacle) return;
  if (game.buildingObstalces) return;
  if (game.choosingObstacle) return newObstaclePreview(game, app.socket);

  if (game.isMultiPlayer) multiPlayerUpdate(game, app, delta, team1);
  else singlePlayerUpdate(game, delta, team1);
};

const singlePlayerUpdate = (game, delta, team1) => {
  if (!game.pathGraph) return;
  updatePlayerPosition(game, delta);
  updateBotPositions(game, team1, delta);

  game.team1Lights = new Map();
  game.team2Lights = new Map();
  if (!game.lightGraph) return;

  updatePlayerLight(game, team1);
  updateBotLights(game, team1);

  updatePlayerAim(game, delta);

  updateSinglePlayerShots(game, team1, delta);
};

const updateBotPositions = (game, team1, delta) => {
  const team1Target = [...game.team1Lights.values()];
  const team2Target = [...game.team2Lights.values()];

  const team1Distance = makeDistancePathToPolys(team1Target);
  const team2Distance = makeDistancePathToPolys(team2Target);

  for (const bot of game.bots) {
    if (!bot.last || bot.last > Math.random() * 0.4) {
      bot.last = delta;
      bot.path = null;
    }
    bot.last += delta;
  }

  chooseObjectiveSeekers(game, team1, team1Distance, team2Distance);

  computeCandidates(
    game,
    team1,
    team1Target,
    team2Target,
    team1Distance,
    team2Distance,
    allKillTargets,
  );

  computeCandidates(
    game,
    team1,
    team1Target,
    team2Target,
    team1Distance,
    team2Distance,
    allDieTargets,
  );

  for (const bot of game.bots) if (!bot.path) bot.path = [];

  moveBotsAlongPaths(game, delta);

  updateBotAimTargets(game, team1, delta, team1Target, team2Target);
};

function chooseObjectiveSeekers(game, team1, team1Distance, team2Distance) {
  const team1ObjectiveSeeker = [Infinity, null];
  const team2ObjectiveSeeker = [Infinity, null];

  const [cx, cy] = game.centerObjective;
  const offset = 1.9 * game.playerRadius;

  for (const bot of game.bots) {
    if (bot.path) continue;
    const isTeam1 = team1.has(bot.uuid);
    const avoid = isTeam1 ? team2Distance : team1Distance;

    const dx = bot.position[0] - cx;
    const dy = bot.position[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    const desired = [cx + (dx / len) * offset, cy + (dy / len) * offset];

    bot.toObjective = planPathSafe(game, bot.position, desired, avoid);

    const distance = bot.toObjective.distance;
    const seeker = isTeam1 ? team1ObjectiveSeeker : team2ObjectiveSeeker;

    if (distance >= seeker[0]) continue;

    seeker[0] = distance;
    seeker[1] = bot;
  }

  if (team1ObjectiveSeeker[1])
    team1ObjectiveSeeker[1].path = team1ObjectiveSeeker[1].toObjective.path;
  if (team2ObjectiveSeeker[1])
    team2ObjectiveSeeker[1].path = team2ObjectiveSeeker[1].toObjective.path;
}

function computeCandidates(
  game,
  team1,
  team1Target,
  team2Target,
  team1Distance,
  team2Distance,
  allTargetsFn, // (game, botPos, avoidPolys) => [ [x,y], ... ]
) {
  const STEP = game.playerRadius * 4;
  const STEP2 = STEP * STEP;

  // Run identical logic for each team by swapping avoid/avoidDistance.
  const teamDescs = [
    { isTeam1: true, avoid: team2Target, avoidDistance: team2Distance },
    { isTeam1: false, avoid: team1Target, avoidDistance: team1Distance },
  ];

  for (let td = 0; td < teamDescs.length; td++) {
    const { isTeam1, avoid, avoidDistance } = teamDescs[td];

    // Collect bots on this team that still need a path.
    const bots = [];
    for (let i = 0; i < game.bots.length; i++) {
      const bot = game.bots[i];
      if (bot.path) continue;
      if (team1.has(bot.uuid) === isTeam1) bots.push(bot);
    }
    if (bots.length === 0) continue;

    // Precompute each bot's target list once; then we keep pruning it.
    const remainingTargets = new Map(); // uuid -> [points]
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      remainingTargets.set(bot.uuid, allTargetsFn(game, bot.position, avoid));
    }

    const assigned = []; // committed target points

    const filterAgainstAssigned = (targets) => {
      if (!targets || targets.length === 0) return targets;
      if (assigned.length === 0) return targets;

      const out = [];
      outer: for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        const px = p[0],
          py = p[1];
        for (let j = 0; j < assigned.length; j++) {
          const a = assigned[j];
          const dx = px - a[0];
          const dy = py - a[1];
          if (dx * dx + dy * dy < STEP2) continue outer;
        }
        out.push(p);
      }
      return out;
    };

    // Greedy global assignment: each round pick best (bot,target) across all bots.
    while (true) {
      let bestBot = null;
      let bestPath = null;
      let bestDist = Infinity;
      let bestTarget = null;

      for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        if (bot.path) continue;

        let targets = remainingTargets.get(bot.uuid);
        if (!targets || targets.length === 0) continue;

        targets = filterAgainstAssigned(targets);
        remainingTargets.set(bot.uuid, targets);
        if (targets.length === 0) continue;

        let botBestDist = Infinity;
        let botBestPath = null;
        let botBestTarget = null;

        for (let k = 0; k < targets.length; k++) {
          const point = targets[k];
          const { path, distance } = planPathSafe(
            game,
            bot.position,
            point,
            avoidDistance,
          );

          if (distance < botBestDist) {
            botBestDist = distance;
            botBestPath = path;
            botBestTarget = point;
          }
        }

        if (botBestPath && botBestDist < bestDist) {
          bestDist = botBestDist;
          bestPath = botBestPath;
          bestBot = bot;
          bestTarget = botBestTarget;
        }
      }

      if (!bestBot) break;

      // Commit best assignment.
      bestBot.path = bestPath;
      assigned.push(bestTarget);

      // Aggressively prune remaining target lists vs the newly assigned target.
      const ax = bestTarget[0],
        ay = bestTarget[1];
      for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        if (bot.path) continue;

        const targets = remainingTargets.get(bot.uuid);
        if (!targets || targets.length === 0) continue;

        const out = [];
        for (let k = 0; k < targets.length; k++) {
          const p = targets[k];
          const dx = p[0] - ax;
          const dy = p[1] - ay;
          if (dx * dx + dy * dy >= STEP2) out.push(p);
        }
        remainingTargets.set(bot.uuid, out);
      }
    }
  }
}

function moveBotsAlongPaths(game, delta) {
  for (const bot of game.bots) {
    if (!bot.path) bot.path = [];
    moveAlongPath(
      bot.position,
      bot.path,
      game.moveSpeed * game.playerRadius * delta,
    );
  }
}

function updateBotAimTargets(game, team1, delta, team1Target, team2Target) {
  for (const bot of game.bots) {
    const isTeam1 = team1.has(bot.uuid);
    const shooter = isTeam1
      ? game.team1Lights.get(bot.uuid)
      : game.team2Lights.get(bot.uuid);
    const enemies = isTeam1 ? team2Target : team1Target;

    const rawTarget = registerTarget(shooter, enemies, game.playerRadius);
    const [desiredPos, hasAdvantage] = rawTarget || [false, false];
    const fallback = desiredPos || bot.path[1] || bot.position;
    const target = smoothTargetPos(bot, bot.position, fallback, delta);
    bot.target = [target, hasAdvantage];
  }
}

const updateBotLights = (game, team1) => {
  for (const bot of game.bots) {
    const light = game.lightGraph.shineAt(bot.position);
    light.push(bot.position);
    bot.light = light;
    if (team1.has(bot.uuid)) game.team1Lights.set(bot.uuid, light);
    else game.team2Lights.set(bot.uuid, light);
  }
};

const updateSinglePlayerShots = (game, team1, delta) => {
  return;
  const player = {
    uuid: "player",
    position: game.playerPosition,
    light: game.playerLight,
  };

  const team1States = [];
  const team2States = [];

  if (!game.playerIsDead) team1States.push(player);
  for (const bot of game.bots)
    (team1.has(bot.uuid) ? team1States : team2States).push(bot);

  const time = (performance.now() - game.startTime) / 1000;

  const shots = registerTeamHits(game, team1States, team2States, time);
  shots.forEach((shot) => {
    game.shots.add(shot);
    if (shot.killed === "player") game.playerIsDead = true;
    else game.bots = game.bots.filter(({ uuid }) => uuid !== shot.killed);
  });

  const gameOver = !team1States.length || !team2States.length;

  if (gameOver) {
    Huge.classList.remove("fading-out");
    Huge.style.opacity = 0.9;
    Huge.style.fontSize = "128";
    Huge.innerText = team1States.length ? "Green Wins" : "Purple Wins";
  }

  let allFinished = gameOver;
  game.shots.forEach((shot) => {
    allFinished &&= shot.finished;
    if (shot.finished) return;
    if (shot.anim == null) shot.anim = 0;
    else shot.anim += delta;
  });

  if (allFinished) {
    game.init();
    Huge.classList.add("fading-out");
    Huge.style.opacity = 0;
  }
};

const multiPlayerUpdate = (game, app, delta, team1) => {
  game.path = [];
  updatePlayerPosition(game, delta);
  updateGlobalPositions(game, app, delta);
  updateShots(game, delta);

  game.team1Lights = new Map();
  game.team2Lights = new Map();
  if (!game.lightGraph) return;

  updatePlayerLight(game, team1);
  updateGlobalLights(game, team1);

  updatePlayerAim(game, delta);
  updateGlobalAim(game, team1, delta);
};

const updatePlayerPosition = (game, delta) => {
  if (game.playerIsDead) return;
  const shiftSlow = game.keyboard.shift ? 2 / 3 : 1;
  const ctrlSlow = game.keyboard.ctrl ? 1 / 2 : 1;
  const moveSpeed = shiftSlow * ctrlSlow * game.moveSpeed;
  const step = moveSpeed * game.playerRadius * delta;
  const target = getPlayerPathTarget(game);
  game.path = planPath(game, game.playerPosition, target);
  if (!game.preRound) moveAlongPath(game.playerPosition, game.path, step);
};

const getPlayerPathTarget = (game) => {
  if (game.keyboard.space) return game.playerPosition;
  if (game.inputPreference === "mouse") return getMouseTarget(game);
  else return getWASDTarget(game);
};

const getMouseTarget = (game) => {
  const [mx, my] = game.mouse;
  if (!game.mouse.isClicking) return game.mouse;

  const [px, py] = game.playerPosition;

  const dx = mx - px;
  const dy = my - py;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [px, py];
  const dist = Math.min(game.playerRadius / 2, d);
  return [px + (dx / d) * dist, py + (dy / d) * dist];
};

const getWASDTarget = (game) => {
  const { w, a, s, d } = game.keyboard;
  const [px, py] = game.playerPosition;
  const { playerRadius } = game;

  let x = (d - a) * (game.xSwap ? -1 : 1);
  let y = w - s;

  if (x === 0 && y === 0) return [px, py];
  const len = Math.hypot(x, y);
  x /= len;
  y /= len;
  return [px + (x * playerRadius) / 2, py + (y * playerRadius) / 2];
};

const updateGlobalPositions = (game, app, delta) => {
  let interps = 0;
  const { moveSpeed, playerRadius } = game;
  for (const state of game.virtualServer.globalStates.values()) {
    // vServer sets seen to 0 when state is new
    state.seen++;
    if (state.seen < 2) continue;
    const step = moveSpeed * playerRadius * delta;
    moveAlongPath(state.position, state.path, step);
    interps++;
  }

  app.stats.log.set("intrps", interps);
};

const updatePlayerLight = (game, team1) => {
  if (game.playerIsDead) return;
  game.playerLight = game.lightGraph.shineAt(game.playerPosition);
  game.playerLight.push(game.playerPosition);
  const teamLight = game.isTeam1 ? game.team1Lights : game.team2Lights;
  teamLight.set(game.userId, game.playerLight);
};

const updateGlobalLights = (game, team1) => {
  for (const [uuid, state] of game.virtualServer.globalStates) {
    const light =
      state.seen > 1 ? game.lightGraph.shineAt(state.position) : state.light;
    light.push(state.position);
    if (team1.has(uuid)) game.team1Lights.set(uuid, light);
    else game.team2Lights.set(uuid, light);
  }
};

const updatePlayerAim = (game, delta) => {
  if (game.playerIsDead) return;
  const { playerPosition } = game;
  const team1Target = [...game.team1Lights.values()];
  const team2Target = [...game.team2Lights.values()];
  const teamLight = game.isTeam1 ? game.team1Lights : game.team2Lights;
  const shooter = teamLight.get(game.userId);
  const enemies = game.isTeam1 ? team2Target : team1Target;
  const rawTarget = registerTarget(shooter, enemies, game.playerRadius);
  const [desiredPos, hasAdvantage] = rawTarget || [false, false];
  const fallback = desiredPos || game.path[1] || game.mouse;
  const target = smoothTargetPos(game, playerPosition, fallback, delta);
  game.playerTarget = [target, hasAdvantage];
};

const updateGlobalAim = (game, team1, delta) => {
  const team1Target = [...game.team1Lights.values()];
  const team2Target = [...game.team2Lights.values()];
  for (const [uuid, state] of game.virtualServer.globalStates) {
    const isTeam1 = team1.has(uuid);
    const shooter = (isTeam1 ? game.team1Lights : game.team2Lights).get(uuid);
    const enemies = isTeam1 ? team2Target : team1Target;

    const rawTarget = registerTarget(shooter, enemies, game.playerRadius);
    const [desiredPos, hasAdvantage] = rawTarget || [false, false];
    const fallback = desiredPos || state.path[1] || state.position;
    const target = smoothTargetPos(state, state.position, fallback, delta);
    state.target = [target, hasAdvantage];
  }
};

function shortestAngleDelta(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function smoothTargetPos(state, pos, desiredPos, delta) {
  if (!desiredPos) return state._smoothedTargetAngle ?? 0;

  if (desiredPos[0] === pos[0] && desiredPos[1] === pos[1])
    return state._smoothedTargetAngle;

  const desiredAngle = Math.atan2(
    desiredPos[1] - pos[1],
    desiredPos[0] - pos[0],
  );

  // First frame: snap to target
  if (state._smoothedTargetAngle == null) {
    state._smoothedTargetAngle = desiredAngle;
    state._smoothedTargetAngularVel = 0;
    return desiredAngle;
  }

  const prevAngle = state._smoothedTargetAngle;
  const HALF_LIFE = 0.04;
  const lambda = Math.log(2) / HALF_LIFE;

  // Exponential decay toward the target angle
  const error = shortestAngleDelta(desiredAngle, prevAngle);
  const decay = Math.exp(-lambda * delta); // in (0,1)
  const angle = prevAngle + error * (1 - decay);
  // Derivative (angular velocity) estimate, if you want it
  const vel = shortestAngleDelta(angle, prevAngle) / delta;
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;

  state._smoothedTargetAngle = wrapped;
  state._smoothedTargetAngularVel = vel;

  return wrapped;
}

const updateShots = (game, delta) => {
  game.virtualServer.shots.forEach((shot) => {
    if (shot.finished) return;
    if (shot.anim == null) shot.anim = 0;
    else shot.anim += delta;
  });
};

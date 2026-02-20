import { newObstaclePreview } from "./arena.js";
import {
  allDieTargets,
  allKillTargets,
  registerTarget,
  registerTeamHits,
} from "./hitreg.js";
import {
  makeDistancePathToPolys,
  makeSafeGraphQueryFromPolys,
  moveAlongPath,
  planPath,
  planPathSafe,
} from "./pathing.js";
import { kickout } from "./pathkickout.js";

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
  game.team1Target = [...game.team1Lights.values()];
  game.team2Target = [...game.team2Lights.values()];

  game.team1Distance = makeSafeGraphQueryFromPolys(game, game.team1Target);
  game.team2Distance = makeSafeGraphQueryFromPolys(game, game.team2Target);

  game.team1Used = [];
  game.team2Used = [];
  for (const bot of game.bots) {
    bot.path = null;
  }

  for (const bot of game.bots) {
    const toObjective = objectiveLocation(game, team1, bot);

    pathBotToTargets(game, team1, allKillTargets, bot);
    pathBotToTargets(game, team1, () => [toObjective], bot);
    pathBotToTargets(game, team1, allDieTargets, bot);
  }

  for (const bot of game.bots) if (!bot.path) bot.path = [];

  moveBotsAlongPaths(game, delta);

  updateBotAimTargets(game, team1, delta);
};

function objectiveLocation(game, team1, bot) {
  const playerRadius = game.playerRadius;

  const [cx, cy] = team1.has(bot.uuid)
    ? game.team1Objective
    : game.team2Objective;

  const maxObjectiveRadius = Math.hypot(game.mapWidth, game.mapHeight);

  const time = (performance.now() - game.startTime) / 1000;
  const timeAlpha = Math.min(1, Math.max(0, (time - 30) / 30) ** 3);
  const timeBeta = 1 - timeAlpha;
  const rawObjectiveRadius =
    timeBeta * playerRadius + timeAlpha * maxObjectiveRadius;
  const objectiveRadius = Math.min(
    rawObjectiveRadius,
    maxObjectiveRadius + playerRadius,
  );

  const offset = objectiveRadius + 0.9 * playerRadius;

  const dx = bot.position[0] - cx;
  const dy = bot.position[1] - cy;
  const len = Math.hypot(dx, dy) || 1;
  const desired = [cx + (dx / len) * offset, cy + (dy / len) * offset];
  return desired;
}

function pathBotToTargets(game, team1, targetFunc, bot) {
  if (bot.path) return;

  const STEP = game.playerRadius * 4;
  const STEP2 = STEP * STEP;

  const isTeam1 = team1.has(bot.uuid);

  const enemyExposure = isTeam1 ? game.team2Target : game.team1Target;
  const teamUsed = isTeam1 ? game.team1Used : game.team2Used;
  const targets = targetFunc(game, bot.position, enemyExposure).filter(
    ([targetX, targetY]) => {
      for (const [usedX, usedY] of teamUsed) {
        const dx = targetX - usedX;
        const dy = targetY - usedY;
        const d2 = dx * dx + dy * dy;
        if (d2 < STEP2) return false;
      }
      return true;
    },
  );

  const avoid = isTeam1 ? game.team2Distance : game.team1Distance;
  let bestDistance = Infinity;
  let bestTarget = null;
  let bestPath = null;
  for (const target of targets) {
    const { path, distance } = planPathSafe(game, bot.position, target, avoid);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestTarget = target;
    bestPath = path;
  }

  if (!bestPath) return;

  bot.path = bestPath;
  teamUsed.push(bestTarget);
}

function moveBotsAlongPaths(game, delta) {
  for (const bot of game.bots) {
    moveAlongPath(
      bot.position,
      bot.path,
      game.moveSpeed * game.playerRadius * delta,
    );
    bot.position = kickout(bot.position, game.kickoutParams);
  }
}

function updateBotAimTargets(game, team1, delta) {
  const { team1Target, team2Target } = game;
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
  if(game.noBots) return;
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

  const team1Name = game.renderSettings.xSwap
    ? game.color.team2Name
    : game.color.team1Name;
  const team2Name = game.renderSettings.xSwap
    ? game.color.team1Name
    : game.color.team2Name;

  const team1Color = game.renderSettings.xSwap
    ? game.color.team2Bullet
    : game.color.team1Bullet;
  const team2Color = game.renderSettings.xSwap
    ? game.color.team1Bullet
    : game.color.team2Bullet;

  if (gameOver) {
    Huge.classList.remove("fading-out");
    Huge.style.opacity = 0.9;
    Huge.style.fontSize = "128px";
    Huge.innerText = (team1States.length ? team1Name : team2Name) + " Wins";
    Huge.style.color = team1States.length ? team1Color : team2Color;
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
  game.path = planPath(game, game.playerPosition, target).path;
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

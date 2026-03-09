import { newObstaclePreview } from "./arena.js";
import {
  allDieTargets,
  allKillTargets,
  registerTarget,
  registerTeamHits,
} from "./hitreg.js";
import {
  makeSafeGraphQueryFromPolys,
  moveAlongPath,
  planPath,
  planPathSafe,
} from "./pathing.js";
import { kickout } from "./pathkickout.js";

// There are a few abstactions here that are wrong.
// The same thing happens to each player yet theres a function for each player,
// depending on where it is.

export const update = (game, app, delta) => {
  game.xSwap = false;
  if (game.renderSettings.preferredSide === "left" && game.player.team2)
    game.xSwap = true;
  if (game.renderSettings.preferredSide === "right" && game.player.team1)
    game.xSwap = true;

  if (game.previewingObstacle) return;
  if (game.buildingObstalces) return;
  if (game.choosingObstacle) return newObstaclePreview(game, app.socket);

  if (!game.pathGraph) return;

  updatePlayerPosition(game, delta);

  game.team1Target = [...game.team1Lights.values()];
  game.team2Target = [...game.team2Lights.values()];

  if (game.isMultiPlayer) updateGlobalPositions(game, app, delta);
  else updateBotPositions(game, delta);

  game.team1Lights = new Map();
  game.team2Lights = new Map();
  if (!game.lightGraph) return;

  updateLights(game);
  updateTargets(game, delta);
  updateAdvantage(game);

  if (game.isMultiPlayer) updateShots(game, delta);
  else updateSinglePlayerShots(game, delta);
};

const updatePlayerPosition = (game, delta) => {
  if (!game.player.isAlive) return;
  const player = game.player;
  const shiftSlow = game.keyboard.shift ? 2 / 3 : 1;
  const ctrlSlow = game.keyboard.ctrl ? 1 / 2 : 1;
  player.moveSpeed = shiftSlow * ctrlSlow * game.moveSpeed;
  const step = player.moveSpeed * game.playerRadius * delta;
  const target = getPlayerPathTarget(game);
  player.path = planPath(game, player.position, target).path;
  if (!game.preRound) moveAlongPath(player.position, player.path, step);

  const objective = objectiveLocation(game, player);
  player.distanceToObj = planPath(game, player.position, objective).distance;
};

const updateGlobalPositions = (game, app, delta) => {
  let interps = 0;
  const { playerRadius } = game;
  for (const state of game.players) {
    if (state.type !== "online") continue;
    // vServer sets seen to 0 when state is new
    state.seen++;
    if (state.seen > 1 && !game.preRound) {
      const step = state.moveSpeed * playerRadius * delta;
      moveAlongPath(state.position, state.path, step);
      interps++;
    }

    const objective = objectiveLocation(game, state);
    state.distanceToObj = planPath(game, state.position, objective).distance;
  }

  app.stats.log.set("intrps", interps);
};

const updateBotPositions = (game, delta) => {
  game.team1Distance = makeSafeGraphQueryFromPolys(game, game.team1Target);
  game.team2Distance = makeSafeGraphQueryFromPolys(game, game.team2Target);

  game.team1Used = [];
  game.team2Used = [];
  for (const bot of game.players) if (bot.type === "bot") bot.path = null;

  for (const bot of game.players) {
    if (bot.type !== "bot") continue;
    pathBotToTargets(game, () => [objectiveLocation(game, bot)], bot);
    pathBotToTargets(game, allKillTargets, bot);
    pathBotToTargets(game, allDieTargets, bot);
  }

  for (const bot of game.players)
    if (bot.type === "bot" && !bot.path) bot.path = [];

  moveBotsAlongPaths(game, delta);
};

const updateLights = (game) => {
  for (const player of game.players) {
    if (!player.isAlive) continue;

    player.light =
      player.type !== "online" || player.seen > 1
        ? game.lightGraph.shineAt(player.position)
        : player.light;
    player.light[2] = player.position;
    const teamLight = player.team1 ? game.team1Lights : game.team2Lights;
    teamLight.set(player.uuid, player.light);
  }
};

function updateTargets(game, delta) {
  for (const player of game.players) {
    if (!player.isAlive) continue;
    const enemies = player.team1 ? game.team2Target : game.team1Target;
    const rawTarget = registerTarget(player.light, enemies, game.playerRadius);
    const fallback = rawTarget || player.path[1] || player.position;
    player.target = smoothTargetPos(player, player.position, fallback, delta);
  }
}

const updateAdvantage = (game) => {
  let team1Distance = Infinity;
  let team2Distance = Infinity;
  for (const { team1, team2, distanceToObj, isAlive } of game.players) {
    if (!isAlive) continue;
    if (team1 && distanceToObj < team1Distance) team1Distance = distanceToObj;
    if (team2 && distanceToObj < team2Distance) team2Distance = distanceToObj;
  }
  for (const player of game.players) {
    const opposingDistance = player.team1 ? team2Distance : team1Distance;
    player.advantage = player.distanceToObj < opposingDistance;
  }
};

const updateSinglePlayerShots = (game, delta) => {
  if (!game.team2.size || !game.team1.size) return;
  const team1States = [];
  const team2States = [];

  for (const player of game.players) {
    if (!player.isAlive) continue;
    (player.team1 ? team1States : team2States).push(player);
  }

  const time = (performance.now() - game.startTime) / 1000;

  const shots = registerTeamHits(game, team1States, team2States, time);
  shots.forEach((shot) => {
    game.shots.add(shot);
    game.playersMap.get(shot.killed).isAlive = false;
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

const updateShots = (game, delta) => {
  game.shots.forEach((shot) => {
    if (shot.finished) return;
    if (shot.anim == null) shot.anim = 0;
    else shot.anim += delta;
  });
};

function objectiveLocation(game, player) {
  const playerRadius = game.playerRadius;

  const [cx, cy] = player.team1 ? game.team1Objective : game.team2Objective;

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

  const dx = player.position[0] - cx;
  const dy = player.position[1] - cy;
  const len = Math.hypot(dx, dy) || 1;
  const desired = [cx + (dx / len) * offset, cy + (dy / len) * offset];
  return desired;
}

function pathBotToTargets(game, targetFunc, bot) {
  if (bot.path) return;

  const STEP = game.playerRadius * 8;
  const STEP2 = STEP * STEP;
  const TOP_N = 5;

  const isTeam1 = bot.team1;

  const enemyExposure = isTeam1 ? game.team2Target : game.team1Target;
  const teamExposure = isTeam1 ? game.team1Target : game.team2Target;
  const teamUsed = isTeam1 ? game.team1Used : game.team2Used;
  const avoid = isTeam1 ? game.team2Distance : game.team1Distance;

  const targets = targetFunc(
    game,
    bot.position,
    enemyExposure,
    teamExposure,
  ).filter(([targetX, targetY]) => {
    for (const [usedX, usedY] of teamUsed) {
      const dx = targetX - usedX;
      const dy = targetY - usedY;
      const d2 = dx * dx + dy * dy;
      if (d2 < STEP2) return false;
    }
    return true;
  });

  if (!targets.length) return;

  const unsafeRanked = [];
  for (const target of targets) {
    const { distance } = planPath(game, bot.position, target);
    if (!Number.isFinite(distance)) continue;
    unsafeRanked.push({ target, distance });
  }

  if (!unsafeRanked.length) return;

  unsafeRanked.sort((a, b) => a.distance - b.distance);
  const shortlist = unsafeRanked.slice(0, TOP_N);

  let bestDistance = Infinity;
  let bestTarget = null;
  let bestPath = null;

  for (const { target } of shortlist) {
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
  for (const bot of game.players) {
    if (bot.type !== "bot") continue;
    moveAlongPath(
      bot.position,
      bot.path,
      game.moveSpeed * game.playerRadius * delta,
    );
    bot.position = kickout(bot.position, game.kickoutParams);

    bot.position[0] = Math.max(
      game.playerRadius,
      Math.min(game.mapWidth - game.playerRadius, bot.position[0]),
    );
    bot.position[1] = Math.max(
      game.playerRadius,
      Math.min(game.mapHeight - game.playerRadius, bot.position[1]),
    );

    const objective = objectiveLocation(game, bot);
    bot.distanceToObj = planPath(game, bot.position, objective).distance;
  }
}

const getPlayerPathTarget = (game) => {
  if (game.keyboard.space) return game.player.position;
  if (game.inputPreference === "mouse") return getMouseTarget(game);
  else return getWASDTarget(game);
};

const getMouseTarget = (game) => {
  const [mx, my] = game.mouse;
  if (!game.mouse.isClicking) return game.mouse;

  const [px, py] = game.player.position;

  const dx = mx - px;
  const dy = my - py;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [px, py];
  const dist = Math.min(game.playerRadius * 0.7071, d);
  return [px + (dx / d) * dist, py + (dy / d) * dist];
};

const getWASDTarget = (game) => {
  const { w, a, s, d } = game.keyboard;
  const [px, py] = game.player.position;
  const { playerRadius } = game;

  let x = (d - a) * (game.xSwap ? -1 : 1);
  let y = w - s;

  if (x === 0 && y === 0) return [px, py];
  const len = Math.hypot(x, y);
  x /= len;
  y /= len;
  return [px + x * playerRadius * 0.7071, py + y * playerRadius * 0.7071];
};

function shortestAngleDelta(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function smoothTargetPos(state, pos, desiredPos, delta) {
  if (!desiredPos) return state.smoothedTargetAngle ?? 0;

  if (desiredPos[0] === pos[0] && desiredPos[1] === pos[1])
    return state.smoothedTargetAngle;

  const desiredAngle = Math.atan2(
    desiredPos[1] - pos[1],
    desiredPos[0] - pos[0],
  );

  // First frame: snap to target
  if (state.smoothedTargetAngle == null) {
    state.smoothedTargetAngle = desiredAngle;
    state.smoothedTargetAngularVel = 0;
    return desiredAngle;
  }

  const prevAngle = state.smoothedTargetAngle;
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

  state.smoothedTargetAngle = wrapped;
  state.smoothedTargetAngularVel = vel;

  return wrapped;
}

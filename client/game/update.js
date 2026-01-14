import { newObstaclePreview } from "./arena.js";
import { registerTarget } from "./hitreg.js";
import { moveAlongPath, planPath } from "./pathing.js";

export const update = (game, app, delta, team1, team2) => {
  if (game.previewingObstacle) return;

  if (game.choosingObstacle) return newObstaclePreview(game, app.socket);

  game.path = [];
  if (!game.playerIsDead) updatePlayerPosition(game, delta);
  updateGlobalPositions(game, delta);

  game.team1Lights = new Map();
  game.team2Lights = new Map();
  if (game.lightGraph) {
    if (!game.playerIsDead) updatePlayerLight(game, team1);
    updateGlobalLights(game, team1);

    if (!game.playerIsDead) updatePlayerAim(game, team1, delta);
    updateGlboalAim(game, team1, delta);
  }

  game.virtualServer.shots.forEach(
    (shot) => shot.finished && (shot.anim = (shot.anim ?? -delta) + delta)
  );
};

const updatePlayerPosition = (game, delta) => {
  let step = game.moveSpeed * game.playerRadius * delta;
  if (game.keyboard.shift) step /= 1.5;
  if (game.keyboard.ctrl) step /= 2;
  const target = getPlayerPathTarget(game);
  game.path = planPath(game, game.playerPosition, target);
  if (!game.preRound) moveAlongPath(game.playerPosition, game.path, step);
};

const getPlayerPathTarget = (game) => {
  if (!game.mouse.isClicking) return game.mouse;
  const [px, py] = game.playerPosition;
  const [mx, my] = game.mouse;
  const dx = mx - px;
  const dy = my - py;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [px, py];
  const maxDist = 1 * playerRadius;
  const dist = Math.min(maxDist, d);
  return [px + (dx / d) * dist, py + (dy / d) * dist];
};

const updateGlobalPositions = (game, delta) => {
  const { moveSpeed, playerRadius } = game;
  for (const state of game.virtualServer.globalStates.values()) {
    if (!state.seen) {
      state.interp = false;
      state.seen = true;
      continue;
    }
    state.interp = true;
    let step = moveSpeed * playerRadius * delta;
    moveAlongPath(state.position, state.path, step);
  }
};

const updatePlayerLight = (game, team1) => {
  game.playerLight = game.lightGraph.shineAt(game.playerPosition);
  game.playerLight.push(game.playerPosition);
  if (team1.has(game.userId))
    game.team1Lights.set(game.userId, game.playerLight);
  else game.team2Lights.set(game.userId, game.playerLight);
};

const updateGlobalLights = (game, team1) => {
  for (const [uuid, state] of game.virtualServer.globalStates) {
    const light = state.interp
      ? game.lightGraph.shineAt(state.position)
      : state.light;

    light.push(state.position);
    if (team1.has(uuid)) game.team1Lights.set(uuid, light);
    else game.team2Lights.set(uuid, light);
  }
};

const updatePlayerAim = (game, team1, delta) => {
  const team1Target = [...game.team1Lights.values()];
  const team2Target = [...game.team2Lights.values()];

  const isTeam1 = team1.has(game.userId);
  const shooter = isTeam1
    ? game.team1Lights.get(game.userId)
    : game.team2Lights.get(game.userId);
  const enemies = isTeam1 ? team2Target : team1Target;

  const rawTarget = registerTarget(shooter, enemies, game.playerRadius);

  if (!rawTarget) {
    const fallBackTarget = game.path[1] || game.mouse;
    const smoothedPos = smoothTargetPos(
      game,
      game.playerPosition,
      fallBackTarget,
      delta
    );
    game.playerTarget = [smoothedPos, false];
  } else {
    const [desiredPos, hasAdvantage] = rawTarget;
    const fallBackTarget = desiredPos || game.path[1] || game.mouse;
    const smoothedPos = smoothTargetPos(
      game,
      game.playerPosition,
      fallBackTarget,
      delta
    );
    game.playerTarget = [smoothedPos, hasAdvantage];
  }
};

const updateGlboalAim = (game, team1, delta) => {
  const team1Target = [...game.team1Lights.values()];
  const team2Target = [...game.team2Lights.values()];
  for (const [uuid, state] of game.virtualServer.globalStates) {
    const isTeam1 = team1.has(uuid);
    const shooter = (isTeam1 ? game.team1Lights : game.team2Lights).get(uuid);
    const enemies = isTeam1 ? team2Target : team1Target;

    const rawTarget = registerTarget(shooter, enemies, game.playerRadius);

    if (!rawTarget) {
      const fallBackTarget = state.path[1] || state.position;
      const smoothedPos = smoothTargetPos(
        state,
        state.position,
        fallBackTarget,
        delta
      );
      state.target = [smoothedPos, false];
    } else {
      const [desiredPos, hasAdvantage] = rawTarget;
      const fallBackTarget = desiredPos || state.path[1] || state.position;
      const smoothedPos = smoothTargetPos(
        state,
        state.position,
        fallBackTarget,
        delta
      );
      state.target = [smoothedPos, hasAdvantage];
    }
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
    desiredPos[0] - pos[0]
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

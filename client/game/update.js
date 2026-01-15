import { newObstaclePreview } from "./arena.js";
import { registerTarget } from "./hitreg.js";
import { moveAlongPath, planPath } from "./pathing.js";

export const update = (game, app, delta, team1) => {
  if (game.previewingObstacle) return;
  if (game.choosingObstacle) return newObstaclePreview(game, app.socket);

  game.team1Lights = new Map();
  game.team2Lights = new Map();
  game.path = [];

  if (!game.playerIsDead) updatePlayerPosition(game, delta);
  updateGlobalPositions(game, delta);

  if (game.lightGraph) {
    if (!game.playerIsDead) updatePlayerLight(game, team1);
    updateGlobalLights(game, team1);

    if (!game.playerIsDead) updatePlayerAim(game, delta);
    updateGlobalAim(game, team1, delta);
  }

  updateShots(game, delta);
};

const updatePlayerPosition = (game, delta) => {
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
  if (!game.mouse.isClicking) return game.mouse;
  const [px, py] = game.playerPosition;
  const [mx, my] = game.mouse;
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

  let x = d - a;
  let y = w - s;

  if (x === 0 && y === 0) return [px, py];
  const len = Math.hypot(x, y);
  x /= len;
  y /= len;
  return [px + (x * playerRadius) / 2, py + (y * playerRadius) / 2];
};

const updateGlobalPositions = (game, delta) => {
  const { moveSpeed, playerRadius } = game;
  for (const state of game.virtualServer.globalStates.values()) {
    // vServer sets seen to false when state is new
    state.interp = state.seen;
    state.seen = true;
    if (!state.interp) return;
    const step = moveSpeed * playerRadius * delta;
    moveAlongPath(state.position, state.path, step);
  }
};

const updatePlayerLight = (game, team1) => {
  game.playerLight = game.lightGraph.shineAt(game.playerPosition);
  game.playerLight.push(game.playerPosition);
  const teamLight = game.isTeam1 ? game.team1Lights : game.team2Lights;
  teamLight.set(game.userId, game.playerLight);
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

const updatePlayerAim = (game, delta) => {
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

const updateShots = (game, delta) => {
  game.virtualServer.shots.forEach((shot) => {
    if (shot.finished) return;
    if (shot.anim == null) shot.anim = 0;
    else shot.anim += delta;
  });
};

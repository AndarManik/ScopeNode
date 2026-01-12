import { newObstaclePreview } from "./arena.js";
import { registerTarget } from "./hitreg.js";
import { moveAlongPath, planPath } from "./pathing.js";

export const update = (game, app, delta, team1, team2) => {
  if (game.previewingObstacle) return;
  if (game.choosingObstacle) return newObstaclePreview(game, app.socket);

  const { moveSpeed, playerRadius } = game;
  game.path = [];
  if (!game.playerIsDead) {
    let target;

    if (!game.mouse.isClicking) target = game.mouse;
    else {
      const [px, py] = game.playerPosition;
      const [mx, my] = game.mouse;

      const dx = mx - px;
      const dy = my - py;
      const d = Math.hypot(dx, dy);

      if (d === 0) target = [px, py];
      else {
        const maxDist = 1 * playerRadius;
        const dist = Math.min(maxDist, d);

        target = [px + (dx / d) * dist, py + (dy / d) * dist];
      }
    }

    game.path = planPath(game, game.playerPosition, target);
    let step = moveSpeed * playerRadius * delta;
    if (game.keyboard.shift) step /= 1.5;
    if (game.keyboard.ctrl) step /= 2;
    if (!game.preRound) moveAlongPath(game.playerPosition, game.path, step);
  }

  for (const [_, state] of game.virtualServer.globalStates) {
    if (state.seen) {
      state.interp = true;
      let step = moveSpeed * playerRadius * delta;
      moveAlongPath(state.position, state.path, step);
    } else {
      state.interp = false;
      state.seen = true;
    }
  }

  if (game.lightGraph) {
    game.team1Lights = new Map();
    game.team2Lights = new Map();
    for (const [uuid, state] of game.virtualServer.globalStates) {
      const light = state.interp
        ? game.lightGraph.shineAt(state.position)
        : state.light;

      light.push(state.position);
      if (team1.has(uuid)) game.team1Lights.set(uuid, light);
      else game.team2Lights.set(uuid, light);
    }

    if (!game.playerIsDead) {
      game.playerLight = game.lightGraph.shineAt(game.playerPosition);
      game.playerLight.push(game.playerPosition);
      if (team1.has(game.userId))
        game.team1Lights.set(game.userId, game.playerLight);
      else game.team2Lights.set(game.userId, game.playerLight);
    }

    const team1Target = [...game.team1Lights.values()];
    const team2Target = [...game.team2Lights.values()];

    for (const [uuid, state] of game.virtualServer.globalStates) {
      const isTeam1 = team1.has(uuid);
      const shooter = (isTeam1 ? game.team1Lights : game.team2Lights).get(uuid);
      const enemies = isTeam1 ? team2Target : team1Target;

      const rawTarget = registerTarget(shooter, enemies, playerRadius);
      // rawTarget is either undefined/null or [[x, y], bool]

      if (!rawTarget) {
        // No target: clear smoothing and unset
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
        // Keep the bool as-is, smooth only the position
        state.target = [smoothedPos, hasAdvantage];
      }
    }

    if (!game.playerIsDead) {
      const isTeam1 = team1.has(game.userId);
      const shooter = isTeam1
        ? game.team1Lights.get(game.userId)
        : game.team2Lights.get(game.userId);
      const enemies = isTeam1 ? team2Target : team1Target;

      const rawTarget = registerTarget(shooter, enemies, playerRadius);

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
    }
  }

  for (const shot of game.virtualServer.shots) {
    if (shot.finished) continue;
    else shot.anim = (shot.anim ?? -delta) + delta;
  }
};

function shortestAngleDelta(target, current) {
  let diff = target - current;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  else if (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function smoothTargetPos(state, pos, desiredPos, delta) {
  if (!desiredPos) return state._smoothedTargetAngle ?? 0;

  if (desiredPos[0] === pos[0] && desiredPos[1] === pos[1])
    return state._smoothedTargetAngle;

  // Desired direction from current position to target
  const desiredAngle = Math.atan2(
    desiredPos[1] - pos[1],
    desiredPos[0] - pos[0]
  );

  // Initialize on first use
  if (state._smoothedTargetAngle == null) {
    state._smoothedTargetAngle = desiredAngle;
    state._smoothedTargetAngularVel = 0;
    return desiredAngle;
  }

  let angle = state._smoothedTargetAngle;
  let vel = state._smoothedTargetAngularVel || 0;

  // Critically damped spring in 1D (angle space)
  const stiffness = 1000; // tweak to taste
  const damping = 2 * Math.sqrt(stiffness);

  const error = shortestAngleDelta(desiredAngle, angle);

  vel += (error * stiffness - vel * damping) * delta;

  angle += vel * delta;

  // Keep angle in [-PI, PI] for stability
  if (angle > Math.PI) angle -= 2 * Math.PI;
  else if (angle < -Math.PI) angle += 2 * Math.PI;

  state._smoothedTargetAngle = angle;
  state._smoothedTargetAngularVel = vel;

  return angle;
}

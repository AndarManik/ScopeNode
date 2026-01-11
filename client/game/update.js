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
        clearTargetSmoothing(state);
        state.target = undefined;
      } else {
        const [desiredPos, hasAdvantage] = rawTarget;
        const smoothedPos = smoothTargetPos(state, desiredPos, delta);
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
        clearTargetSmoothing(game); // use same helper, works on any object
        game.playerTarget = undefined;
      } else {
        const [desiredPos, hasAdvantage] = rawTarget;
        const smoothedPos = smoothTargetPos(game, desiredPos, delta);
        game.playerTarget = [smoothedPos, hasAdvantage];
      }
    }
  }

  for (const shot of game.virtualServer.shots) {
    if (shot.finished) continue;
    else shot.anim = (shot.anim ?? -delta) + delta;
  }
};

function smoothTargetPos(state, desiredPos, delta) {
  if (!desiredPos) return desiredPos;
  // Initialize on first use
  if (!state._smoothedTargetPos) {
    state._smoothedTargetPos = [...desiredPos];
    state._smoothedTargetVel = [0, 0];
    return state._smoothedTargetPos;
  }

  const pos = state._smoothedTargetPos;
  const vel = state._smoothedTargetVel;

  // Spring parameters (tweak to taste)
  // Higher stiffness = faster response; keep damping = 2*sqrt(stiffness) for critical damping
  const stiffness = 300; // 1/s^2
  const damping = 2 * Math.sqrt(stiffness);

  const dx = desiredPos[0] - pos[0];
  const dy = desiredPos[1] - pos[1];

  // Critically damped spring
  vel[0] += (dx * stiffness - vel[0] * damping) * delta;
  vel[1] += (dy * stiffness - vel[1] * damping) * delta;

  pos[0] += vel[0] * delta;
  pos[1] += vel[1] * delta;

  return pos;
}

function clearTargetSmoothing(state) {
  state._smoothedTargetPos = undefined;
  state._smoothedTargetVel = undefined;
}

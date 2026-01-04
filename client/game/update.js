import { newObstaclePreview } from "./arena.js";
import { registerTarget } from "./hitreg.js";
import { moveAlongPath, planPath } from "./pathing.js";

export const update = (game, app, delta, team1, team2) => {
  if (game.previewingObstacle) return;
  if (game.choosingObstacle) newObstaclePreview(game, app.socket);

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
    if (!state.seen) {
      state.seen = true;
      state.iPosition = [...state.position];
      state.iPath = [...state.path];
    } else {
      state.interp = true;
      let step = moveSpeed * playerRadius * delta;
      moveAlongPath(state.iPosition, state.iPath, step);
    }
  }

  if (game.lightGraph) {
    game.team1Lights = new Map();
    game.team2Lights = new Map();
    for (const [uuid, state] of game.virtualServer.globalStates) {
      const light = state.interp
        ? game.lightGraph.shineAt(state.iPosition)
        : state.light;

      light.push(state.iPosition);
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
      state.target = registerTarget(shooter, enemies, playerRadius);
    }
    if (!game.playerIsDead) {
      const isTeam1 = team1.has(game.userId);
      const shooter = isTeam1
        ? game.team1Lights.get(game.userId)
        : game.team2Lights.get(game.userId);
      const enemies = isTeam1 ? team2Target : team1Target;
      game.playerTarget = registerTarget(shooter, enemies, playerRadius);
    }
  }

  for (const shot of game.virtualServer.shots) {
    if (shot.finished) continue;
    else shot.anim = (shot.anim ?? -delta) + delta;
  }
};

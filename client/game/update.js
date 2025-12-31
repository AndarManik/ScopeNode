import { moveAlongPath, planPath } from "./pathing.js";

export const update = (game, delta) => {
  if (game.previewingObstacle) return;

  if (game.choosingObstacle) game.obstacleSendingLoop();

  const { moveSpeed, playerRadius } = game;
  game.path = [];

  if (!game.playerIsDead) {
    let target;

    if (!game.mouse.isClicking) {
      target = game.mouse;
    } else {
      const [px, py] = game.playerPosition;
      const [mx, my] = game.mouse;

      const dx = mx - px;
      const dy = my - py;
      const d = Math.hypot(dx, dy);

      if (d === 0) {
        target = [px, py];
      } else {
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

  for (const state of game.virtualServer.globalStates.values()) {
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

  for (const shot of game.virtualServer.shots) {
    if (shot.finished) continue;
    else shot.anim = (shot.anim ?? -delta) + delta;
  }
};

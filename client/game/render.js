import { createTeamsVisionRenderer } from "./lightrendering.js";

export const render = (game, team1, team2) => {
  const { renderSettings, color, mapWidth, mapHeight, playerRadius } = game;
  if (game.scale !== renderSettings.scale) {
    game.scale = renderSettings.scale;
    game.canvas = newGameCanvas(game.scale, mapWidth, mapHeight);
    game.lightRenderer = createTeamsVisionRenderer(
      game.canvas.ctx,
      mapWidth,
      mapHeight,
      game.scale
    );
  }

  // canvas might change underneath so you can't take this out of render
  const ctx = game.canvas.ctx;

  // clear screen
  ctx.fillStyle = color.background;
  ctx.beginPath();
  ctx.rect(0, 0, mapWidth, mapHeight);
  ctx.fill();

  // draw obstacles
  let colorIndex = 0;
  if (game.obstacleRenderGroups) {
    for (const group of game.obstacleRenderGroups) {
      ctx.fillStyle = color.obstacleColor(colorIndex++);
      ctx.beginPath();

      for (const poly of group) {
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let k = 1; k < poly.length; k++)
          ctx.lineTo(poly[k][0], poly[k][1]);
        ctx.closePath();
      }

      ctx.fill("nonzero");
    }
  }

  // draw team lights
  if (game.lightGraph) {
    const team1Lights = [...game.virtualServer.globalStates.entries()]
      .filter(([uuid]) => team1.has(uuid))
      .map(([_, state]) => {
        if (!state.interp) return state.light;
        else return game.lightGraph.shineAt(state.iPosition);
      });

    const team2Lights = [...game.virtualServer.globalStates.entries()]
      .filter(([uuid]) => team2.has(uuid))
      .map(([_, state]) => {
        if (!state.interp) return state.light;
        else return game.lightGraph.shineAt(state.iPosition);
      });

    if (!game.playerIsDead) {
      game.playerLight = game.lightGraph.shineAt(game.playerPosition);
      if (game.isTeam1) team1Lights.push(game.playerLight);
      else team2Lights.push(game.playerLight);
    }

    game.lightRenderer(team1Lights, team2Lights, color);
  }

  // mouse position

  ctx.fillStyle = game.isTeam1 ? color.team1Path : color.team2Path;
  ctx.beginPath();
  ctx.arc(game.mouse[0], game.mouse[1], playerRadius / 5, 0, Math.PI * 2);
  ctx.fill();

  // draw player
  if (!game.playerIsDead) {
    // draw player path
    let alpha = 0;

    if (game.path.length > 1) {
      let length = 0;

      // accumulate polyline length
      for (let i = 1; i < game.path.length; i++) {
        const dx = game.path[i][0] - game.path[i - 1][0];
        const dy = game.path[i][1] - game.path[i - 1][1];
        length += Math.hypot(dx, dy);
      }

      const NEAR = 0; // path length where alpha is minimal
      const FAR = playerRadius * 8.0; // path length where alpha is maximal

      let t = (length - NEAR) / (FAR - NEAR);
      t = Math.min(1, Math.max(0, t));

      // same cubic ease-in-out you were using
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const MIN_ALPHA = 0;
      const MAX_ALPHA = 0.7;
      alpha = MIN_ALPHA + t * (MAX_ALPHA - MIN_ALPHA);
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    const pathWidth = 5;
    ctx.strokeStyle = game.isTeam1 ? color.team1Path : color.team2Path;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = (2 * playerRadius) / pathWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const dash = 2 * playerRadius - (2 * playerRadius) / pathWidth;
    const gap = 2 * playerRadius + (2 * playerRadius) / pathWidth;
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = (2 * (gap + dash)) / pathWidth;

    // path
    ctx.beginPath();
    game.path.forEach((v) => ctx.lineTo(v[0], v[1]));
    ctx.stroke();

    // final position
    if (game.path.length) {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      ctx.arc(
        game.path[game.path.length - 1][0],
        game.path[game.path.length - 1][1],
        playerRadius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();

    // draw player
    ctx.lineWidth = (2 * playerRadius) / 2.5;

    ctx.strokeStyle = game.isTeam1 ? color.team1Player : color.team2Player;
    ctx.beginPath();
    ctx.arc(
      ...game.playerPosition,
      playerRadius - playerRadius / 2.5,
      0,
      Math.PI * 2
    ); // full circle
    ctx.stroke();
  }

  //draw objective
  ctx.fillStyle = color.centerObjective;
  ctx.beginPath();
  ctx.arc(...game.centerObjective, playerRadius, 0, Math.PI * 2); // full circle
  ctx.fill();

  ctx.lineWidth = (2 * playerRadius) / 2.5;

  for (const [uuid, state] of game.virtualServer.globalStates.entries()) {
    // draw global players
    ctx.strokeStyle = team1.has(uuid) ? color.team1Player : color.team2Player;
    ctx.beginPath();
    ctx.arc(
      ...(state.iPosition || state.position),
      playerRadius - playerRadius / 2.5,
      0,
      Math.PI * 2
    ); // full circle
    ctx.stroke();
  }

  // render shot
  game.virtualServer.shots.forEach(
    ({ team1, killerPosition, killedPosition, hit }) => {
      ctx.strokeStyle = team1 ? color.team1Player : color.team2Player;
      ctx.lineWidth = (2 * playerRadius) / 5;
      ctx.beginPath();
      ctx.moveTo(...killerPosition);
      ctx.lineTo(...hit);
      ctx.stroke();

      ctx.lineWidth = (2 * playerRadius) / 2.5;
      ctx.strokeStyle = team1 ? color.team1Player : color.team2Player;
      ctx.beginPath();
      ctx.arc(
        ...killerPosition,
        playerRadius - playerRadius / 2.5,
        0,
        Math.PI * 2
      ); // full circle
      ctx.stroke();

      ctx.strokeStyle = team1 ? color.team2Player : color.team1Player;
      ctx.beginPath();
      ctx.arc(
        ...killedPosition,
        playerRadius - playerRadius / 2.5,
        0,
        Math.PI * 2
      ); // full circle
      ctx.stroke();
    }
  );
};

const newGameCanvas = (scale, mapWidth, mapHeight) => {
  const canvas = document.getElementById("Game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = "low";
  canvas.width = mapWidth * scale;
  canvas.height = mapHeight * scale;
  canvas.ctx = ctx;
  ctx.scale(scale, scale);
  return canvas;
};

import { createBulletWarpPostFX } from "./bulletwarp.js";
import { createTeamsVisionRenderer } from "./lightrendering.js";
import { animateShot } from "./shootanimation.js";

export const render = (game, team1, team2) => {
  const { renderSettings, color, mapWidth, mapHeight, playerRadius } = game;
  if (game.scale !== renderSettings.scale || !game.sceneCtx || !game.warpFX) {
    newGameCanvases(game, renderSettings.scale, mapWidth, mapHeight);

    game.lightRenderer = createTeamsVisionRenderer(
      game.sceneCtx,
      mapWidth,
      mapHeight,
      game.scale
    );
  }

  // canvas might change underneath so you can't take this out of render
  const ctx = game.sceneCtx;

  // clear screen
  ctx.fillStyle = color.background;
  ctx.beginPath();
  ctx.rect(0, 0, mapWidth, mapHeight);
  ctx.fill();

  // draw obstacles
  let colorIndex = 0;
  if (game.obstacleRenderGroups) {
    for (const group of game.obstacleRenderGroups) {
      ctx.fillStyle =
        game.choosingObstacle || game.previewingObstacle
          ? color.obstacleColorBrilliant(colorIndex++)
          : color.obstacleColor(colorIndex++);
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

  if (game.choosingObstacle || game.previewingObstacle) {
    ctx.fillStyle = color.obstacleColorBrilliant(game.previewObstacle.index);
    ctx.beginPath();

    const { poly } = game.previewObstacle;
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
    ctx.closePath();

    ctx.fill("nonzero");

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const { previewPoly } = game.previewObstacle;
    ctx.moveTo(previewPoly[0][0], previewPoly[0][1]);
    for (let k = 1; k < previewPoly.length; k++)
      ctx.lineTo(previewPoly[k][0], previewPoly[k][1]);
    ctx.closePath();

    ctx.fill("nonzero");
    ctx.restore();

    ctx.fillStyle = color.centerObjective;
    ctx.beginPath();
    ctx.arc(...game.centerObjective, playerRadius, 0, Math.PI * 2); // full circle
    ctx.fill();

    ctx.fillStyle = color.team1Player;
    ctx.beginPath();
    ctx.arc(...game.spawn1, playerRadius, 0, Math.PI * 2); // full circle
    ctx.fill();

    ctx.fillStyle = color.team2Player;
    ctx.beginPath();
    ctx.arc(...game.spawn2, playerRadius, 0, Math.PI * 2); // full circle
    ctx.fill();

    game.virtualServer.shots.forEach(
      ({ team1, killerPosition, killedPosition, hit }) => {
        ctx.strokeStyle = team1 ? color.team1Player : color.team2Player;
        ctx.lineWidth = (2 * playerRadius) / 5;
        ctx.beginPath();
        ctx.moveTo(...killerPosition);
        ctx.lineTo(...hit);
        ctx.stroke();

        ctx.fillStyle = team1 ? color.team1Player : color.team2Player;
        ctx.beginPath();
        ctx.arc(...killerPosition, playerRadius, 0, Math.PI * 2); // full circle
        ctx.fill();

        ctx.fillStyle = team1 ? color.team2Player : color.team1Player;
        ctx.beginPath();
        ctx.arc(...killedPosition, playerRadius, 0, Math.PI * 2); // full circle
        ctx.fill();
      }
    );

    game.warpFX.render({
      pointsPx: [],
    });
    return;
  }

  // draw team lights
  if (game.lightGraph) {
    game.lightRenderer(
      [...game.team1Lights.values()],
      [...game.team2Lights.values()],
      color
    );
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
    const target = game.playerTarget?.[0] || game.path[1] || game.mouse;
    const hasAdvantage = game.playerTarget?.[1] ?? false;
    // Base colors
    const playerColor = game.isTeam1 ? color.team1Player : color.team2Player;
    const gunColorNormal = game.isTeam1 ? color.team2Gun : color.team1Gun;
    const gunColorSwapped = game.isTeam1 ? color.team1Gun : color.team2Gun;
    // Swap gun color only when NO advantage
    const gunColor = hasAdvantage ? gunColorNormal : gunColorSwapped;
    drawPlayer(
      ctx,
      game.playerPosition,
      playerRadius,
      playerColor,
      gunColor,
      Math.atan2(
        target[1] - game.playerPosition[1],
        target[0] - game.playerPosition[0]
      )
    );
  }

  for (const [uuid, state] of game.virtualServer.globalStates.entries()) {
    const isTeam1 = team1.has(uuid);

    // Target + advantage (same semantics as local player)
    const target = state.target?.[0] || state.iPath[1] || state.iPosition;
    const hasAdvantage = state.target?.[1] ?? false;

    // Base colors
    const playerColor = isTeam1 ? color.team1Player : color.team2Player;
    const gunColorNormal = isTeam1 ? color.team2Gun : color.team1Gun;
    const gunColorSwapped = isTeam1 ? color.team1Gun : color.team2Gun;

    // Swap gun color only when NO advantage
    const gunColor = hasAdvantage ? gunColorNormal : gunColorSwapped;

    drawPlayer(
      ctx,
      state.iPosition,
      playerRadius,
      playerColor,
      gunColor,
      Math.atan2(target[1] - state.iPosition[1], target[0] - state.iPosition[0])
    );
  }

  //draw objective
  const time = (performance.now() - game.virtualServer.startTime) / 1000;
  const timeAlpha = Math.max(0, (time - 30) / 30) ** 3; // 3 second count in
  const timeBeta = 1 - timeAlpha;
  const obstacleRadius =
    timeBeta * playerRadius + timeAlpha * Math.hypot(mapWidth, mapHeight);

  if (obstacleRadius === playerRadius) {
    ctx.fillStyle = color.centerObjective;
    ctx.beginPath();
    ctx.arc(...game.centerObjective, playerRadius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = playerRadius * 2;
    ctx.strokeStyle = color.centerObjective;
    ctx.beginPath();
    ctx.arc(
      ...game.centerObjective,
      obstacleRadius - playerRadius,
      0,
      Math.PI * 2
    ); // full circle
    ctx.stroke();
  }

  // render shot
  const s = game.scale;
  const bullets = [];
  [...game.virtualServer.shots].forEach((shot) => {
    const bullet = animateShot(game, ctx, shot, s);
    if (bullet) bullets.push(bullet[1]);
  });

  // --- Post-process warp to ON-SCREEN WebGL canvas ---
  game.warpFX.render({
    pointsPx: bullets,
    ampPx: 0.25 * playerRadius * s, // tune: pixels
    sigmaPx: 100 * playerRadius * s, // tune: pixels
  });
};

const newGameCanvases = (game, scale, mapWidth, mapHeight) => {
  // On-screen output canvas is still #Game, but it becomes WebGL.
  const output = document.getElementById("Game");
  output.width = mapWidth * scale;
  output.height = mapHeight * scale;

  // Offscreen scene canvas: 2D, scaled like your current setup
  const scene = document.createElement("canvas");
  scene.width = mapWidth * scale;
  scene.height = mapHeight * scale;

  const ctx = scene.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = "low";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(scale, scale);

  // Build warp FX (post-process)
  const warpFX = createBulletWarpPostFX({
    sourceCanvas: scene,
    outputCanvas: output,
    maxPoints: 32,
  });

  game.sceneCanvas = scene;
  game.sceneCtx = ctx;
  game.outputCanvas = output;
  game.warpFX = warpFX;
  game.scale = scale;

  return { scene, ctx, output };
};

export const drawPlayer = (
  ctx,
  [cx, cy],
  playerRadius,
  color,
  gun,
  angle = 0,
  sliceFrac = 0.2
) => {
  // Background (gun)
  ctx.fillStyle = gun;
  ctx.beginPath();
  ctx.arc(cx, cy, playerRadius, 0, 2 * Math.PI);
  ctx.fill();

  // Clamp
  sliceFrac = Math.max(0, Math.min(1, sliceFrac));

  const r = playerRadius;

  // Half-thickness of removed strip in local coordinates (diameter = 2r)
  const w = sliceFrac * r;

  // If no cut -> full circle body + outline
  if (w <= 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Curvy bit (rotated)
    const strokeR = r - r / 2.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.lineWidth = (2 * r) / 2.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, strokeR, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // If cut removes everything -> draw nothing (gun already drawn)
  if (w >= r) return;

  // In local frame where removed strip is -w <= y <= w:
  // Circle intersections with y = ±w occur at x = ±sqrt(r^2 - w^2)
  const x = Math.sqrt(r * r - w * w);

  // Angle to intersection point on circle: sin(alpha) = w / r
  const alpha = Math.asin(w / r);

  // Body fill (two caps) in rotated local frame
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.fillStyle = color;

  // 1) Top cap (y >= +w)
  ctx.beginPath();
  ctx.arc(0, 0, r, alpha, Math.PI - alpha, false); // CCW
  ctx.lineTo(x, w);
  ctx.closePath();
  ctx.fill();

  // 2) Bottom cap (y <= -w)
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI + alpha, 2 * Math.PI - alpha, false); // CCW
  ctx.lineTo(-x, -w);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // ----------------------------------------------------
  // Curvy bit (rotated with angle) — draws left semicircle
  // ----------------------------------------------------
  const strokeR = r - r * 2 * sliceFrac;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.lineWidth = 4 * r * sliceFrac;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, strokeR, Math.PI / 2, (3 * Math.PI) / 2); // left half in local frame
  ctx.stroke();

  ctx.restore();
};

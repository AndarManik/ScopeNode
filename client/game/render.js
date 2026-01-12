import { createBulletWarpPostFX } from "./bulletwarp.js";
import { createTeamsVisionRenderer } from "./lightrendering.js";
import { createPlayerRenderer } from "./playerrendering.js";
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

    Object.assign(
      game,
      createPlayerRenderer(game.sceneCtx, mapWidth, mapHeight, game.scale)
    );
  }

  game.color.intersectPoint = game.isTeam1
    ? game.color.intersectPoint1
    : game.color.intersectPoint2;

  // canvas might change underneath so you can't take this out of render
  const ctx = game.sceneCtx;

  // clear screen
  ctx.fillStyle = color.background;
  ctx.beginPath();
  ctx.rect(0, 0, mapWidth, mapHeight);
  ctx.fill();

  drawObstacles(game, ctx, color);

  if (game.choosingObstacle || game.previewingObstacle) {
    ctx.fillStyle = color.obstacleColorBrilliant(game.previewObstacle.index);

    ctx.beginPath();
    const { poly } = game.previewObstacle;
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
    ctx.closePath();
    ctx.fill("nonzero");

    if (game.lightGraph) {
      game.obstacles.push(game.previewObstacle);
      game.lightRenderer(
        game,
        [], //[...game.team1Lights.values()],
        [], //[...game.team2Lights.values()],
        color,
        renderSettings.glowEnabled
      );
      game.obstacles.pop();
    }

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

    game.drawPlayer(
      game.spawn1,
      playerRadius,
      color.team1Player,
      color.team1Gun,
      Math.atan2(
        game.spawn2[1] - game.spawn1[1],
        game.spawn2[0] - game.spawn1[0]
      ),
      renderSettings.glowEnabled
        ? {
            glowRadius: playerRadius / 1.25,
            glowColor: color.team1Disk,
            composite: "hard-light",
          }
        : null
    );

    ctx.fillStyle = color.centerObjective;
    ctx.beginPath();
    ctx.arc(...game.centerObjective, playerRadius, 0, Math.PI * 2); // full circle
    ctx.fill();

    game.drawPlayer(
      game.spawn2,
      playerRadius,
      color.team2Player,
      color.team2Gun,
      Math.atan2(
        game.spawn1[1] - game.spawn2[1],
        game.spawn1[0] - game.spawn2[0]
      ),
      renderSettings.glowEnabled
        ? {
            glowRadius: playerRadius / 1.25,
            glowColor: color.team2Disk,
            composite: "hard-light",
          }
        : null
    );

    game.virtualServer.shots.forEach(
      ({ team1, killerPosition, killedPosition, hit }) => {
        // ---------------------------------------
        // Killer: aims at the hit point
        // ---------------------------------------
        const killerBodyColor = team1 ? color.team1Player : color.team2Player;
        const killerGunColor = team1 ? color.team1Gun : color.team2Gun;
        const killerGlowColor = team1 ? color.team1Disk : color.team2Disk;

        const killerAngle = Math.atan2(
          hit[1] - killerPosition[1],
          hit[0] - killerPosition[0]
        );

        game.drawPlayer(
          killerPosition,
          playerRadius,
          killerBodyColor,
          killerGunColor,
          killerAngle,
          renderSettings.glowEnabled
            ? {
                glowRadius: playerRadius / 1.25,
                glowColor: killerGlowColor,
                composite: "hard-light",
              }
            : null
        );

        // ---------------------------------------
        // Killed: aims at the killer
        // ---------------------------------------
        const killedBodyColor = team1 ? color.team2Player : color.team1Player;
        const killedGunColor = team1 ? color.team2Gun : color.team1Gun;
        const killedGlowColor = team1 ? color.team2Disk : color.team1Disk;

        const killedAngle = Math.atan2(
          killerPosition[1] - killedPosition[1],
          killerPosition[0] - killedPosition[0]
        );

        game.drawPlayer(
          killedPosition,
          playerRadius,
          killedBodyColor,
          killedGunColor,
          killedAngle,
          renderSettings.glowEnabled
            ? {
                glowRadius: playerRadius / 1.25,
                glowColor: killedGlowColor,
                composite: "hard-light",
              }
            : null
        );

        // draw the shot line
        ctx.strokeStyle = team1 ? color.team1Gun : color.team2Gun;
        ctx.lineWidth = (2 * playerRadius) / 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(...killerPosition);
        ctx.lineTo(...hit);
        ctx.stroke();
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
      game,
      [...game.team1Lights.values()],
      [...game.team2Lights.values()],
      color,
      renderSettings.glowEnabled
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
    const target = game.playerTarget[0];
    const hasAdvantage = game.playerTarget[1];
    // Base colors
    const playerColor = game.isTeam1 ? color.team1Player : color.team2Player;
    const gunColorNormal = game.isTeam1 ? color.team1Gun : color.team2Gun;
    const gunColorSwapped = game.isTeam1 ? color.team2Gun : color.team1Gun;

    // Swap gun color only when NO advantage
    const gunColor = hasAdvantage ? gunColorSwapped : gunColorNormal;

    const glowColorNormal = game.isTeam1 ? color.team1Disk : color.team2Disk;
    const glowColorSwapped = game.isTeam1 ? color.team2Disk : color.team1Disk;
    const glowColor = hasAdvantage ? glowColorSwapped : glowColorNormal;

    game.drawPlayer(
      game.playerPosition,
      playerRadius,
      playerColor,
      gunColor,
      target,
      renderSettings.glowEnabled
        ? {
            glowRadius: playerRadius / 1.25,
            glowColor: glowColor,
            composite: "hard-light",
          }
        : null
    );
  }

  for (const [uuid, state] of game.virtualServer.globalStates.entries()) {
    const isTeam1 = team1.has(uuid);

    // Target + advantage (same semantics as local player)
    const target = state.target[0];
    const hasAdvantage = state.target[1];

    // Base colors
    const playerColor = isTeam1 ? color.team1Player : color.team2Player;
    const gunColorNormal = isTeam1 ? color.team1Gun : color.team2Gun;
    const gunColorSwapped = isTeam1 ? color.team2Gun : color.team1Gun;

    // Swap gun color only when NO advantage
    const gunColor = hasAdvantage ? gunColorSwapped : gunColorNormal;

    const glowColorNormal = isTeam1 ? color.team1Disk : color.team2Disk;
    const glowColorSwapped = isTeam1 ? color.team2Disk : color.team1Disk;
    const glowColor = hasAdvantage ? glowColorSwapped : glowColorNormal;

    game.drawPlayer(
      state.position,
      playerRadius,
      playerColor,
      gunColor,
      target,
      renderSettings.glowEnabled
        ? {
            glowRadius: playerRadius / 1.25,
            glowColor: glowColor,
            composite: "hard-light",
          }
        : null
    );
  }

  //draw objective
  const time = (performance.now() - game.virtualServer.startTime) / 1000;
  const timeAlpha = Math.max(0, (time - 30) / 30) ** 3; // 3 second count in
  game.drawObjective(
    game,
    timeAlpha,
    playerRadius,
    mapWidth,
    mapHeight,
    color.centerObjective,
    renderSettings.glowEnabled
      ? {
          glowRadius: playerRadius / 1.25,
          glowColor: color.objectiveDisk,
          composite: "hard-light",
        }
      : null // glowColor defaults to color.centerObjective
  );

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

const drawObstacles = (game, ctx, color) => {
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
};

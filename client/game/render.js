import { createBulletWarpPostFX } from "./bulletwarp.js";
import { createTeamsVisionRenderer } from "./lightrendering.js";
import { filletPolyline } from "./pathsmoothing.js";
import { createPlayerRenderer } from "./playerrendering.js";
import { animateShot } from "./shootanimation.js";

export const render = (game, team1, team2) => {
  const { renderSettings, color, mapWidth, mapHeight, playerRadius } = game;

  let isTeam1 = game.isTeam1;
  let team1Lights = game.team1Lights;
  let team2Lights = game.team2Lights;
  ({ team1, isTeam1, team1Lights, team2Lights } = applyXSwap(
    game,
    team1,
    team2,
    isTeam1,
  ));

  ensureSceneCanvases(game, renderSettings, mapWidth, mapHeight);

  game.color.intersectPoint = isTeam1
    ? game.color.intersectPoint1
    : game.color.intersectPoint2;

  const ctx = game.sceneCtx;

  clearScene(ctx, color, mapWidth, mapHeight);
  drawObstacles(game, ctx, color);

  if (game.choosingObstacle || game.previewingObstacle) {
    renderObstaclePreviewScene(game, ctx, color, renderSettings, playerRadius);
    return;
  }

  renderTeamLights(game, team1Lights, team2Lights, color, renderSettings);
  renderMouseDot(ctx, game, isTeam1, color, playerRadius);

  if (game.isMultiPlayer) multiPlayerRender(game, ctx, team1, isTeam1);
  else singlePlayerRender(game, ctx, team1, isTeam1);
};

const singlePlayerRender = (game, ctx, team1, isTeam1) => {
  const { color, playerRadius, mapWidth, mapHeight, renderSettings } = game;
  if (!game.playerIsDead) {
    renderPlayerPath(ctx, game, isTeam1, color, playerRadius);
    renderLocalPlayer(game, isTeam1);
  }
  renderBots(game, team1);

  renderObjectiveIfNeeded(
    game,
    color,
    playerRadius,
    mapWidth,
    mapHeight,
    renderSettings,
  );

  renderShotsAndWarp(game, ctx, game.shots, playerRadius);
};

const renderBots = (game, team1) => {
  const { color, playerRadius, renderSettings } = game;

  for (const state of game.bots) {
    const uuid = state.uuid;
    const isTeam1 = team1.has(uuid);

    const target = state.target?.[0];
    const hasAdvantage = state.target?.[1];

    const playerColor = isTeam1 ? color.team1Player : color.team2Player;
    const gunColorNormal = isTeam1 ? color.team1Gun : color.team2Gun;
    const gunColorSwapped = isTeam1 ? color.team2Gun : color.team1Gun;
    const gunColor = !hasAdvantage ? gunColorSwapped : gunColorNormal;

    const glowColorNormal = isTeam1 ? color.team1Disk : color.team2Disk;
    const glowColorSwapped = isTeam1 ? color.team2Disk : color.team1Disk;
    const glowColor = !hasAdvantage ? glowColorSwapped : glowColorNormal;

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
            composite: "screen",
          }
        : null,
    );
  }
};

const multiPlayerRender = (game, ctx, team1, isTeam1) => {
  const { renderSettings, color, mapWidth, mapHeight, playerRadius } = game;
  if (!game.playerIsDead) {
    renderPlayerPath(ctx, game, isTeam1, color, playerRadius);
    renderLocalPlayer(game, isTeam1);
  }

  renderGlobalPlayers(game, team1);
  renderObjectiveIfNeeded(
    game,
    color,
    playerRadius,
    mapWidth,
    mapHeight,
    renderSettings,
  );

  renderShotsAndWarp(game, ctx, game.virtualServer.shots, playerRadius);
};

const applyXSwap = (game, team1, team2, isTeam1) => {
  let team1Lights = game.team1Lights;
  let team2Lights = game.team2Lights;

  if (game.xSwap) {
    team1 = team2;
    isTeam1 = !isTeam1;

    team1Lights = game.team2Lights;
    team2Lights = game.team1Lights;
  }

  return { team1, isTeam1, team1Lights, team2Lights };
};

const ensureSceneCanvases = (game, renderSettings, mapWidth, mapHeight) => {
  if (game.scale === renderSettings.scale && game.sceneCtx && game.warpFX)
    return;

  newGameCanvases(game, renderSettings.scale, mapWidth, mapHeight);

  game.lightRenderer = createTeamsVisionRenderer(
    game.sceneCtx,
    mapWidth,
    mapHeight,
    game.scale,
  );

  Object.assign(
    game,
    createPlayerRenderer(game.sceneCtx, mapWidth, mapHeight, game.scale),
  );
};

const clearScene = (ctx, color, mapWidth, mapHeight) => {
  ctx.fillStyle = color.background;
  ctx.beginPath();
  ctx.rect(0, 0, mapWidth, mapHeight);
  ctx.fill();
};

const renderTeamLights = (
  game,
  team1Lights,
  team2Lights,
  color,
  renderSettings,
) => {
  if (!game.lightGraph) return;

  game.lightRenderer(
    game,
    [...team1Lights.values()],
    [...team2Lights.values()],
    color,
    renderSettings.glowEnabled,
  );
};

const renderMouseDot = (ctx, game, isTeam1, color, playerRadius) => {
  ctx.fillStyle = isTeam1 ? color.team1Path : color.team2Path;
  ctx.beginPath();
  ctx.arc(game.mouse[0], game.mouse[1], playerRadius / 5, 0, Math.PI * 2);
  ctx.fill();
};

function strokeFilletedPath(ctx, points, R) {
  const fp = filletPolyline(points, R);
  if (!fp || fp.segs.length === 0) return;

  ctx.beginPath();
  ctx.moveTo(fp.start[0], fp.start[1]);

  for (const s of fp.segs)
    if (s.type === "line") ctx.lineTo(s.to[0], s.to[1]);
    else ctx.arc(s.c[0], s.c[1], s.r, s.a0, s.a1, !s.ccw);

  ctx.stroke();
}

const renderPlayerPath = (ctx, game, isTeam1, color, playerRadius) => {
  if (game.path.length <= 0) return;

  const alpha = computePathAlpha(game.path, playerRadius);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  const pathWidth = 5;
  ctx.strokeStyle = isTeam1 ? color.team1Path : color.team2Path;
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
  strokeFilletedPath(ctx, game.path, playerRadius);

  // final position
  const last = game.path[game.path.length - 1];
  if (last) {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    ctx.arc(last[0], last[1], playerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

const computePathAlpha = (path, playerRadius) => {
  if (path.length <= 1) return 0;

  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    length += Math.hypot(dx, dy);
  }

  const NEAR = 0;
  const FAR = playerRadius * 8.0;

  let t = (length - NEAR) / (FAR - NEAR);
  t = Math.min(1, Math.max(0, t));

  // cubic ease-in-out
  t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const MIN_ALPHA = 0;
  const MAX_ALPHA = 0.7;
  return MIN_ALPHA + t * (MAX_ALPHA - MIN_ALPHA);
};

const renderLocalPlayer = (game, isTeam1) => {
  const { color, playerRadius, renderSettings, playerPosition } = game;

  const target = game.playerTarget?.[0];
  const hasAdvantage = game.playerTarget?.[1];

  const playerColor = isTeam1 ? color.team1Player : color.team2Player;
  const gunColorNormal = isTeam1 ? color.team1Gun : color.team2Gun;
  const gunColorSwapped = isTeam1 ? color.team2Gun : color.team1Gun;
  const gunColor = !hasAdvantage ? gunColorSwapped : gunColorNormal;

  const glowColorNormal = isTeam1 ? color.team1Disk : color.team2Disk;
  const glowColorSwapped = isTeam1 ? color.team2Disk : color.team1Disk;
  const glowColor = !hasAdvantage ? glowColorSwapped : glowColorNormal;

  game.drawPlayer(
    playerPosition,
    playerRadius,
    playerColor,
    gunColor,
    target,
    renderSettings.glowEnabled
      ? {
          glowRadius: playerRadius / 1.25,
          glowColor: glowColor,
          composite: "screen",
        }
      : null,
  );
};

const renderGlobalPlayers = (game, team1) => {
  const { color, playerRadius, renderSettings } = game;

  for (const [uuid, state] of game.virtualServer.globalStates.entries()) {
    const isTeam1 = team1.has(uuid);

    const target = state.target?.[0];
    const hasAdvantage = state.target?.[1];

    const playerColor = isTeam1 ? color.team1Player : color.team2Player;
    const gunColorNormal = isTeam1 ? color.team1Gun : color.team2Gun;
    const gunColorSwapped = isTeam1 ? color.team2Gun : color.team1Gun;
    const gunColor = !hasAdvantage ? gunColorSwapped : gunColorNormal;

    const glowColorNormal = isTeam1 ? color.team1Disk : color.team2Disk;
    const glowColorSwapped = isTeam1 ? color.team2Disk : color.team1Disk;
    const glowColor = !hasAdvantage ? glowColorSwapped : glowColorNormal;

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
            composite: "screen",
          }
        : null,
    );
  }
};

const renderObjectiveIfNeeded = (
  game,
  color,
  playerRadius,
  mapWidth,
  mapHeight,
  renderSettings,
) => {
  const startTime = game.isMultiPlayer
    ? game.virtualServer.startTime
    : game.startTime;
  const time = (performance.now() - startTime) / 1000;
  const timeAlpha = Math.min(1, Math.max(0, (time - 30) / 30) ** 3);
  if (timeAlpha >= 1) return;

  game.drawObjective(
    game,
    timeAlpha,
    playerRadius,
    mapWidth,
    mapHeight,
    color,
    renderSettings.glowEnabled
      ? {
          glowRadius: playerRadius / 1.25,
          glowColor: color.team1Objective,
          composite: "screen",
        }
      : null,
    renderSettings.glowEnabled
      ? {
          glowRadius: playerRadius / 1.25,
          glowColor: color.team2Objective,
          composite: "screen",
        }
      : null,
  );
};

const renderShotsAndWarp = (game, ctx, shots, playerRadius) => {
  const s = game.scale;
  const bullets = [];

  for (const shot of shots) {
    const bullet = animateShot(game, ctx, shot, s);
    if (bullet) bullets.push(bullet[1]);
  }

  game.warpFX.render({
    pointsPx: bullets,
    ampPx: 0.25 * playerRadius * s,
    sigmaPx: 100 * playerRadius * s,
    xSwap: game.xSwap,
  });
};

const renderObstaclePreviewScene = (
  game,
  ctx,
  color,
  renderSettings,
  playerRadius,
) => {
  const { poly, previewPoly } = game.previewObstacle;

  // main preview obstacle

  if (!renderSettings.glowEnabled || game.previewObstacle.index === -1)
    ctx.fillStyle = color.obstacleColorBrilliant(game.previewObstacle.index);
  else ctx.fillStyle = color.backgroundBrilliant;

  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
  ctx.closePath();
  ctx.fill("nonzero");

  // light renderer with temporary obstacle
  if (game.lightGraph) {
    game.obstacles.push(game.previewObstacle);
    game.lightRenderer(game, [], [], color, renderSettings.glowEnabled);
    game.obstacles.pop();
  }

  // blockers
  drawObstacleBlockers(game, ctx, color);

  // ghost preview poly
  if (renderSettings.glowEnabled && game.previewObstacle.index !== -1)
    ctx.fillStyle = color.obstacleColorBrilliant(-1);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(previewPoly[0][0], previewPoly[0][1]);
  for (let k = 1; k < previewPoly.length; k++)
    ctx.lineTo(previewPoly[k][0], previewPoly[k][1]);
  ctx.closePath();
  ctx.fill("nonzero");
  ctx.restore();

  // spawns + center objective + freeze-frame shots
  drawPreviewSpawnsAndObjective(game, ctx, color, renderSettings);
  if (game.isMultiPlayer) drawPreviewShots(game, ctx, color, renderSettings);

  // warpFX with no bullets
  game.warpFX.render({
    pointsPx: [],
    xSwap: game.xSwap,
  });
};

const drawObstacleBlockers = (game, ctx, color) => {
  ctx.strokeStyle = color.backgroundBrilliant;
  ctx.lineWidth = 2 * game.playerRadius;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  game.obstacleBlockers.forEach(([[blocker]]) => {
    ctx.beginPath();
    ctx.moveTo(blocker[0][0], blocker[0][1]);
    for (let k = 1; k < blocker.length; k++)
      ctx.lineTo(blocker[k][0], blocker[k][1]);
    ctx.closePath();
    ctx.stroke();
  });
};

const drawPreviewSpawnsAndObjective = (game, ctx, color, renderSettings) => {
  const playerRadius = game.playerRadius;
  // spawn1
  game.drawPlayer(
    game.spawn1,
    playerRadius,
    game.xSwap ? color.team2Player : color.team1Player,
    game.xSwap ? color.team2Gun : color.team1Gun,
    Math.atan2(
      game.spawn2[1] - game.spawn1[1],
      game.spawn2[0] - game.spawn1[0],
    ),
    renderSettings.glowEnabled
      ? {
          glowRadius: playerRadius / 1.25,
          glowColor: game.xSwap ? color.team2Disk : color.team1Disk,
          composite: "screen",
        }
      : null,
  );

  // center objective
  ctx.fillStyle = color.team1Objective;
  ctx.beginPath();
  ctx.arc(...game.team1Objective, playerRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color.team2Objective;
  ctx.beginPath();
  ctx.arc(...game.team2Objective, playerRadius, 0, Math.PI * 2);
  ctx.fill();

  // spawn2
  game.drawPlayer(
    game.spawn2,
    playerRadius,
    game.xSwap ? color.team1Player : color.team2Player,
    game.xSwap ? color.team1Gun : color.team2Gun,
    Math.atan2(
      game.spawn1[1] - game.spawn2[1],
      game.spawn1[0] - game.spawn2[0],
    ),
    renderSettings.glowEnabled
      ? {
          glowRadius: playerRadius / 1.25,
          glowColor: game.xSwap ? color.team1Disk : color.team2Disk,
          composite: "screen",
        }
      : null,
  );
};

const drawPreviewShots = (game, ctx, color, renderSettings) => {
  const playerRadius = game.playerRadius;

  game.virtualServer.shots.forEach(
    ({ team1, killerPosition, killedPosition, hit }) => {
      // logical → visual team mapping
      const isTeam1Visual = game.xSwap ? !team1 : team1;

      // killer (visual team)
      const killerBodyColor = isTeam1Visual
        ? color.team1Player
        : color.team2Player;
      const killerGunColor = isTeam1Visual ? color.team1Gun : color.team2Gun;
      const killerGlowColor = isTeam1Visual ? color.team1Disk : color.team2Disk;

      const killerAngle = Math.atan2(
        hit[1] - killerPosition[1],
        hit[0] - killerPosition[0],
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
              composite: "screen",
            }
          : null,
      );

      // killed (opposite visual team)
      const killedBodyColor = isTeam1Visual
        ? color.team2Player
        : color.team1Player;
      const killedGunColor = isTeam1Visual ? color.team2Gun : color.team1Gun;
      const killedGlowColor = isTeam1Visual ? color.team2Disk : color.team1Disk;

      const killedAngle = Math.atan2(
        killerPosition[1] - killedPosition[1],
        killerPosition[0] - killedPosition[0],
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
              composite: "screen",
            }
          : null,
      );

      // shot line (from killer’s visual team)
      ctx.strokeStyle = isTeam1Visual ? color.team1Gun : color.team2Gun;
      ctx.lineWidth = (2 * playerRadius) / 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(...killerPosition);
      ctx.lineTo(...hit);
      ctx.stroke();
    },
  );
};

const newGameCanvases = (game, scale, mapWidth, mapHeight) => {
  const output = document.getElementById("Game");
  output.width = mapWidth * scale;
  output.height = mapHeight * scale;

  const scene = document.createElement("canvas");
  scene.width = mapWidth * scale;
  scene.height = mapHeight * scale;

  const ctx = scene.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = "low";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(scale, scale);

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
  if (!game.obstacleRenderGroups) return;

  let colorIndex = 0;

  for (const group of game.obstacleRenderGroups) {
    if (!game.renderSettings.glowEnabled)
      ctx.fillStyle =
        game.choosingObstacle || game.previewingObstacle
          ? color.obstacleColorBrilliant(colorIndex++)
          : color.obstacleColor(colorIndex++);
    else ctx.fillStyle = color.backgroundBrilliant;

    ctx.beginPath();

    for (const poly of group) {
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
      ctx.closePath();
    }

    ctx.fill("nonzero");
  }
};

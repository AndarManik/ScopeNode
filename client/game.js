import {
  spawnTriangleCentered,
  transformPoints,
} from "./game/obstaclebuilder.js";
import { newVirtualServer } from "./game/virtualserver.js";
import { jiggleApp } from "./screentransform.js";
import { values } from "./values.js";
import "./game/martinez.min.js";
export const newGame = (app, options, team1, team2) => {
  app.game?.destroy();

  const game = {};

  // COLD VARIABLES
  const { mapWidth, mapHeight, minObstacleDeg } = values;
  const { playerRadius, moveSpeed, obstacleArea } = parseGameOptions(
    app,
    options
  );

  // WARM VARIABLES
  const renderSettings = app.settings.render;

  // HOT VARIABLES
  const color = app.color;

  game.team1Spawn = [3 * playerRadius, mapHeight / 2];
  game.team2Spawn = [mapWidth - 3 * playerRadius, mapHeight / 2];
  game.centerObjective = [mapWidth / 2, mapHeight / 2];

  game.isSinglePlayer = !team1 || !team2;
  game.isMultiPlayer = team1 && team2;

  if (game.isSinglePlayer) game.userId = "player";
  if (game.isMultiPlayer) game.userId = app.menu.userId;

  if (game.isSinglePlayer) team1 = new Set(["player"]);
  if (game.isSinglePlayer) team2 = new Set(["opponent"]);

  game.playerIsTeam1 = game.isSinglePlayer || team1.has(game.userId);
  game.playerIsTeam2 = game.isMultiPlayer && team2.has(game.userId);

  if (game.playerIsTeam1) game.playerPosition = [...game.team1Spawn];
  if (game.playerIsTeam2) game.playerPosition = [...game.team2Spawn];

  game.mouse = newGameMouse(game, playerRadius, mapWidth, mapHeight);

  game.virtualServer = newVirtualServer(game, app.socket, team1, team2);

  game.obstacles = null;
  if (game.isSinglePlayer) {
    for (let index = 0; index < 10; index++) {
      const triangle = spawnTriangleCentered(
        Math.random(),
        (obstacleArea * playerRadius) ** 2,
        minObstacleDeg
      );
      const position = [Math.random() * mapWidth, Math.random() * mapHeight];
      const angle = Math.PI * 2 * Math.random();
      const positionedTriangle = [[transformPoints(position, angle, triangle)]];

      if (!game.obstacles) game.obstacles = positionedTriangle;
      else game.obstacles = martinez.union(game.obstacles, positionedTriangle);
    }
    console.log(game.obstacles);
  }

  const update = (delta) => {
    const dx = game.mouse[0] - game.playerPosition[0];
    const dy = game.mouse[1] - game.playerPosition[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = moveSpeed * playerRadius * delta;

    if (dist < step) {
      game.playerPosition[0] = game.mouse[0];
      game.playerPosition[1] = game.mouse[1];
      return;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    game.playerPosition[0] += nx * step;
    game.playerPosition[1] += ny * step;
  };

  const render = () => {
    if (game.scale !== renderSettings.scale) {
      game.scale = renderSettings.scale;
      game.canvas = newGameCanvas(game.scale, mapWidth, mapHeight);
    }

    // canvas might change underneath so you can't take this out of render
    const ctx = game.canvas.ctx;

    // clear screen
    ctx.fillStyle = color.background;
    ctx.beginPath();
    ctx.rect(0, 0, mapWidth, mapHeight);
    ctx.fill();

    // draw obstacles
    ctx.fillStyle = color.obstacleColor(0);
    ctx.beginPath();
    for (const poly of game.obstacles) {
      // poly = [ outerRing, hole1, hole2, ... ]
      for (const ring of poly) {
        if (!ring || ring.length < 3) continue;
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let k = 1; k < ring.length; k++)
          ctx.lineTo(ring[k][0], ring[k][1]);
        ctx.closePath();
      }
      ctx.fill("nonzero");
    }

    // draw player shadow
    if (game.clickedPlayers.has(game.userId)) {
      const clickedState = game.clickedPlayers.get(game.userId);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(...clickedState.position, playerRadius, 0, Math.PI * 2); // full circle
      ctx.fill();
    }

    // draw player
    ctx.fillStyle = game.playerIsTeam1 ? color.team1Player : color.team2Player;
    ctx.beginPath();
    ctx.arc(...game.playerPosition, playerRadius, 0, Math.PI * 2); // full circle
    ctx.fill();

    for (const [uuid, state] of game.virtualServer.globalStates.entries()) {
      // draw global player shadow
      if (game.clickedPlayers.has(uuid)) {
        const clickedState = game.clickedPlayers.get(uuid);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(...clickedState.position, playerRadius, 0, Math.PI * 2); // full circle
        ctx.fill();
      }

      // draw global player
      ctx.fillStyle = team1.has(uuid) ? color.team1Player : color.team2Player;
      ctx.beginPath();
      ctx.arc(...state.position, playerRadius, 0, Math.PI * 2); // full circle
      ctx.fill();
    }
  };

  let last = performance.now();
  const engineCycle = () => {
    if (game.isDead) return;
    const now = performance.now();
    const delta = (now - last) / 1000;
    last = now;
    update(delta);
    render();
    requestAnimationFrame(engineCycle);
  };

  game.clickedPlayers = new Map();
  game.processStates = (tickSlice, timeOfState, currentTime) => {
    for (const [uuid, state] of tickSlice) {
      if (state.isClicking) {
        if (!game.clickedPlayers.has(uuid)) jiggleApp();
        clearTimeout(game.clickedPlayers.get(uuid)?.timeout);
        game.clickedPlayers.set(uuid, {
          timeout: setTimeout(() => game.clickedPlayers.delete(uuid), 25),
          position: state.position,
        });
      }
    }
  };

  document.addEventListener("click", () => {
    game.isClicking = true;
    setTimeout(() => (game.isClicking = false), 100);
  });

  game.start = () => {
    last = performance.now();
    engineCycle();
    game.virtualServer.start();
  };

  if (game.isSinglePlayer) game.start();

  game.destroy = () => {
    game.isDead = true;
  };

  game.handleMessage = (message) => {
    if (game.isSinglePlayer) return;
    game.virtualServer.addState(message.data);
  };

  return game;
};

const parseGameOptions = (app, options) => {
  switch (options) {
    case "small":
      return {
        playerRadius: 27,
        moveSpeed: 5,
        obstacleArea: 5,
      };
    case "medium":
      return {
        playerRadius: 18,
        moveSpeed: 6,
        obstacleArea: 5,
      };
    case "large":
      return {
        playerRadius: 12,
        moveSpeed: 7,
        obstacleArea: 5,
      };
    default:
      return app.settings.game;
  }
};

const newGameCanvas = (scale, mapWidth, mapHeight) => {
  const canvas = document.getElementById("Game");
  const ctx = canvas.getContext("2d");
  canvas.width = mapWidth * scale;
  canvas.height = mapHeight * scale;
  canvas.ctx = ctx;
  ctx.scale(scale, scale);
  return canvas;
};

const newGameMouse = (game, playerRadius, mapWidth, mapHeight) => {
  const canvas = document.getElementById("Game");
  const mouse = [0, 0];
  const maxX = mapWidth - playerRadius;
  const maxY = mapHeight - playerRadius;
  const handleMove = (e) => {
    if (game.isDead) document.removeEventListener("mousemove", handleMove);

    const rect = canvas.getBoundingClientRect();

    mouse[0] = e.clientX - rect.left;
    if (mouse[0] < playerRadius) mouse[0] = playerRadius;
    if (mouse[0] > maxX) mouse[0] = maxX;

    mouse[1] = e.clientY - rect.top;
    if (mouse[1] < playerRadius) mouse[1] = playerRadius;
    if (mouse[1] > maxY) mouse[1] = maxY;
  };
  document.addEventListener("mousemove", handleMove);
  return mouse;
};

// CALM: Prefered side should be hot reloadable, perhaps we abstract it into the render and the mouse input. There would be x axis flip if the gameprefered side and the userpreferred side are different

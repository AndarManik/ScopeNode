import {
  generateObstacle,
} from "./game/obstaclegenerator.js";
import { newVirtualServer } from "./game/virtualserver.js";
import { jiggleApp } from "./screentransform.js";
import { values } from "./values.js";
import { newObstacleBlockers, pushObstacle } from "./game/obstaclevalidator.js";

export const newGame = (app, options, team1, team2) => {
  app.game?.destroy();

  const game = {};

  // COLD VARIABLES
  Object.assign(game, values);
  parseGameOptions(app, game, options);

  const { playerRadius, moveSpeed, mapWidth, mapHeight } = game;


  // WARM VARIABLES
  const renderSettings = app.settings.render;

  // HOT VARIABLES
  const color = app.color;

  game.isSinglePlayer = !team1 || !team2;
  game.isMultiPlayer = team1 && team2;

  if (game.isSinglePlayer) game.userId = "player";
  if (game.isMultiPlayer) game.userId = app.menu.userId;

  if (game.isSinglePlayer) team1 = new Set(["player"]);
  if (game.isSinglePlayer) team2 = new Set(["opponent"]);

  game.playerIsTeam1 = game.isSinglePlayer || team1.has(game.userId);
  game.playerIsTeam2 = game.isMultiPlayer && team2.has(game.userId);

  game.team1Spawn = [3 * playerRadius, mapHeight / 2];
  game.team2Spawn = [mapWidth - 3 * playerRadius, mapHeight / 2];
  game.centerObjective = [mapWidth / 2, mapHeight / 2];

  if (game.playerIsTeam1) game.playerPosition = [...game.team1Spawn];
  if (game.playerIsTeam2) game.playerPosition = [...game.team2Spawn];

  game.mouse = newGameMouse(game, playerRadius, mapWidth, mapHeight);

  game.virtualServer = newVirtualServer(game, app.socket, team1, team2);

  game.obstacleBlockers = newObstacleBlockers(game);

  if (game.isSinglePlayer) {
    for (let index = 0; index < 10; index++) {
      const randomPosition = [Math.random() * mapWidth, Math.random() * mapHeight];
      const obstacle = generateObstacle(game, randomPosition);
      if (!pushObstacle(game, obstacle)) index--;
    }
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

        ctx.fill("nonzero")
      }
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

const parseGameOptions = (app, game, options) => {
  // start from defaults
  Object.assign(game, app.settings.game);

  switch (options) {
    case "small":
      game.playerRadius = 27;
      game.moveSpeed = 5;
      game.obstacleArea = 5;
      break;

    case "medium":
      game.playerRadius = 18;
      game.moveSpeed = 6;
      game.obstacleArea = 5;
      break;

    case "large":
      game.playerRadius = 12;
      game.moveSpeed = 7;
      game.obstacleArea = 5;
      break;
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

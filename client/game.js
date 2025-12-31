import {
  addObstacle,
  initializeObstacles,
  initializeReceivedObstacles,
} from "./game/arena.js";
import { newVirtualServer } from "./game/virtualserver.js";
import { values } from "./values.js";
import { update } from "./game/update.js";
import { render } from "./game/render.js";
import { newKeyBoard, newMouse } from "./game/input.js";
import { generateObstacle } from "./game/obstaclegenerator.js";
import { validateNewObstacle } from "./game/obstaclevalidator.js";
import { packObstacle, unpackObstacle } from "./game/binary.js";

export const newGame = (app, options, team1, team2) => {
  if (app.game) app.game.isDead = true;

  const game = {};

  // COLD VARIABLES
  Object.assign(game, values);
  parseGameOptions(app, game, options);
  // WARM VARIABLES
  game.renderSettings = app.settings.render;
  // HOT VARIABLES
  game.color = app.color;

  game.isMultiPlayer = team1 && team2;
  game.userId = game.isMultiPlayer ? app.menu.userId : "player";
  game.isTeam1 = !game.isMultiPlayer || team1.has(game.userId);
  if (!game.isMultiPlayer) team1 = new Set(["player"]);
  if (!game.isMultiPlayer) team2 = new Set(["opponent"]);
  game.spawn1 = [3 * game.playerRadius, game.mapHeight / 2];
  game.spawn2 = [game.mapWidth - 3 * game.playerRadius, game.mapHeight / 2];
  game.centerObjective = [game.mapWidth / 2, game.mapHeight / 2];

  game.color.intersectPoint = game.isTeam1
    ? game.color.intersectPoint1
    : game.color.intersectPoint2;

  game.previewAlpha = 0;
  game.previewAngle = 0;

  game.mouse = newMouse(game);
  game.keyboard = newKeyBoard(game);
  game.virtualServer = newVirtualServer(game, app, team1, team2);

  const init = () => {
    game.playerIsDead = false;
    game.playerPosition = game.isTeam1 ? [...game.spawn1] : [...game.spawn2];
    game.path = [];
    game.playerLight = [[], []];
  };

  let last = performance.now();
  const engineCycle = () => {
    if (game.isDead) return;
    const now = performance.now();
    const delta = (now - last) / 1000;
    last = now;
    update(game, delta);
    render(game, team1, team2);
    app.stats.log.set("FPS", Math.round(1 / delta));
    requestAnimationFrame(engineCycle);
  };
  init();
  engineCycle();

  if (game.isMultiPlayer) {
    game.handleBuildObstacles = () => {
      initializeObstacles(game);
      app.socket.json({ command: "obstacles", obstacles: game.obstacles });
    };

    game.handleObstacles = (obstacles) => {
      initializeReceivedObstacles(game, obstacles);
      app.socket.json({ command: "has obstacles" });
    };

    game.startVirtualServer = () => {
      game.preRound = true;
      init();
      game.virtualServer = newVirtualServer(game, app, team1, team2);
      game.virtualServer.start();
      app.socket.json({ command: "virtual server started" });
    };

    const hugeText = document.getElementById("Huge");
    game.handleStart = () => {
      ["3", "2", "1", "GO"].forEach((text, i) => {
        setTimeout(() => {
          hugeText.classList.remove("fading-out");
          hugeText.style.opacity = 0.9;
          hugeText.style.fontSize = "512px";
          hugeText.innerText = text;
          if (text !== "GO") return;
          hugeText.classList.add("fading-out");
          hugeText.style.opacity = 0;
          game.preRound = false;
        }, i * 1000);
      });
    };

    game.handleEndRound = (winner, score) => {
      const showRoundResultText = () => {
        const teamString = game.isTeam1 ? "team1" : "team2";
        hugeText.classList.remove("fading-out");
        hugeText.style.opacity = 0.9;
        hugeText.style.fontSize = "128px";
        const resultText =
          winner === "draw"
            ? "ROUND DRAW"
            : winner === teamString
            ? "ROUND WON"
            : "ROUND LOST";
        hugeText.innerText = `${score.join(" - ")}\n${resultText}`;
      };
      const fadeOutRoundText = () => {
        hugeText.classList.add("fading-out");
        hugeText.style.opacity = 0;
      };
      setTimeout(showRoundResultText, 500);
      setTimeout(fadeOutRoundText, 3500);
      setTimeout(() => app.socket.json({ command: "round end" }), 4500);
    };

    game.stopVirtualServer = () => {
      game.preRound = true;
      game.virtualServer.isStopped = true;
      app.socket.json({ command: "virtual server stopped" });
    };

    game.startChoosingObstacle = () => {
      game.choosingObstacle = true;
    };

    game.obstacleSendingLoop = () => {
      game.previewObstacle = generateObstacle(
        game,
        game.mouse,
        game.previewAngle,
        game.previewAlpha
      );

      game.previewObstacle.index = validateNewObstacle(
        game,
        game.previewObstacle
      );

      if (game.mouse.isClicking && game.previewObstacle.index !== -1) {
        game.choosingObstacle = false;
        addObstacle(game, game.previewObstacle);
        app.socket.json({
          command: "confirm obstacle",
          position: game.mouse,
          angle: game.previewAngle,
          alpha: game.previewAlpha,
        });
      } else {
        app.socket.send(
          packObstacle({
            position: game.mouse,
            angle: game.previewAngle,
            alpha: game.previewAlpha,
            index: game.previewObstacle.index,
          })
        );
      }
    };

    game.receivePreviewObstacle = (obstacle) => {
      game.previewingObstacle = true;
      game.previewObstacle = generateObstacle(
        game,
        obstacle.position,
        obstacle.angle,
        obstacle.alpha
      );
      game.previewObstacle.index = obstacle.index;
    };

    game.confirmPreviewObstacle = (obstacle) => {
      game.previewingObstacle = false;
      game.previewObstacle = generateObstacle(
        game,
        obstacle.position,
        obstacle.angle,
        obstacle.alpha
      );
      addObstacle(game, game.previewObstacle);
      app.socket.json({ command: "has confirmed obstacle" });
    };

    game.handleEnd = (winner, score) => {
      const showRoundResultText = () => {
        const teamString = game.isTeam1 ? "team1" : "team2";
        hugeText.classList.remove("fading-out");
        hugeText.style.opacity = 0.9;
        hugeText.style.fontSize = "128px";
        const resultText =
          winner === "draw"
            ? "MATCH DRAW"
            : winner === teamString
            ? "MATCH WON"
            : "MATCH LOST";
        hugeText.innerText = `${score.join(" - ")}\n${resultText}`;
      };
      const fadeOutRoundText = () => {
        hugeText.classList.add("fading-out");
        hugeText.style.opacity = 0;
      };
      setTimeout(showRoundResultText(game, hugeText, winner), 500);
      setTimeout(fadeOutRoundText, 3500);
      setTimeout(() => !app.menu.open && app.menu.toggle(), 4500);
    };

    game.handleMessage = ({ data }) => {
      if (game.virtualServer.isStopped) {
        const obstacle = unpackObstacle(data);
        obstacle && game.receivePreviewObstacle(obstacle);
      } else game.virtualServer.addState(data);
    };

    app.socket.json({ command: "client ready" });
  } else {
    initializeObstacles(game);
    game.virtualServer.start();
    game.handleMessage = () => {};
  }

  return game;
};

const parseGameOptions = (app, game, options) => {
  // start from defaults
  Object.assign(game, app.settings.game);

  switch (options) {
    case "small":
      game.playerRadius = 18;
      game.moveSpeed = 6;
      game.obstacleArea = 5;
      game.obstacleStartCount = 10;
      break;

    case "medium":
      game.playerRadius = 14;
      game.moveSpeed = 6.25;
      game.obstacleArea = 5;
      game.obstacleStartCount = 16;
      break;
    case "large":
      game.playerRadius = 10;
      game.moveSpeed = 6.5;
      game.obstacleArea = 5;
      game.obstacleStartCount = 24;
      break;
  }
};

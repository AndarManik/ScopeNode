import {
  confirmPreviewObstacle,
  forceDropNewObstacle,
  initializeObstacles,
  initializeReceivedObstacles,
  receivePreviewObstacle,
} from "./game/arena.js";
import { newVirtualServer } from "./game/virtualserver.js";
import { values } from "./values.js";
import { newKeyBoard, newMouse } from "./game/input.js";
import { startEngine } from "./game/engineloop.js";

export const newGame = (app, options, team1, team2) => {
  if (app.game) app.game.isDead = true;

  const game = {};

  Object.assign(game, values);
  parseGameOptions(app, game, options);
  game.renderSettings = app.settings.render;
  game.color = app.color;

  game.isMultiPlayer = team1 && team2;

  game.userId = game.isMultiPlayer ? app.menu.userId : "player";
  game.isTeam1 = !game.isMultiPlayer || team1.has(game.userId);
  game.isSpec = false;
  if (!game.isTeam1 && !team2.has(game.userId)) game.isSpec = true;

  game.spawn1 = [3 * game.playerRadius, game.mapHeight / 2];
  game.spawn2 = [game.mapWidth - 3 * game.playerRadius, game.mapHeight / 2];
  game.centerObjective = [game.mapWidth / 2, game.mapHeight / 2];

  if (!game.isMultiPlayer) {
    team1 = new Set(["player"]);
    team2 = new Set(["o1", "o2"]);
    game.bots = [];
  }

  game.previewAlpha = 0;
  game.previewAngle = 0;

  game.mouse = newMouse(game, app.menu);
  game.keyboard = newKeyBoard(game, app.menu);

  game.init = () => {
    game.playerIsDead = false || game.isSpec;
    game.playerPosition = game.isTeam1 ? [...game.spawn1] : [...game.spawn2];
    game.path = [];
    game.playerLight = [[], []];
    game.team1Lights = new Map();
    game.team2Lights = new Map();

    if (game.isMultiPlayer) return;

    //game.playerIsDead = true;
    game.bots.length = 0;

    for (const uuid of team1)
      if (uuid !== "player")
        game.bots.push({
          uuid,
          position: [...game.spawn1],
        });

    for (const uuid of team2)
      game.bots.push({
        uuid,
        position: [...game.spawn2],
      });

    game.startTime = performance.now();
    game.shots = new Set();

    game.buildingObstacles = true;
    initializeObstacles(game, () => (game.buildingObstacles = false));
  };

  game.init();

  startEngine(game, app, team1, team2);

  if (game.isMultiPlayer) {
    game.handleBuildObstacles = () => {
      initializeObstacles(game, () =>
        app.socket.json({
          command: "obstacles",
          obstacles: [game.obstacles, game.obstacleBlockers],
        }),
      );
    };

    game.handleObstacles = (obstacles) => {
      initializeReceivedObstacles(game, obstacles);
      app.socket.json({ command: "has obstacles" });
    };

    game.startVirtualServer = () => {
      game.preRound = true;
      game.init();
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
          setTimeout(() => {
            hugeText.classList.add("fading-out");
            hugeText.style.opacity = 0;
          }, 250);
          if (text !== "GO") return;
          game.preRound = false;
        }, i * 1000);
      });
    };

    game.handleEndRound = (winner, score) => {
      const showRoundResultText = () => {
        for (const shot of game.virtualServer.shots) if (!shot.isHit) return;
        clearInterval(checker);

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

        setTimeout(fadeOutRoundText, 3000);
        setTimeout(() => app.socket.json({ command: "round end" }), 4000);
      };
      const fadeOutRoundText = () => {
        hugeText.classList.add("fading-out");
        hugeText.style.opacity = 0;
      };
      const checker = setInterval(showRoundResultText, 50);
    };

    game.stopVirtualServer = () => {
      game.preRound = true;
      game.virtualServer.isStopped = true;
      app.socket.json({ command: "virtual server stopped" });
    };

    game.startChoosingObstacle = () => {
      game.choosingObstacle = true;
      const total = 20000;
      const countdowns = [10, 5, 3, 2, 1];
      game.forceDrop = countdowns.map((secLeft) =>
        setTimeout(
          () => {
            // Show the number
            if (!game.choosingObstacle) return;
            hugeText.classList.remove("fading-out");
            hugeText.style.opacity = 0.9;
            hugeText.style.fontSize = "512px";
            hugeText.innerText = secLeft;
            setTimeout(() => {
              hugeText.classList.add("fading-out");
              hugeText.style.opacity = 0;
            }, 250);
          },
          total - secLeft * 1000,
        ),
      );

      game.forceDrop.push(
        setTimeout(() => forceDropNewObstacle(game, app.socket), total),
      );
    };

    game.confirmPreviewObstacle = (obstacle) => {
      game.previewingObstacle = false;
      confirmPreviewObstacle(game, obstacle);
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
      setTimeout(showRoundResultText, 500);
      setTimeout(fadeOutRoundText, 3500);
      setTimeout(() => !app.menu.open && app.menu.toggle(), 4500);
    };

    game.handleMessage = ({ data }) => {
      if (game.virtualServer.isStopped) {
        if (receivePreviewObstacle(game, data)) game.previewingObstacle = true;
      } else game.virtualServer.addState(data);
    };

    game.updatePlayers = (newTeam1, newTeam2) => {
      newTeam1 = new Set(newTeam1.map(({ userId }) => userId));
      newTeam2 = new Set(newTeam2.map(({ userId }) => userId));
      team1 = newTeam1;
      team2 = newTeam2;
      game.virtualServer.updatePlayers(newTeam1, newTeam2);
    };

    app.socket.json({ command: "client ready" });
  } else {
    game.handleMessage = () => {};
    game.updatePlayers = () => {};
  }

  return game;
};

const parseGameOptions = (app, game, options) => {
  // start from defaults
  Object.assign(game, app.settings.game);

  switch (options) {
    // comments are the area of the map relative to the player
    case "small":
      //2427.25925926
      game.playerRadius = 16;
      game.moveSpeed = 6.5;
      game.obstacleArea = 7;
      game.obstacleStartCount = 25;
      break;

    case "medium":
      //4012.40816327
      game.playerRadius = 12;
      game.moveSpeed = 6.5;
      game.obstacleArea = 7;
      game.obstacleStartCount = 40;
      break;
    case "large":
      //5461.33333333
      game.playerRadius = 8;
      game.moveSpeed = 6.5;
      game.obstacleArea = 7;
      game.obstacleStartCount = 60;
      break;
  }
};

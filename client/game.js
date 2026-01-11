import {
  confirmPreviewObstacle,
  initializeObstacles,
  initializeReceivedObstacles,
  receivePreviewObstacle,
} from "./game/arena.js";
import { newVirtualServer } from "./game/virtualserver.js";
import { values } from "./values.js";
import { update } from "./game/update.js";
import { render } from "./game/render.js";
import { newKeyBoard, newMouse } from "./game/input.js";

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
  if (!game.isMultiPlayer) team1 = new Set(["player"]);
  if (!game.isMultiPlayer) team2 = new Set(["opponent"]);
  game.spawn1 = [3 * game.playerRadius, game.mapHeight / 2];
  game.spawn2 = [game.mapWidth - 3 * game.playerRadius, game.mapHeight / 2];
  game.centerObjective = [game.mapWidth / 2, game.mapHeight / 2];

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
    try {
      update(game, app, delta, team1, team2);
    } catch (err) {
      console.error("ENGINE UPDATE ERROR:", err);
    }
    try {
      render(game, team1, team2);
    } catch (err) {
      console.error("ENGINE RENDER ERROR:", err);
    }
    try {
      game.virtualServer.nextTick();
    } catch (err) {
      console.error("ENGINE VSERVER ERROR:", err);
    }
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
      game.moveSpeed = 6.25;
      game.obstacleArea = 5.5;
      game.obstacleStartCount = 4;
      break;

    case "medium":
      game.playerRadius = 14;
      game.moveSpeed = 6.25;
      game.obstacleArea = 5.5;
      game.obstacleStartCount = 8;
      break;
    case "large":
      game.playerRadius = 10;
      game.moveSpeed = 6.25;
      game.obstacleArea = 5.5;
      game.obstacleStartCount = 12;
      break;
  }
};

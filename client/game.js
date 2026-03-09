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

  const game = { ...values, ...app.settings.game };

  parseGameOptions(game, options);
  game.renderSettings = app.settings.render;
  game.color = app.color;

  game.isMultiPlayer = team1 && team2;

  game.userId = game.isMultiPlayer ? app.menu.userId : "player";

  game.team1 = game.isMultiPlayer ? team1 : new Set(["player"]);
  game.team2 = game.isMultiPlayer ? team2 : new Set(["o1"]);

  game.isSpec = !game.team1.has(game.userId) && !game.team2.has(game.userId);

  game.all = [...game.team1, ...game.team2].sort();
  game.allInv = Object.fromEntries(game.all.map((uuid, i) => [uuid, i]));

  game.spawn1 = [2 * game.playerRadius, game.mapHeight / 2];
  game.spawn2 = [game.mapWidth - 2 * game.playerRadius, game.mapHeight / 2];

  game.previewAlpha = 0;
  game.previewAngle = 0;

  game.mouse = newMouse(game, app.menu);
  game.keyboard = newKeyBoard(game, app.menu);

  game.init = () => {
    game.players = game.all.map((uuid) => {
      const player = newPlayer(game, uuid);
      player.type = game.isMultiPlayer ? "online" : "bot";
      if (uuid === game.userId) {
        game.player = player;
        player.type = "player";
      }
      return player;
    });

    game.playersMap = new Map(game.players.map((p) => [p.uuid, p]));

    if (game.isSpec) game.player.isAlive = false;
    //game.player.isAlive = false;
    game.team1Lights = new Map();
    game.team2Lights = new Map();

    game.startTime = performance.now();
    game.shots = new Set();

    if (game.isMultiPlayer) return;

    game.buildingObstacles = true;
    initializeObstacles(game, () => (game.buildingObstacles = false));
  };

  game.init();

  startEngine(game, app);

  if (game.isMultiPlayer) {
    game.handleBuildObstacles = () => {
      initializeObstacles(game, () =>
        app.socket.json({
          command: "obstacles",
          obstacles: {
            obstacles: game.obstacles,
            blockers: game.obstacleBlockers,
            team1Objective: game.team1Objective,
            team2Objective: game.team2Objective,
          },
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
      game.virtualServer = newVirtualServer(game, app);
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
        for (const shot of game.shots) if (!shot.isHit) return;
        clearInterval(checker);

        const teamString = game.player.team1 ? "team1" : "team2";
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
        const teamString = game.player.team1 ? "team1" : "team2";
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

const parseGameOptions = (game, options) => {
  switch (options) {
    case "small":
      game.playerRadius = 16;
      game.moveSpeed = 13;
      game.obstacleArea = 7;
      game.obstacleStartCount = 8;
      break;

    case "medium":
      game.playerRadius = 12;
      game.moveSpeed = 13;
      game.obstacleArea = 7;
      game.obstacleStartCount = 16;
      break;
    case "large":
      game.playerRadius = 8;
      game.moveSpeed = 13;
      game.obstacleArea = 7;
      game.obstacleStartCount = 32;
      break;
  }
};

export const newPlayer = (game, uuid) => {
  return {
    uuid,
    isAlive: true,

    team1: game.team1.has(uuid),
    team2: game.team2.has(uuid),

    position: game.team1.has(uuid) ? [...game.spawn1] : [...game.spawn2],
    path: [],
    moveSpeed: game.moveSpeed,

    light: [[], []],

    distanceToObj: 0,
    advantage: true,

    target: 0,
    smoothedTargetAngle: 0,
    smoothedTargetAngularVel: 0,

    // for multiplayer
    seen: 0,
    tick: [0, 0],
    vector: game.all
      .filter((otherUUID) => otherUUID !== uuid)
      .map((uuid) => [uuid, 0]),
  };
};

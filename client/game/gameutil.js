import {
  confirmPreviewObstacle,
  forceDropNewObstacle,
  initializeObstacles,
  initializeReceivedObstacles,
  receivePreviewObstacle,
} from "./arena.js";
import { newVirtualServer } from "./virtualserver.js";

const hugeText = () => document.getElementById("Huge");

const showHugeText = (text, fontSize = "128px", fadeDelay = 250) => {
  const el = hugeText();
  if (!el) return;

  el.classList.remove("fading-out");
  el.style.opacity = 0.9;
  el.style.fontSize = fontSize;
  el.innerText = text;

  if (fadeDelay != null) {
    setTimeout(() => {
      el.classList.add("fading-out");
      el.style.opacity = 0;
    }, fadeDelay);
  }
};

const fadeHugeText = () => {
  const el = hugeText();
  if (!el) return;
  el.classList.add("fading-out");
  el.style.opacity = 0;
};

export const gameUtil = {
  handleBuildObstacles(game, app) {
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
  },

  handleObstacles(game, app, obstacles) {
    initializeReceivedObstacles(game, obstacles);
    app.socket.json({ command: "has obstacles" });
  },

  startVirtualServer(game, app) {
    game.preRound = true;
    game.init();
    game.virtualServer = newVirtualServer(game, app);
    game.virtualServer.start();
    app.socket.json({ command: "virtual server started" });
  },

  handleStart(game) {
    ["3", "2", "1", "GO"].forEach((text, i) => {
      setTimeout(() => {
        showHugeText(text, "512px", 250);
        if (text === "GO") game.preRound = false;
      }, i * 1000);
    });
  },

  handleEndRound(game, app, winner, score) {
    const showRoundResultText = () => {
      for (const shot of game.shots) {
        if (!shot.isHit) return;
      }

      clearInterval(checker);

      const teamString = game.player.team1 ? "team1" : "team2";
      const resultText =
        winner === "draw"
          ? "ROUND DRAW"
          : winner === teamString
            ? "ROUND WON"
            : "ROUND LOST";

      showHugeText(`${score.join(" - ")}\n${resultText}`, "128px", null);

      setTimeout(() => fadeHugeText(), 3000);
      setTimeout(() => app.socket.json({ command: "round end" }), 4000);
    };

    const checker = setInterval(showRoundResultText, 50);
  },

  startChoosingObstacle(game, app) {
    game.choosingObstacle = true;

    const total = 20000;
    const countdowns = [10, 5, 3, 2, 1];

    game.forceDrop = countdowns.map((secLeft) =>
      setTimeout(
        () => {
          showHugeText(secLeft, "512px", 250);
        },
        total - secLeft * 1000,
      ),
    );

    game.forceDrop.push(
      setTimeout(() => forceDropNewObstacle(game, app.socket), total),
    );
  },

  confirmPreviewObstacle(game, app, obstacle) {
    game.previewingObstacle = false;
    confirmPreviewObstacle(game, obstacle);
    app.socket.json({ command: "has confirmed obstacle" });
  },

  stopVirtualServer(game, app) {
    game.preRound = true;
    if (game.virtualServer) game.virtualServer.isStopped = true;
    app.socket.json({ command: "virtual server stopped" });
  },

  handleEnd(game, app, winner, score) {
    const teamString = game.player.team1 ? "team1" : "team2";
    const resultText =
      winner === "draw"
        ? "MATCH DRAW"
        : winner === teamString
          ? "MATCH WON"
          : "MATCH LOST";

    setTimeout(() => {
      showHugeText(`${score.join(" - ")}\n${resultText}`, "128px", null);
    }, 500);

    setTimeout(() => fadeHugeText(), 3500);
    setTimeout(() => !app.menu.open && app.menu.toggle(), 4500);
  },

  handleMessage(game, data) {
    if (!game.virtualServer) return;

    if (game.virtualServer.isStopped) {
      if (receivePreviewObstacle(game, data)) game.previewingObstacle = true;
      return;
    }

    game.virtualServer.addState(data);
  },

  updatePlayers(game, newTeam1, newTeam2) {
    const team1 = new Set(newTeam1.map(({ userId }) => userId));
    const team2 = new Set(newTeam2.map(({ userId }) => userId));

    game.team1 = team1;
    game.team2 = team2;
    game.all = [...team1, ...team2].sort();
    game.allInv = Object.fromEntries(game.all.map((uuid, i) => [uuid, i]));

    if (game.virtualServer) {
      game.virtualServer.updatePlayers(team1, team2);
    }
  },
};

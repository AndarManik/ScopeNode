import { initializeObstacles } from "./game/arena.js";
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
  game.team2 = game.isMultiPlayer ? team2 : new Set(["o1", "o2"]);

  game.isSpec = !game.team1.has(game.userId) && !game.team2.has(game.userId);

  game.all = [...game.team1, ...game.team2].sort();
  game.allInv = Object.fromEntries(game.all.map((uuid, i) => [uuid, i]));

  game.spawn1 = [2 * game.playerRadius, game.mapHeight / 2];
  game.spawn2 = [game.mapWidth - 2 * game.playerRadius, game.mapHeight / 2];

  game.previewAlpha = 0;
  game.previewAngle = 0;

  game.mouse = newMouse(game, app.menu);
  game.keyboard = newKeyBoard(game, app.menu);

  game.build = () => {
    game.players = game.all.map((uuid) => {
      const player = newPlayer(game, uuid);
      player.type = game.isMultiPlayer ? "online" : "bot";
      if (uuid === game.userId) {
        game.player = player;
        player.type = "player";
      }
      return player;
    });

    if (game.isSpec) {
      game.player = newPlayer(game, "");
      game.player.type = "player";
      game.player.isAlive = false;
    }

    game.playersMap = new Map(game.players.map((p) => [p.uuid, p]));

    game.team1Lights = [];
    game.team2Lights = [];

    game.startTime = performance.now();
    game.shots = new Set();
  };

  let singlePlayerBuilt = false;
  game.init = () => {
    if (game.isMultiPlayer) return game.build();

    if (!singlePlayerBuilt) {
      game.buildingObstacles = true;
      return initializeObstacles(game, () => {
        game.build();
        game.buildingObstacles = false;
        singlePlayerBuilt = true;
      });
    }

    game.choosingObstacle = true;
  };

  game.init();

  startEngine(game, app);

  if (game.isMultiPlayer) app.socket.json({ command: "client ready" });

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

    radius: game.playerRadius,

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

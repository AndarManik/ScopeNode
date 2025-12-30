import crypto from "crypto";
export const newLobby = (code) => {
  const connected = new Set();
  const team1 = new Set();
  const team2 = new Set();
  const spectators = new Set();

  const lobby = { code, connected, mapSize: "medium" };

  lobby.addConnection = (socket) => {
    socket.userId = crypto.randomUUID();

    connected.add(socket);
    if (team1.size + team2.size === 10) spectators.add(socket);
    else if (team1.size > team2.size) team2.add(socket);
    else team1.add(socket);

    socket.json({ command: "lobby user id", userId: socket.userId });

    lobby.sendNames();
    lobby.sendSize();

    //lobby.log();
  };

  lobby.removeConnection = (socket) => {
    connected.delete(socket);
    team1.delete(socket);
    team2.delete(socket);
    spectators.delete(socket);
    lobby.sendNames();
    //lobby.log();
  };

  lobby.awakeConnection = (oldSocket, socket) => {
    socket.userId = oldSocket.userId;

    replaceInSet(connected, oldSocket, socket);
    replaceInSet(team1, oldSocket, socket);
    replaceInSet(team2, oldSocket, socket);
    replaceInSet(spectators, oldSocket, socket);
    //lobby.log();
  };

  lobby.setSize = (size) => {
    if (size !== "small" && size !== "medium" && size !== "large") return;
    lobby.mapSize = size;
    lobby.sendSize();
  };

  lobby.sendSize = () => {
    const messageObj = { command: "map size change", size: lobby.mapSize };
    const message = JSON.stringify(messageObj);
    connected.forEach((socket) => socket.send(message));
  };

  lobby.sendNames = () => {
    const messageObj = {
      command: "lobby users",
      team1: [...team1].map(({ userId, name }) => ({ userId, name })),
      team2: [...team2].map(({ userId, name }) => ({ userId, name })),
      spec: spectators.size,
    };
    const message = JSON.stringify(messageObj);
    connected.forEach((socket) => socket.send(message));
  };

  lobby.joinTeam = (socket, team) => {
    if (!connected.has(socket)) return;

    if (team === "team1" && team1.size >= 5) return;
    if (team === "team2" && team2.size >= 5) return;

    team1.delete(socket);
    team2.delete(socket);
    spectators.delete(socket);

    if (team === "team1") team1.add(socket);
    else if (team === "team2") team2.add(socket);
    else spectators.add(socket);

    lobby.sendNames();
  };

  lobby.startGame = () => {
    if (lobby.inGame) return;
    lobby.inGame = true;

    const toWinMap = { small: 3, medium: 5, large: 7 };
    lobby.toWin = toWinMap[lobby.mapSize];
    lobby.score = [0, 0];

    lobby.players = new Set([...team1, ...team2]);

    lobby.players.forEach((socket) => {
      socket.isDead = false;
      socket.kills = 0;
      socket.confirmed = new Map();
    });

    const startData = { command: "start game" };
    startData.mapSize = lobby.mapSize;
    startData.team1 = [...team1].map(({ userId }) => userId);
    startData.team2 = [...team2].map(({ userId }) => userId);
    const startMessage = JSON.stringify(startData);
    connected.forEach((socket) => {
      socket.clientState = "client not ready";
      socket.send(startMessage);
    });
  };

  lobby.clientReady = (socket) => {
    if (socket.clientState !== "client not ready") return;
    socket.clientState = "client ready";

    for (const player of connected)
      if (player.clientState !== "client ready") return;

    [...team1][0].json({ command: "build obstacles" });
  };

  lobby.distributeObstacles = (socket, obstacles) => {
    if (socket.clientState !== "client ready") return;
    socket.clientState = "has obstacles";
    lobby.obstacles = obstacles;
    const obstacleMessage = JSON.stringify({ command: "obstacles", obstacles });
    connected.forEach((player) => {
      if (player !== socket) player.send(obstacleMessage);
    });
  };

  lobby.clientHasObstacles = (socket) => {
    if (socket.clientState !== "client ready") return;
    socket.clientState = "has obstacles";

    for (const player of lobby.players)
      if (player.clientState !== "has obstacles") return;

    const startVServer = JSON.stringify({ command: "start virtual server" });
    connected.forEach((socket) => {
      socket.clientState = "virtual server not started";
      socket.send(startVServer);
    });
  };

  lobby.virtualServerStarted = (socket) => {
    if (socket.clientState !== "virtual server not started") return;
    socket.clientState = "virtual server started";

    for (const player of lobby.players)
      if (player.clientState !== "virtual server started") return;

    const startRound = JSON.stringify({ command: "start round" });
    connected.forEach((socket) => {
      socket.clientState = "in round";
      socket.send(startRound);
    });
  };

  lobby.playerShot = (socket, newShots, tick) => {
    if (socket.clientState !== "in round") return;
    socket.confirmed.set(tick, newShots);
    for (const player of lobby.players) if (!player.confirmed.has(tick)) return;

    for (const shot of newShots) {
      const killer = getInSocketSet(connected, shot.killer);
      const killed = getInSocketSet(connected, shot.killed);
      if (!killer || !killed) return;
      if (killed.isDead) return;
      killed.isDead = true;
      killer.kills++;
    }

    const team1Alive = [...team1].filter(({ isDead }) => !isDead).length;
    const team2Alive = [...team2].filter(({ isDead }) => !isDead).length;
    if (team1Alive && team2Alive) return;

    if (team1Alive) lobby.score[0]++;
    if (team2Alive) lobby.score[1]++;

    const team1Win = lobby.score[0] === lobby.toWin;
    const team2Win = lobby.score[1] === lobby.toWin;

    if (team1Win || team2Win) lobby.endGame(team1Win, team2Win);
    else lobby.endRound(team1Alive, team2Alive);
  };

  let winner = "draw";
  lobby.endRound = (team1Alive, team2Alive) => {
    winner = team1Alive ? "team1" : team2Alive ? "team2" : "draw";
    const score = lobby.score;
    const endingRound = JSON.stringify({ command: "end round", winner, score });
    connected.forEach((socket) => (socket.clientState = "ending round"));
    connected.forEach((socket) => socket.send(endingRound));
  };

  lobby.clientRoundEnded = (socket) => {
    if (socket.clientState !== "ending round") return;
    socket.clientState = "round ended";

    for (const player of lobby.players)
      if (player.clientState !== "round ended") return;

    lobby.players.forEach((player) => {
      player.isDead = false;
      player.confirmed = new Map();
    });

    const team = winner === "team1" ? team2 : team1;
    const randomPlayer = [...team][Math.floor(team.size * Math.random())];

    const stopVServer = JSON.stringify({ command: "stop virtual server" });
    connected.forEach((socket) => {
      socket.clientState = "virtual server not stopped";
      socket.send(stopVServer);
    });
  };

  lobby.virtualServerStopped = (socket) => {
    if (socket.clientState !== "virtual server not stopped") return;
    socket.clientState = "virtual server stopped";

    const players = new Set([...team1, ...team2]);
    for (const player of players)
      if (player.clientState !== "virtual server stopped") return;

    const startMessage = JSON.stringify({ command: "start virtual server" });
    connected.forEach((socket) => {
      socket.clientState = "virtual server not started";
      socket.send(startMessage);
    });
  };

  lobby.endGame = (team1Win, team2Win) => {
    winner = team1Win && team2Win ? "draw" : team1Win ? "team1" : "team2";
    const score = lobby.score;
    const endingGame = JSON.stringify({ command: "end game", winner, score });
    connected.forEach((socket) => socket.send(endingGame));

    lobby.inGame = false;
  };

  return lobby;
};

const replaceInSet = (set, toReplace, replacement) => {
  if (!set.has(toReplace)) return;
  set.delete(toReplace);
  set.add(replacement);
};

const getInSocketSet = (set, userId) =>
  [...set].filter((socket) => socket.userId === userId)[0];

import crypto from "crypto";
export const newLobby = (code) => {
  const connected = new Set();
  const team1 = new Set();
  const team2 = new Set();
  const players = new Set();
  const spectators = new Set();

  let state = "lobby";
  const toWinMap = { small: 4, medium: 6, large: 8 };

  const lobby = { code, connected, mapSize: "medium" };

  lobby.addConnection = (socket) => {
    socket.userId = crypto.randomUUID();
    connected.add(socket);
    if (state === "lobby" && team1.size + team2.size < 10) {
      players.add(socket);
      if (team1.size <= team2.size) team1.add(socket);
      else team2.add(socket);
    } else spectators.add(socket);
    socket.json({ command: "lobby user id", userId: socket.userId });
    lobby.sendNames();
    lobby.sendSize();

    //CALM: Initialize spectators if state !== lobby
  };

  lobby.removeConnection = (socket) => {
    connected.delete(socket);
    team1.delete(socket);
    team2.delete(socket);
    players.delete(socket);
    spectators.delete(socket);
    lobby.sendNames();

    if (state === "lobby") return;

    // game ends if team is empty
    if (!team1.size || !team2.size) {
      const winner =
        !team1.size && !team2.size ? "draw" : !team2.size ? "team1" : "team2";
      const score = lobby.score;
      const endingGame = JSON.stringify({ command: "end game", winner, score });
      connected.forEach((socket) => socket.send(endingGame));
      state = "lobby";
      return;
    }

    //retrigger handlers to prevent deadlock
    switch (state) {
      case "starting game":
        return lobby.clientReady(socket);

      case "building obstacles":
        return socket.isBuilder && lobby.buildObstacles();

      case "distributing obstacles":
        return lobby.clientHasObstacles(socket);

      case "starting virtual server":
        return lobby.virtualServerStarted(socket);

      case "in round":
        return lobby.checkRoundEnded();

      case "ending round":
        return lobby.clientRoundEnded(socket);

      case "stopping virtual server":
        return lobby.virtualServerStopped(socket);

      case "choosing obstacle":
        return socket.isBuilder && lobby.chooseObstacle();

      case "distributing chosen obstacle":
        return lobby.clientHasConfirmObstacle(socket);
    }
  };

  lobby.awakeConnection = (oldSocket, socket) => {
    socket.userId = oldSocket.userId;
    socket.clientState = oldSocket.clientState;
    socket.isDead = oldSocket.isDead;
    socket.kills = oldSocket.kills;
    socket.isBuilder = oldSocket.isBuilder;

    replaceInSet(connected, oldSocket, socket);
    replaceInSet(team1, oldSocket, socket);
    replaceInSet(team2, oldSocket, socket);
    replaceInSet(players, oldSocket, socket);
    replaceInSet(spectators, oldSocket, socket);
  };

  lobby.setSize = (size) => {
    if (state !== "lobby") return;
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
    if (state !== "lobby") return;
    if (team === "team1" && team1.size >= 5) return;
    if (team === "team2" && team2.size >= 5) return;
    team1.delete(socket);
    team2.delete(socket);
    players.delete(socket);
    spectators.delete(socket);
    if (team !== "spec") {
      players.add(socket);
      if (team === "team1") team1.add(socket);
      else if (team === "team2") team2.add(socket);
    } else spectators.add(socket);
    lobby.sendNames();
  };

  lobby.stateUpdate = (socket, startState, endState) => {
    if (socket.clientState !== startState) return false;
    socket.clientState = endState;
    for (const player of connected)
      if (player.clientState !== endState) return false;
    return true;
  };

  lobby.stateSend = (state, message, exclude) => {
    connected.forEach((socket) => {
      if (socket === exclude) return;
      socket.clientState = state;
      socket.send(message);
    });
  };

  lobby.startGame = () => {
    if (state !== "lobby") return;
    if (!team1.size || !team2.size) return;
    state = "starting game";

    lobby.toWin = toWinMap[lobby.mapSize];
    lobby.score = [0, 0];

    players.forEach((socket) => {
      socket.isDead = false;
      socket.kills = 0;
      socket.isBuilder = false;
    });

    const startData = { command: "start game" };
    startData.mapSize = lobby.mapSize;
    startData.team1 = [...team1].map(({ userId }) => userId);
    startData.team2 = [...team2].map(({ userId }) => userId);
    const startMessage = JSON.stringify(startData);
    lobby.stateSend("client not ready", startMessage);
  };

  lobby.clientReady = (socket) => {
    if (state !== "starting game") return;
    if (!lobby.stateUpdate(socket, "client not ready", "client ready")) return;
    lobby.buildObstacles();
  };

  lobby.buildObstacles = () => {
    state = "building obstacles";
    const builder = [...team1][0];
    builder.isBuilder = true;
    builder.json({ command: "build obstacles" });
  };

  lobby.distributeObstacles = (socket, obstacles) => {
    if (state !== "building obstacles") return;
    if (socket.clientState !== "client ready") return;
    state = "distributing obstacles";
    socket.clientState = "has obstacles";
    socket.isBuilder = false;
    lobby.obstacles = obstacles;
    const message = JSON.stringify({ command: "obstacles", obstacles });
    connected.forEach((player) => player !== socket && player.send(message));
  };

  lobby.clientHasObstacles = (socket) => {
    if (state !== "distributing obstacles") return;
    if (!lobby.stateUpdate(socket, "client ready", "has obstacles")) return;
    state = "starting virtual server";
    const startVServer = JSON.stringify({ command: "start virtual server" });
    lobby.stateSend("virtual server not started", startVServer);
  };

  lobby.virtualServerStarted = (socket) => {
    if (state !== "starting virtual server") return;
    const startState = "virtual server not started";
    const endState = "virtual server started";
    if (!lobby.stateUpdate(socket, startState, endState)) return;
    state = "in round";
    const startRound = JSON.stringify({ command: "start round" });
    lobby.stateSend("in round", startRound);
  };

  lobby.playerShot = (socket, newShots) => {
    if (state !== "in round") return;
    if (socket.clientState !== "in round") return;

    for (const shot of newShots) {
      const killer = getInSocketSet(connected, shot.killer);
      const killed = getInSocketSet(connected, shot.killed);
      if (!killer || !killed) continue;
      if (!killed.isDead) {
        killed.isDead = true;
        killer.kills++;
      }
    }

    lobby.checkRoundEnded();
  };

  lobby.checkRoundEnded = () => {
    const team1Alive = [...team1].filter(({ isDead }) => !isDead).length;
    const team2Alive = [...team2].filter(({ isDead }) => !isDead).length;
    if (team1Alive && team2Alive) return;
    // both teams gain point on draw
    if (!team1Alive) lobby.score[1]++;
    if (!team2Alive) lobby.score[0]++;
    const team1Win = lobby.score[0] === lobby.toWin;
    const team2Win = lobby.score[1] === lobby.toWin;
    if (team1Win || team2Win) lobby.endGame(team1Win, team2Win);
    else lobby.endRound(team1Alive, team2Alive);
  };

  let winner = "draw";
  lobby.endRound = (team1Alive, team2Alive) => {
    state = "ending round";
    winner = team1Alive ? "team1" : team2Alive ? "team2" : "draw";
    const score = lobby.score;
    const endingRound = JSON.stringify({ command: "end round", winner, score });
    lobby.stateSend("ending round", endingRound);
  };

  lobby.clientRoundEnded = (socket) => {
    if (state !== "ending round") return;
    if (!lobby.stateUpdate(socket, "ending round", "round ended")) return;
    state = "stopping virtual server";
    players.forEach((player) => {
      player.isDead = false;
    });
    const stopVServer = JSON.stringify({ command: "stop virtual server" });
    lobby.stateSend("virtual server not stopped", stopVServer);
  };

  lobby.virtualServerStopped = (socket) => {
    if (state !== "stopping virtual server") return;
    const startState = "virtual server not stopped";
    const endState = "virtual server stopped";
    if (!lobby.stateUpdate(socket, startState, endState)) return;
    if (winner === "draw") {
      state = "starting virtual server";
      const startMessage = JSON.stringify({ command: "start virtual server" });
      lobby.stateSend("virtual server not started", startMessage);
      return;
    }
    lobby.chooseObstacle();
  };

  lobby.chooseObstacle = () => {
    state = "choosing obstacle";
    const team = winner === "team1" ? team2 : team1;
    const randomPlayer = [...team][Math.floor(team.size * Math.random())];
    randomPlayer.isBuilder = true;
    randomPlayer.json({ command: "start choosing obstacle" });
  };

  lobby.confirmObstacle = (socket, message) => {
    if (state !== "choosing obstacle") return;
    if (socket.clientState !== "virtual server stopped") return;
    state = "distributing chosen obstacle";
    socket.clientState = "has confirmed obstacle";
    socket.isBuilder = false;
    const obstacle = JSON.stringify(message);
    lobby.stateSend("needs confirmed obstacle", obstacle, socket);
  };

  lobby.clientHasConfirmObstacle = (socket) => {
    if (state !== "distributing chosen obstacle") return;
    const startState = "needs confirmed obstacle";
    const endState = "has confirmed obstacle";
    if (!lobby.stateUpdate(socket, startState, endState)) return;
    state = "starting virtual server";
    const startMessage = JSON.stringify({ command: "start virtual server" });
    lobby.stateSend("virtual server not started", startMessage);
  };

  lobby.endGame = (team1Win, team2Win) => {
    state = "lobby";
    winner = team1Win && team2Win ? "draw" : team1Win ? "team1" : "team2";
    const score = lobby.score;
    const endingGame = JSON.stringify({ command: "end game", winner, score });
    connected.forEach((socket) => socket.send(endingGame));
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

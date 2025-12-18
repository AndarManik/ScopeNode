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

    const startData = { command: "start game" };
    startData.mapSize = lobby.mapSize;
    startData.team1 = [...team1].map(({ userId }) => userId);
    startData.team2 = [...team2].map(({ userId }) => userId);
    const startMessage = JSON.stringify(startData);
    connected.forEach((socket) => {
      socket.clientState = "client not ready";
      socket.send(startMessage);
    });

    //CALM: Each client produces a random obstacle it validates itself o.o, we distribute these across to other clients until the number of obstacles is met. It would be faster if one client produced all of them tho.

    //CALM: Send another game start message which tell all clients to get ready to start the game, idk if this is really needed maybe we can just start right away

    //CALM: Send a game start start message which actually starts the game, after which sockets will be turned into distribution mode. We may not need to flag anything and just naturally have it select based on message Type. This would let users leave the lobby mid way through the match o.o,

    //CALM: We need to start ghost buckets on each client so that distributed messages don't get lost during reconnect.
  };

  lobby.clientReady = (socket) => {
    if (socket.clientState !== "client not ready") return;
    socket.clientState = "client ready";

    const players = new Set([...team1, ...team2]);

    for (const player of players)
      if (player.clientState !== "client ready") return;

    const startMessage = JSON.stringify({ command: "start virtual server" });
    players.forEach((socket) => {
      socket.clientState = "client started";
      socket.send(startMessage);
    });
  };

  return lobby;
};

const replaceInSet = (set, toReplace, replacement) => {
  if (!set.has(toReplace)) return;
  set.delete(toReplace);
  set.add(replacement);
};

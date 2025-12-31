import { newGame } from "./game.js";
import { lobby, updateLobbyNames, updateLobbySize } from "./menu/lobby.js";
import { jiggleApp } from "./screentransform.js";

export const newSocket = (app) => {
  const url = `${location.protocol.replace("http", "ws")}//${location.host}`;

  let hotSocket;
  let latencyMs = 0;

  const socket = {};
  socket.unsentMessages = [];
  socket.lastSentMessages = [];

  const sendNow = (message) => {
    if (hotSocket.readyState !== WebSocket.OPEN)
      return socket.unsentMessages.push(message);
    hotSocket.send(message);
    socket.lastSentMessages.push(message);
    if (socket.lastSentMessages.length > 10) socket.lastSentMessages.shift();
  };

  socket.send = (message) => {
    if (!latencyMs) return sendNow(message);
    setTimeout(() => sendNow(message), latencyMs);
  };

  socket.json = (message) => socket.send(JSON.stringify(message));

  const open = () => {
    console.log("Connected to server");
    const { name, id } = app;
    if (name) socket.json({ command: "name change", name });
    if (id) socket.json({ command: "reconnect", id });
  };

  const initialMessage = (message) => {
    const handle = () => {
      if (typeof message.data !== "string") return;
      const data = JSON.parse(message.data);
      if (data.command !== "user info") return;
      if (!app.id) app.id = data.id;
      if (!app.name) app.name = data.name;
      hotSocket.removeEventListener("message", initialMessage);
    };
    if (!latencyMs) handle();
    else setTimeout(handle, latencyMs);
  };

  const reconnectMessage = (message) => {
    const handle = () => {
      if (typeof message.data !== "string") return;
      const data = JSON.parse(message.data);
      if (data.command !== "socket reconnected") return;
      // We have a temp variable here because .send might push into unsentMessages.
      const tempUnsent = socket.unsentMessages;
      socket.unsentMessages = [];
      tempUnsent.push(...socket.lastSentMessages);
      tempUnsent.forEach(socket.send);
      hotSocket.removeEventListener("message", reconnectMessage);
    };
    if (!latencyMs) handle();
    else setTimeout(handle, latencyMs);
  };

  const defaultMessage = (message) => {
    if (!latencyMs) handleMessage(app, message);
    else setTimeout(() => handleMessage(app, message), latencyMs);
  };

  const connect = () => {
    hotSocket = new WebSocket(url);
    hotSocket.binaryType = "arraybuffer";
    hotSocket.addEventListener("open", open);
    hotSocket.addEventListener("message", initialMessage);
    hotSocket.addEventListener("message", reconnectMessage);
    hotSocket.addEventListener("message", defaultMessage);
    hotSocket.addEventListener("close", connect);
  };

  window.disconnect = () => hotSocket.close();

  window.latency = (ms) => {
    latencyMs = Math.max(0, (ms | 0) / 2);
    console.log("[ws latency] set to", ms, "ms");
  };

  connect();

  return socket;
};

const handleMessage = (app, message) => {
  if (typeof message.data !== "string") return app.game.handleMessage(message);

  const { menu } = app;
  const data = JSON.parse(message.data);
  console.log(data.command);
  switch (data.command) {
    case "lobby user id": {
      menu.userId = data.userId;
      updateLobbyNames(menu);
      return;
    }

    case "join lobby": {
      menu.lobbyCode = data.lobbyCode;
      //always send to lobby
      return lobby(app);
    }

    case "lobby users": {
      menu.team1 = data.team1;
      menu.team2 = data.team2;
      menu.spec = data.spec;
      updateLobbyNames(menu);
      return;
    }

    case "map size change": {
      menu.size = data.size;
      updateLobbySize(menu);
      return;
    }

    case "start game": {
      const team1 = new Set(data.team1);
      const team2 = new Set(data.team2);
      app.game = newGame(app, data.mapSize, team1, team2);
      jiggleApp();
      return;
    }

    case "build obstacles": {
      app.game.handleBuildObstacles();
      return;
    }

    case "obstacles": {
      app.game.handleObstacles(data.obstacles);
      return;
    }

    case "start virtual server": {
      app.game.startVirtualServer();
      if (menu.open) menu.toggle();
      return;
    }

    case "start round": {
      app.game.handleStart();
      return;
    }

    case "end round": {
      app.game.handleEndRound(data.winner, data.score);
      return;
    }

    case "start choosing obstacle": {
      app.game.startChoosingObstacle();
      return;
    }

    case "confirm obstacle": {
      app.game.confirmPreviewObstacle(data);
      return;
    }

    case "stop virtual server": {
      app.game.stopVirtualServer();
      return;
    }

    case "end game": {
      app.game.handleEnd(data.winner, data.score);
      return;
    }
  }
};

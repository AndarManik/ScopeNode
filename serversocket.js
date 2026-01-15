import crypto from "crypto";
import { newUsername } from "./namegen.js";
import WebSocket from "ws";

export const newSocketConnector = (lobbyServer) => (socket) => {
  socket.id = crypto.randomUUID();
  socket.name = newUsername();
  socket.isAlive = true;

  lobbyServer.registerSocket(socket);

  socket.on("pong", () => (socket.isAlive = true));

  socket.on("message", newMessageHandler(lobbyServer, socket));

  socket.on("close", () => {
    console.log(
      "\n================= CLIENT DISCONNECTED =================",
      `\nSocket ID      : ${socket.id}`,
      "\n======================================================"
    );
    lobbyServer.sleepSocket(socket);
  });

  socket.unsentMessages = [];
  socket.lastSentMessages = [];
  socket.realSend = socket.send;
  socket.send = (data) => {
    const { readyState } = socket;
    if (readyState !== WebSocket.OPEN) return socket.unsentMessages.push(data);
    if (typeof data === "string")
      console.log(
        "\n==================== SENT ====================",
        `\nDestination ID : ${socket.id}`,
        "\nPayload        :",
        JSON.parse(data),
        "\n============================================="
      );
    try {
      socket.realSend(data);
      lobbyServer.trackUpload(data);
      socket.lastSentMessages.push(data);
      if (socket.lastSentMessages.length > 10) socket.lastSentMessages.shift();
    } catch (err) {
      socket.unsentMessages.push(data);
    }
  };

  socket.json = (data) => socket.send(JSON.stringify(data));

  socket.json({ command: "user info", id: socket.id, name: socket.name });

  console.log(
    "\n================== CLIENT CONNECTED ==================",
    `\nSocket ID      : ${socket.id}`,
    "\n======================================================"
  );
};

const newMessageHandler = (lobbyServer, socket) => (msg, isBinary) => {
  lobbyServer.trackDownload(msg);

  // Binary is special cased to be as close to the socket.on"message" call
  if (isBinary) {
    for (const player of socket.lobby?.connected ?? [])
      if (player !== socket) player.send(msg);
    return;
  }

  const message = JSON.parse(msg.toString());
  console.log(
    "\n================== RECEIVED ==================",
    `\nDestination ID : ${socket.id}`,
    "\nPayload        :",
    message,
    "\n============================================="
  );

  switch (message.command) {
    case "reconnect":
      return lobbyServer.awakeSocket(socket, message.id);

    case "create lobby":
      return lobbyServer.createLobby(socket);

    case "join lobby":
      return lobbyServer.joinLobby(socket, message.lobbyCode);

    case "leave lobby":
      return lobbyServer.leaveLobby(socket);

    case "set map size":
      return socket.lobby?.setSize(message.size);

    case "join team":
      return socket.lobby?.joinTeam(socket, message.team);

    case "name change":
      socket.name = message.name;
      return socket.lobby?.sendNames(socket);

    case "start game":
      return socket.lobby?.startGame(socket);

    case "client ready":
      return socket.lobby?.clientReady(socket);

    case "obstacles":
      return socket.lobby?.distributeObstacles(socket, message.obstacles);

    case "has obstacles":
      return socket.lobby?.clientHasObstacles(socket);

    case "virtual server started":
      return socket.lobby?.virtualServerStarted(socket);

    case "new shots":
      return socket.lobby?.playerShot(socket, message.newShots, message.tick);

    case "round end":
      return socket.lobby?.clientRoundEnded(socket);

    case "preview obstacle":
      return socket.lobby?.previewObstacle(socket, message);
    
    case "confirm obstacle":
      return socket.lobby?.confirmObstacle(socket, message);

    case "has confirmed obstacle":
      return socket.lobby?.clientHasConfirmObstacle(socket);

    case "virtual server stopped":
      return socket.lobby?.virtualServerStopped(socket);
  }
};

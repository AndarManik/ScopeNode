import { newLobbyCode } from "./namegen.js";
import { newLobby } from "./lobby.js";
import { newSocketConnector } from "./serversocket.js";

export const newLobbyServer = (webSocketServer) => {
  const lobbies = new Map();
  const sockets = new Map();

  const lobbyServer = { lobbies, sockets };

  let download = 0;
  lobbyServer.trackDownload = (message) => {
    const bytes = getMessageSize(message);
    download += bytes;
    setTimeout(() => (download -= bytes), 1000);
  };
  let upload = 0;
  lobbyServer.trackUpload = (message) => {
    const bytes = getMessageSize(message);
    upload += bytes;
    setTimeout(() => (upload -= bytes), 1000);
  };

  lobbyServer.logNetwork = setInterval(() => {
    return;
    console.log(
      "^" + formatMetric(upload) + "/s",
      "v" + formatMetric(download) + "/s"
    );
  }, 1000);

  lobbyServer.registerSocket = (socket) => sockets.set(socket.id, socket);

  lobbyServer.sleepSocket = (socket) => {
    socket.disconnectTimeout = setTimeout(() => {
      lobbyServer.leaveLobby(socket);
      sockets.delete(socket.id);
    }, 15000);
  };

  lobbyServer.awakeSocket = (socket, id) => {
    const oldSocket = sockets.get(id);
    if (!oldSocket) return socket.json({ command: "no socket" });
    clearTimeout(oldSocket.disconnectTimeout);
    sockets.set(oldSocket.id, socket);

    socket.id = oldSocket.id;
    socket.lobby = oldSocket.lobby;

    socket.json({ command: "socket reconnected" });
    oldSocket.lastSentMessages.forEach((msg) => socket.send(msg));
    console.log("sending " + oldSocket.lastSentMessages.length + " messages");
    oldSocket.unsentMessages.forEach((msg) => socket.send(msg));
    console.log("sending " + oldSocket.unsentMessages.length + " messages");
    socket.lobby?.awakeConnection(oldSocket, socket);
  };

  lobbyServer.leaveLobby = (socket) => {
    socket.lobby?.removeConnection(socket);
    socket.lobby = null;
  };

  lobbyServer.createLobby = (socket) => {
    let lobbyCode = newLobbyCode();
    for (let i = 0; i < 100 && lobbies.has(lobbyCode); i++)
      lobbyCode = newLobbyCode();

    if (lobbies.has(lobbyCode))
      return socket.json({ command: "lobby overload" });

    socket.lobby = newLobby(lobbyCode);
    lobbies.set(lobbyCode, socket.lobby);
    socket.lobby.addConnection(socket);

    socket.json({ command: "join lobby", lobbyCode });
  };

  lobbyServer.joinLobby = (socket, lobbyCode) => {
    lobbyServer.leaveLobby(socket);

    if (!lobbies.has(lobbyCode)) return socket.json({ command: "no lobby" });

    socket.lobby = lobbies.get(lobbyCode);
    lobbies.set(lobbyCode, socket.lobby);
    socket.lobby.addConnection(socket);

    socket.json({ command: "join lobby", lobbyCode });
  };

  lobbies.removeDeadLobbies = setInterval(() => {
    for (const [code, lobby] of lobbies)
      if (!lobby.connected.size) lobbies.delete(code);
  }, 30000);

  lobbies.removeDeadSockets = setInterval(() => {
    for (const socket of webSocketServer.clients) {
      if (!socket.isAlive) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);

  webSocketServer.on("connection", newSocketConnector(lobbyServer));

  return lobbies;
};

function getMessageSize(message) {
  if (typeof message === "string") return Buffer.byteLength(message, "utf8");
  if (Buffer.isBuffer(message) || message instanceof ArrayBuffer)
    return message.byteLength ?? message.length;
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

const formatMetric = (bytes) => {
  if (bytes < 1000) return bytes + " B";
  if (bytes < 1e6) return (bytes / 1e3).toFixed(2) + " KB";
  if (bytes < 1e9) return (bytes / 1e6).toFixed(2) + " MB";
  if (bytes < 1e12) return (bytes / 1e9).toFixed(2) + " GB";
  return (bytes / 1e12).toFixed(2) + " TB";
};

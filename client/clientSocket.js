export const newSocket = (app) => {
  const url = `${location.protocol.replace("http", "ws")}//${location.host}`;

  let hotSocket;
  let latencyMs = 0;

  const socket = {};
  socket.unsentMessages = [];
  socket.message = new Set();

  const sendNow = (message) => {
    if (hotSocket.readyState === WebSocket.OPEN) hotSocket.send(message);
    else socket.unsentMessages.push(message);
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
      tempUnsent.forEach(socket.send);
      hotSocket.removeEventListener("message", reconnectMessage);
    };
    if (!latencyMs) handle();
    else setTimeout(handle, latencyMs);
  };

  const defaultMessage = (message) => {
    const handle = () => {
      for (const messageHandler of socket.message) messageHandler(message);
    };
    if (!latencyMs) handle();
    else setTimeout(handle, latencyMs);
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

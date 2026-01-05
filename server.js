import { fileURLToPath } from "url";
import express from "express";
import path from "path";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { newLobbyServer } from "./lobbyServer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "client")));

const clientPath = path.join(__dirname, "client", "client.html");
app.get("/", (req, res) => res.sendFile(clientPath));
app.get("/:lobby", (req, res) => res.sendFile(clientPath));

const server = createServer(app);
const webSocketServer = new WebSocketServer({ server });

const PORT = process.env.PORT || 9001;
server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
newLobbyServer(webSocketServer);

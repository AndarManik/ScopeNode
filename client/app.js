import { addUserSettings } from "./usersettings.js";
import { newColor } from "./color.js";
import { newSocket } from "./clientSocket.js";
import { newMenu } from "./menu.js";
import { main } from "./menu/main.js";
import { newGame } from "./game.js";
import { newStats } from "./stats.js";
import { newConsole } from "./console.js";

const app = {};
addUserSettings(app);
app.stats = newStats(app);
app.color = newColor(app);
app.socket = newSocket(app);
app.menu = newMenu(app);
app.game = newGame(app);
app.console = newConsole(app);
main(app);

window.addEventListener("error", (e) =>
  console.error("Global error:", e.error || e.message),
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("Unhandled promise rejection:", e.reason),
);

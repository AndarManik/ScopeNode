import { addUserSettings } from "./usersettings.js";
import { newColor } from "./color.js";
import { newSocket } from "./clientSocket.js";
import { newMenu } from "./menu.js";
import { main } from "./menu/main.js";
import { newGame } from "./game.js";
import { newStats } from "./stats.js";

const app = {};
addUserSettings(app);
app.stats = newStats(app);
app.color = newColor(app);
app.socket = newSocket(app);
app.menu = newMenu(app);
app.game = newGame(app);
main(app);

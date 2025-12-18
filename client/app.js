import { addUserSettings } from "./usersettings.js";
import { newColor } from "./color.js";
import { newSocket } from "./clientSocket.js";
import { newMenu } from "./menu.js";
import { main } from "./menu/main.js";
import { newGame } from "./game.js";

//import "./gamealpha/alpha/client.js";

const app = {};
addUserSettings(app);
app.color = newColor(app);
app.game = newGame(app);
app.socket = newSocket(app);
app.menu = newMenu(app);
main(app);

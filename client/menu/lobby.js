import { jiggleApp } from "../screentransform.js";
import { main } from "./main.js";

export const lobby = (app) => {
  const { menu } = app;

  jiggleApp();
  menu.reset();
  menu.scene = lobby;
  menu.addBasicHeader();

  const backToMain = menu.newEl(3, 1, 3, 1, "button");
  backToMain.innerText = "Leave Lobby";
  backToMain.addEventListener("click", () => {
    if (backToMain.innerText === "Leave Lobby")
      backToMain.innerText = "You sure?";
    else {
      app.socket.json({ command: "leave lobby" });
      main(app);
    }
  });

  const spec = menu.newEl(12, 1, 3, 1, "button");
  spec.style.cursor = "pointer";
  const specMessage = { command: "join team", team: "spec" };
  spec.addEventListener("click", () => app.socket.json(specMessage));

  const team1 = [];
  const team2 = [];
  const team1Message = { command: "join team", team: "team1" };
  const team2Message = { command: "join team", team: "team2" };

  for (let i = 0; i < 5; i++) {
    const user1 = menu.newEl(3, 4 + i, 5, 1, "div");
    user1.style.backgroundColor = "var(--inputLeftOff)";
    user1.addEventListener("click", () => app.socket.json(team1Message));
    team1.push(user1);
    const user2 = menu.newEl(10, 4 + i, 5, 1, "div");
    user2.style.backgroundColor = "var(--inputRightOff)";
    user2.addEventListener("click", () => app.socket.json(team2Message));
    team2.push(user2);
  }

  menu.lobbyTeams = { spec, team1, team2 };
  updateLobbyNames(menu);

  const mapSize = menu.newEl(1, 11, 6, 1);
  mapSize.innerText = "Map Size";
  mapSize.style.fontSize = "20px";

  const lobbyCode = menu.newEl(7, 11, 6, 1);
  lobbyCode.innerText = "Lobby Code: " + menu.lobbyCode;
  lobbyCode.style.cursor = "pointer";
  lobbyCode.addEventListener("click", () => {
    if (lobbyCode.bounceTimeout) clearTimeout(lobbyCode.bounceTimeout);
    navigator.clipboard.writeText(menu.lobbyCode);
    lobbyCode.innerText = "Copied " + menu.lobbyCode + " to clipboard";
    lobbyCode.bounceTimeout = setTimeout(() => {
      lobbyCode.innerText = "Lobby Code: " + menu.lobbyCode;
    }, 1500);
  });

  const small = menu.newEl(1, 12, 4, 1, "button");
  small.innerText = "Small";
  small.style.fontSize = "20px";
  const smallMessage = { command: "set map size", size: "small" };
  small.addEventListener("click", () => app.socket.json(smallMessage));

  const medium = menu.newEl(5, 12, 4, 1, "button");
  medium.innerText = "Medium";
  medium.style.fontSize = "20px";
  const mediumMessage = { command: "set map size", size: "medium" };
  medium.addEventListener("click", () => app.socket.json(mediumMessage));

  const large = menu.newEl(9, 12, 4, 1, "button");
  large.innerText = "Large";
  large.style.fontSize = "20px";
  const largeMessage = { command: "set map size", size: "large" };
  large.addEventListener("click", () => app.socket.json(largeMessage));

  menu.lobbySizeButtons = { small, medium, large };
  updateLobbySize(menu);

  const start = menu.newEl(13, 11, 4, 2, "button");
  start.innerText = "Start";
  start.style.fontSize = "40px";
  const startMessage = { command: "start game" };
  start.addEventListener("click", () => app.socket.json(startMessage));
};

// CALM: there needs to be two types of id, which are public and private
export const updateLobbyNames = (menu) => {
  if (!menu.lobbyTeams) return;
  const { spec, team1, team2 } = menu.lobbyTeams;
  spec.innerText = "SPEC: " + menu.spec;

  for (let i = 0; i < 5; i++) {
    const user = team1[i];
    user.style.backgroundColor = "var(--inputLeftOff)";
    user.innerText = "";
    user.style.border = "4px solid var(--inputLeftOff)";

    if (!menu.team1 || i >= menu.team1.length) continue;
    user.innerText = menu.team1[i].name;
    user.style.backgroundColor = "var(--lightLeft)";

    if (menu.team1[i].userId === menu.userId) user.style.border = ""; //"4px solid var(--inputLeftOff)";
  }

  for (let i = 0; i < 5; i++) {
    const user = team2[i];
    user.style.backgroundColor = "var(--inputRightOff)";
    user.innerText = "";
    user.style.border = "4px solid var(--inputRightOff)";

    if (!menu.team2 || i >= menu.team2.length) continue;
    user.innerText = menu.team2[i].name;
    user.style.backgroundColor = "var(--lightRight)";

    if (menu.team2[i].userId === menu.userId) user.style.border = ""; //"4px solid var(--inputRightOff)";
  }
};

export const updateLobbySize = (menu) => {
  if (!menu.lobbySizeButtons) return;
  const { small, medium, large } = menu.lobbySizeButtons;
  small.style.backgroundColor =
    menu.size === "small" ? "var(--input)" : "var(--inputOff)";
  medium.style.backgroundColor =
    menu.size === "medium" ? "var(--input)" : "var(--inputOff)";
  large.style.backgroundColor =
    menu.size === "large" ? "var(--input)" : "var(--inputOff)";
};

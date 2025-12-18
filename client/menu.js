import { jiggleApp } from "./screentransform.js";
import { lobby, updateLobbyNames, updateLobbySize } from "./menu/lobby.js";
import { settings } from "./menu/settings.js";
import { newGame } from "./game.js";

export const newMenu = (app) => {
  const menuEl = document.getElementById("Menu");
  const menuChildrenEls = new Set();

  const menu = {};

  menu.toggle = () => {
    menuEl.style.display = menuEl.style.display === "none" ? "grid" : "none";
    jiggleApp();
  };
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" && event.key !== "Esc") return;
    menu.toggle();
  });

  const cellSize = 64;
  const cols = Math.floor(menuEl.clientWidth / cellSize);
  const rows = Math.floor(menuEl.clientHeight / cellSize);
  const maxDist = 512;
  const fillers = new Map();

  let mouseX = 0;
  let mouseY = 0;
  const rect = menuEl.getBoundingClientRect();
  let lightX = rect.left + rect.width / 2;
  let lightY = rect.top + rect.height / 2;
  let velX = 0;
  let velY = 0;
  document.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  const stiffness = 30; // k: higher = snappier spring
  const damping = 10; // c: higher = more damped
  const setFillerColor = (filler) => {
    const rect = filler.getBoundingClientRect();
    const dx = Math.max(rect.left - lightX, 0, lightX - rect.right);
    const dy = Math.max(rect.top - lightY, 0, lightY - rect.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const t = Math.max(0, 1 - dist / maxDist);
    filler.style.opacity = (0.5 * t ** 3).toFixed(2);
  };
  let lastTime = performance.now();
  const update = (now) => {
    let dt = (now - lastTime) / 1000; // seconds
    lastTime = now;
    if (dt > 0.05) dt = 0.05;
    const dx = lightX - mouseX;
    const dy = lightY - mouseY;
    const ax = -stiffness * dx - damping * velX;
    const ay = -stiffness * dy - damping * velY;
    velX += ax * dt;
    velY += ay * dt;
    lightX += velX * dt;
    lightY += velY * dt;
    fillers.forEach(setFillerColor);
    requestAnimationFrame(update);
  };
  requestAnimationFrame(update);

  // build the grid
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= cols; x++) {
      const filler = document.createElement("div");
      filler.className = "grid-item";
      filler.style.gridColumn = `${x} / span 1`;
      filler.style.gridRow = `${y} / span 1`;
      filler.style.opacity = "0";
      filler.style.backgroundColor = "var(--input)";
      fillers.set(y * cols + x, filler);
      menuEl.appendChild(filler);
    }
  }

  menu.newEl = (x, y, width, height, type = "div") => {
    const element = document.createElement(type);
    if (type == "div") {
      element.className = "grid-item";
      element.style.backgroundColor = "var(--light)";
    }
    element.style.gridColumn = `${x} / span ${width}`;
    element.style.gridRow = `${y} / span ${height}`;
    for (let H = 0; H < height; H++)
      for (let W = 0; W < width; W++)
        fillers.get((y + H) * cols + (x + W)).style.display = "none";
    element.fillerSize = { x, y, width, height };
    menuEl.appendChild(element);
    menuChildrenEls.add(element);

    return element;
  };

  menu.renewEl = (element) => {
    if (!element.fillerSize) return;
    const { x, y, width, height } = element.fillerSize;
    for (let H = 0; H < height; H++)
      for (let W = 0; W < width; W++)
        fillers.get((y + H) * cols + (x + W)).style.display = "none";
    element.fillerSize = { x, y, width, height };
    menuEl.appendChild(element);
    menuChildrenEls.add(element);

    return element;
  };

  menu.deleteEl = (element) => {
    if (!menuChildrenEls.has(element)) return;

    menuEl.removeChild(element);
    menuChildrenEls.delete(element);
    const { x, y, width, height } = element.fillerSize;
    for (let H = 0; H < height; H++)
      for (let W = 0; W < width; W++)
        fillers.get((y + H) * cols + (x + W)).style.display = "flex";
    fillers.forEach(setFillerColor);
  };

  menu.reset = () => {
    for (const element of menuChildrenEls) menu.deleteEl(element);
  };

  menu.addBasicHeader = () => {
    const title = menu.newEl(6, 1, 6, 1);
    title.innerText = "Scope Node: Insta Kill";

    const settingsButton = menu.newEl(15, 1, 2, 1, "button");
    settingsButton.innerText = "Settings";
    settingsButton.addEventListener("click", () => settings(app));

    const escape = menu.newEl(1, 1, 2, 1, "button");
    escape.innerText = `Esc`;
    escape.addEventListener("click", menu.toggle);
  };

  menu.socketHandler = (message) => {
    if (typeof message.data !== "string")
      return app.game.handleMessage(message);

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
        app.socket.json({ command: "client ready" });
        menu.toggle();
        jiggleApp();
        return;
      }

      case "start virtual server": {
        app.game.start();
        return;
      }
    }
  };

  app.socket.message.add(menu.socketHandler);

  return menu;
};

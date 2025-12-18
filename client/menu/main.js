import { jiggleApp } from "../screentransform.js";
import { join } from "./join.js";

export const main = (app) => {
  const { menu, socket } = app;
  jiggleApp();
  menu.reset();
  menu.scene = main;
  menu.addBasicHeader();

  const create = menu.newEl(2, 5, 6, 2, "button");
  create.innerText = "Create Lobby";
  create.style.fontSize = "40px";
  create.addEventListener("click", () =>
    socket.json({ command: "create lobby" })
  );

  const joinButton = menu.newEl(10, 5, 6, 2, "button");
  joinButton.innerText = "Join Lobby";
  joinButton.style.fontSize = "40px";
  joinButton.addEventListener("click", () => join(app));

  const practice = menu.newEl(6, 8, 6, 2, "button");
  practice.innerText = "Practice";
  practice.style.fontSize = "40px";
};

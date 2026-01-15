import { jiggleApp } from "../screentransform.js";
import { main } from "./main.js";

export const join = (app) => {
  const { menu, socket } = app;
  jiggleApp();
  menu.reset();
  menu.scene = join;
  menu.addBasicHeader();

  const backToMain = menu.newEl(3, 1, 3, 1, "button");
  backToMain.innerText = "Main Menu";
  backToMain.addEventListener("click", () => main(app));

  const input = menu.newEl(6, 6, 6, 1, "input");
  input.placeholder = "Enter Lobby Code";
  input.style.backgroundColor = "var(--light)";
  input.addEventListener("input", () => {
    menu.deleteEl(joinButton);
    if (couldBeLobbyCode(input.value + "")) menu.renewEl(joinButton);
  });
  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (couldBeLobbyCode(input.value + "")) joinButton.click();
  });
  setTimeout(() => input.focus(), 0);

  // pops out only when the input is legal
  const joinButton = menu.newEl(6, 7, 6, 1, "button");
  menu.deleteEl(joinButton);
  joinButton.style.position = "relative";
  joinButton.style.zIndex = 10;
  joinButton.innerText = "Join";
  joinButton.addEventListener("click", () =>
    socket.json({ command: "join lobby", lobbyCode: input.value })
  );
};

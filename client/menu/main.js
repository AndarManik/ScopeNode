import { jiggleApp } from "../screentransform.js";
import { join } from "./join.js";

export const main = (app) => {
  const { menu, socket } = app;
  jiggleApp();
  menu.reset();
  menu.scene = main;
  menu.addBasicHeader();

  const create = menu.newEl(2, 6, 6, 2, "button");
  create.innerText = "Private Lobby";
  create.style.fontSize = "40px";
  create.addEventListener("click", () =>
    socket.json({ command: "create lobby" })
  );

  const joinButton = menu.newEl(10, 6, 6, 2, "button");
  joinButton.innerText = "Public (TBA)";
  joinButton.style.fontSize = "40px";
  joinButton.addEventListener("click", () => {});

  const info = menu.newEl(16, 12, 1, 1, "button");
  info.innerText = "?";
  info.style.background = "var(--light)";
  info.addEventListener("click", () => {
    menu.deleteEl(info);
    const expand = menu.newEl(4, 9, 10, 2, "button");
    expand.innerText = `You do NOT shoot manually.
Standing in bright regions of your color kill instantly.
Standing in bright regions of the other color kill YOU.
Touch the center orb to win the round instantly.
`;
    expand.style.textAlign = "left";
    expand.style.background = "var(--light)";

    expand.addEventListener("click", () => {
      menu.deleteEl(expand);
      menu.renewEl(info);
    });
  });

  const v = menu.newEl(1, 12, 1, 1);
  v.innerText = "v0.1.2";
  v.style.fontSize = "12px";
};

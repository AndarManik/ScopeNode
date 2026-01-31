import { jiggleApp } from "../screentransform.js";

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

    const lines = [
      "Your node will automatically shoot what it sees.",
      "Seek your team color and avoid the enemy color.",
      "Touch the center orb to win the round instantly.",
    ];

    const baseX = 4;
    const baseY = 9;
    const width = 10;

    const expands = [];
    let idx = 0;

    const collapse = () => {
      for (const el of expands) menu.deleteEl(el);
      menu.renewEl(info);
    };

    const revealNext = () => {
      if (idx >= lines.length) return collapse();
      const el = menu.newEl(baseX, baseY + idx, width, 1, "button");
      el.innerText = lines[idx];
      el.style.textAlign = "left";
      el.style.background = "var(--light)";
      el.addEventListener("click", revealNext);
      expands.push(el);
      idx++;
    };

    revealNext();
  });

  const v = menu.newEl(1, 12, 1, 1);
  v.innerText = "v0.1.2";
  v.style.fontSize = "12px";
};

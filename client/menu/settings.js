import { jiggleApp } from "../screentransform.js";

export const settings = (app) => {
  const { menu, socket } = app;
  jiggleApp();
  menu.reset();
  menu.addBasicHeader();
  const previousScene = menu.scene;
  menu.scene = settings;

  const title = menu.newEl(6, 1, 6, 1);
  title.innerText = "Scope Node: Protocol";

  const returnButton = menu.newEl(15, 1, 2, 1, "button");
  returnButton.innerText = "Back";
  returnButton.addEventListener("click", () => previousScene(app));

  const escape = menu.newEl(1, 1, 2, 1, "button");
  escape.innerText = `Esc`;
  escape.addEventListener("click", menu.toggle);

  // actual settings

  const nameTitle = menu.newEl(2, 3, 5, 1, "div");
  nameTitle.innerText = "Username";

  const nameInput = menu.newEl(2, 4, 5, 1, "input");
  nameInput.style.backgroundColor = "var(--input)";
  nameInput.value = app.name;
  let nameInputDebounce;
  nameInput.addEventListener("input", () => {
    nameInput.value = nameInput.value.slice(0, 100);
    app.name = nameInput.value;
    localStorage.setItem("name", nameInput.value);

    clearTimeout(nameInputDebounce);

    nameInputDebounce = setTimeout(() => {
      socket.json({ command: "name change", name: nameInput.value });
    }, 1000);
  });

  // Row 1 (y = 3)
  const samples = [
    "--lightLeft",
    "--inputLeft",
    "--inputLeftOff",
    "--light",
    "--input",
    "--inputOff",
    "--lightRight",
    "--inputRight",
    "--inputRightOff",
  ];

  const startX = 3;
  const startY = 6;
  const endX = 5;

  let x = startX;
  let y = startY;

  for (const cssVar of samples) {
    const el = menu.newEl(x, y, 1, 1, "div");
    el.style.backgroundColor = `var(${cssVar})`;

    x++;
    if (x > endX) {
      x = startX;
      y++;
    }
  }

  const hueTitle = menu.newEl(8, 3, 8, 1, "div");
  hueTitle.innerText = "Game Hue";

  const hueInput = menu.newEl(8, 4, 8, 1, "input");
  hueInput.type = "range";
  hueInput.min = "0";
  hueInput.max = "360";
  hueInput.step = "1";
  hueInput.value = app.color.hue ?? 0;
  hueInput.style.backgroundColor = "var(--input)";

  hueInput.addEventListener("input", () => {
    const hue = Number(hueInput.value);
    app.color.setHue(hue);
  });
};

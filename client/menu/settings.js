import { jiggleApp } from "../screentransform.js";

export const settings = (app) => {
  const { menu, socket } = app;
  jiggleApp();
  menu.reset();
  menu.addBasicHeader();
  const previousScene = menu.scene;
  menu.scene = settings;

  const title = menu.newEl(6, 1, 6, 1);
  title.innerText = "Scope Node: Insta Kill";

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
};

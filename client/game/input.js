export const newMouse = (game) => {
  const { playerRadius, mapWidth, mapHeight } = game;
  const canvas = document.getElementById("Game");
  const mouse = [0, 0];
  const maxX = mapWidth - playerRadius;
  const maxY = mapHeight - playerRadius;
  const handleMove = (e) => {
    if (game.isDead) document.removeEventListener("mousemove", handleMove);
    const rect = canvas.getBoundingClientRect();
    mouse[0] = e.clientX - rect.left;
    if (mouse[0] < playerRadius) mouse[0] = playerRadius;
    if (mouse[0] > maxX) mouse[0] = maxX;
    mouse[1] = e.clientY - rect.top;
    if (mouse[1] < playerRadius) mouse[1] = playerRadius;
    if (mouse[1] > maxY) mouse[1] = maxY;
  };
  const handleMouseDown = () => {
    if (game.isDead)
      document.removeEventListener("mousedown", handleMouseDown);
    mouse.isClicking = true;
  };
  const handleMouseUp = () => {
    if (game.isDead) document.removeEventListener("mouseup", handleMouseUp);
    mouse.isClicking = false;
  };
  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mouseup", handleMouseUp);
  return mouse;
};

export const newKeyBoard = (game) => {
  const keyboard = {
    shift: false,
    ctrl: false,
  };

  const keydown = (e) => {
    if (game.isDead) document.removeEventListener("keydown", keydown);
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      keyboard.shift = true;
    if (e.code === "ControlLeft" || e.code === "ControlRight")
      keyboard.ctrl = true;
  };
  document.addEventListener("keydown", keydown);

  const keyup = (e) => {
    if (game.isDead) document.removeEventListener("keyup", keyup);
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      keyboard.shift = false;
    if (e.code === "ControlLeft" || e.code === "ControlRight")
      keyboard.ctrl = false;
  };
  document.addEventListener("keyup", keyup);
  return keyboard;
};

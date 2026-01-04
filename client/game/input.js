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
    mouse[1] = rect.bottom - e.clientY;
    if (mouse[1] < playerRadius) mouse[1] = playerRadius;
    if (mouse[1] > maxY) mouse[1] = maxY;
  };

  const handleMouseDown = (e) => {
    if (game.isDead) document.removeEventListener("mousedown", handleMouseDown);
    if (e.button !== 0) return;
    mouse.isClicking = true;
  };

  const handleMouseUp = (e) => {
    if (game.isDead) document.removeEventListener("mouseup", handleMouseUp);
    if (e.button !== 0) return;
    mouse.isClicking = false;
  };

  const handleWheel = (e) => {
    if (game.isDead) document.removeEventListener("wheel", handleWheel);

    if (!game.choosingObstacle) return;
    if (game.keyboard?.shift) {
      game.previewAlpha += Math.sign(e.deltaY) / 45;
      game.previewAlpha = ((game.previewAlpha % 1) + 1) % 1;
    } else {
      game.previewAngle += (Math.sign(e.deltaY) * Math.PI) / 30;
    }
  };

  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("wheel", handleWheel, { passive: false });

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

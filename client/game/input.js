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

    const { w, a, s, d } = game.keyboard;
    if (w || a || s || d) game.inputPreference = "wasd"
    else game.inputPreference = "mouse";
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

    w: false,
    a: false,
    s: false,
    d: false,

    space: false,
  };

  const keydown = (e) => {
    if (game.isDead) document.removeEventListener("keydown", keydown);

    switch (e.code) {
      case "ShiftLeft":
      case "ShiftRight":
        (keyboard.shift = true);
        break;
      case "ControlLeft":
      case "ControlRight":
        (keyboard.ctrl = true);
        break;
      case "KeyW":
        (keyboard.w = true);
        break;
      case "KeyA":
        (keyboard.a = true);
        break;
      case "KeyS":
        (keyboard.s = true);
        break;
      case "KeyD":
        (keyboard.d = true);
        break;
      case "Space":
        (keyboard.space = true);
        break;
    }

    const { w, a, s, d } = keyboard;
    if (w || a || s || d) game.inputPreference = "wasd"
  };

  const keyup = (e) => {
    if (game.isDead) document.removeEventListener("keyup", keyup);

    switch (e.code) {
      case "ShiftLeft":
      case "ShiftRight":
        (keyboard.shift = false);
        break;
      case "ControlLeft":
      case "ControlRight":
        (keyboard.ctrl = false);
        break;
      case "KeyW":
        (keyboard.w = false);
        break;
      case "KeyA":
        (keyboard.a = false);
        break;
      case "KeyS":
        (keyboard.s = false);
        break;
      case "KeyD":
        (keyboard.d = false);
        break;
      case "Space":
        (keyboard.space = false);
        break;
    }
  };

  document.addEventListener("keydown", keydown);
  document.addEventListener("keyup", keyup);

  return keyboard;
};


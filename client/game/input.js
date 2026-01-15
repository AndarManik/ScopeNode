export const newMouse = (game, menu) => {
  const { playerRadius, mapWidth, mapHeight } = game;
  const canvas = document.getElementById("Game");
  const mouse = [0, 0];
  const maxX = mapWidth - playerRadius;
  const maxY = mapHeight - playerRadius;

  const handleMove = (e) => {
    if (menu.open) return;
    if (game.isDead) document.removeEventListener("mousemove", handleMove);
    const rect = canvas.getBoundingClientRect();
    mouse[0] = e.clientX - rect.left;
    if (mouse[0] < playerRadius) mouse[0] = playerRadius;
    if (mouse[0] > maxX) mouse[0] = maxX;
    mouse[1] = rect.bottom - e.clientY;
    if (mouse[1] < playerRadius) mouse[1] = playerRadius;
    if (mouse[1] > maxY) mouse[1] = maxY;

    const { w, a, s, d } = game.keyboard;
    if (w || a || s || d) game.inputPreference = "wasd";
    else game.inputPreference = "mouse";
  };

  const handleMouseDown = (e) => {
    if (menu.open) return;
    if (game.isDead) document.removeEventListener("mousedown", handleMouseDown);
    if (e.button !== 0) return;
    mouse.isClicking = true;
  };

  const handleMouseUp = (e) => {
    if (menu.open) return;
    if (game.isDead) document.removeEventListener("mouseup", handleMouseUp);
    if (e.button !== 0) return;
    mouse.isClicking = false;
  };

  const handleWheel = (e) => {
    if (menu.open) return;
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

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
]);

export const newKeyBoard = (game, menu) => {
  const keyboard = {
    shift: false,
    ctrl: false,
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
  };

  const handleKey = (e, isDown) => {
    if (menu.open) return;
    if (game.isDead) {
      document.removeEventListener("keydown", keydown, { passive: false });
      document.removeEventListener("keyup", keyup, { passive: false });
      return;
    }

    // ----- Block propagation for movement keys -----
    if (MOVEMENT_KEYS.has(e.code)) {
      e.stopPropagation(); // prevent your own UI keybind handlers
      e.preventDefault(); // prevent browser scroll / spacebar page-down
    }

    switch (e.code) {
      case "ShiftLeft":
      case "ShiftRight":
        keyboard.shift = isDown;
        break;
      case "ControlLeft":
      case "ControlRight":
        keyboard.ctrl = isDown;
        break;
      case "KeyW":
        keyboard.w = isDown;
        break;
      case "KeyA":
        keyboard.a = isDown;
        break;
      case "KeyS":
        keyboard.s = isDown;
        break;
      case "KeyD":
        keyboard.d = isDown;
        break;
      case "Space":
        keyboard.space = isDown;
        break;
    }
    const { w, a, s, d } = keyboard;

    if (isDown && (w || a || s || d)) game.inputPreference = "wasd";

    if (game.mouse.isClicking && !w && !a && !s && !d)
      game.inputPreference = "mouse";
  };

  const keydown = (e) => handleKey(e, true);
  const keyup = (e) => handleKey(e, false);

  document.addEventListener("keydown", keydown, { passive: false });
  document.addEventListener("keyup", keyup, { passive: false });

  return keyboard;
};

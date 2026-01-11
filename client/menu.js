import { jiggleApp } from "./screentransform.js";
import { settings } from "./menu/settings.js";

export const newMenu = (app) => {
  const appEl = document.getElementById("App");
  const menuEl = document.getElementById("Menu");
  const menuChildrenEls = new Set();

  const menu = { open: true };

  menu.toggle = () => {
    menu.open = !menu.open;

    menuEl.style.display = menu.open ? "grid" : "none";
    appEl.style.cursor = menu.open ? "default" : "none";

    jiggleApp();

    if (menu.open) requestAnimationFrame(update);
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" && event.key !== "Esc") return;
    menu.toggle();
  });

  const cellSize = 64;
  const cols = Math.floor(menuEl.clientWidth / cellSize);
  const rows = Math.floor(menuEl.clientHeight / cellSize);
  const maxDist = 512;
  const fillers = new Map();

  let mouseX = 0;
  let mouseY = 0;
  const rect = menuEl.getBoundingClientRect();
  let lightX = rect.left + rect.width / 2;
  let lightY = rect.top + rect.height / 2;
  let velX = 0;
  let velY = 0;
  document.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  const stiffness = 30; // k: higher = snappier spring
  const damping = 10; // c: higher = more damped
  const setFillerColor = (filler) => {
    const rect = filler.getBoundingClientRect();
    const dx = Math.max(rect.left - lightX, 0, lightX - rect.right);
    const dy = Math.max(rect.top - lightY, 0, lightY - rect.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const t = Math.max(0, 1 - dist / maxDist);
    filler.style.opacity = (0.5 * t ** 3).toFixed(2);
  };
  let lastTime = performance.now();
  const update = (now) => {
    if (!menu.open) return;
    let dt = (now - lastTime) / 1000; // seconds
    lastTime = now;
    if (dt > 0.05) dt = 0.05;
    const dx = lightX - mouseX;
    const dy = lightY - mouseY;
    const ax = -stiffness * dx - damping * velX;
    const ay = -stiffness * dy - damping * velY;
    velX += ax * dt;
    velY += ay * dt;
    lightX += velX * dt;
    lightY += velY * dt;
    fillers.forEach(setFillerColor);
    requestAnimationFrame(update);
  };
  requestAnimationFrame(update);

  // build the grid
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= cols; x++) {
      const filler = document.createElement("div");
      filler.className = "grid-item";
      filler.style.gridColumn = `${x} / span 1`;
      filler.style.gridRow = `${y} / span 1`;
      filler.style.opacity = "0";
      filler.style.backgroundColor = "var(--input)";
      fillers.set(y * cols + x, filler);
      menuEl.appendChild(filler);
    }
  }

  menu.newEl = (x, y, width, height, type = "div") => {
    const element = document.createElement(type);
    if (type === "div") {
      element.className = "grid-item";
      element.style.backgroundColor = "var(--light)";
    }

    element.style.gridColumn = `${x} / span ${width}`;
    element.style.gridRow = `${y} / span ${height}`;
    element.fillerSize = { x, y, width, height };

    // Compute the grid-rect bounds
    const xEnd = x + width - 1;
    const yEnd = y + height - 1;

    // If completely outside the menu grid, don't append or touch fillers.
    // Still return the element so callers can keep references if they want.
    const fullyOffGrid = x > cols || xEnd < 1 || y > rows || yEnd < 1;

    if (!fullyOffGrid) {
      // Only track + append when actually on-grid in some way
      menuEl.appendChild(element);
      menuChildrenEls.add(element);

      // Hide underlying fillers, but only within bounds
      for (let H = 0; H < height; H++) {
        const gy = y + H;
        if (gy < 1 || gy > rows) continue;

        for (let W = 0; W < width; W++) {
          const gx = x + W;
          if (gx < 1 || gx > cols) continue;

          const filler = fillers.get(gy * cols + gx);
          if (filler) filler.style.display = "none";
        }
      }
    }

    return element;
  };

  menu.renewEl = (element) => {
    if (!element.fillerSize) return null;
    const { x, y, width, height } = element.fillerSize;

    const xEnd = x + width - 1;
    const yEnd = y + height - 1;

    // If region is completely off-grid, don't bother re-adding
    if (y > rows || yEnd < 1 || x > cols || xEnd < 1) {
      return null;
    }

    // Re-hide underlying fillers with bounds checks
    for (let H = 0; H < height; H++) {
      const gy = y + H;
      if (gy < 1 || gy > rows) continue;

      for (let W = 0; W < width; W++) {
        const gx = x + W;
        if (gx < 1 || gx > cols) continue;

        const filler = fillers.get(gy * cols + gx);
        if (filler) filler.style.display = "none";
      }
    }

    menuEl.appendChild(element);
    menuChildrenEls.add(element);

    return element;
  };

  menu.deleteEl = (element) => {
    if (!menuChildrenEls.has(element)) return;

    menuEl.removeChild(element);
    menuChildrenEls.delete(element);

    if (!element.fillerSize) return;

    const { x, y, width, height } = element.fillerSize;

    // Re-show fillers with bounds checks
    for (let H = 0; H < height; H++) {
      const gy = y + H;
      if (gy < 1 || gy > rows) continue;

      for (let W = 0; W < width; W++) {
        const gx = x + W;
        if (gx < 1 || gx > cols) continue;

        const filler = fillers.get(gy * cols + gx);
        if (filler) filler.style.display = "flex";
      }
    }

    fillers.forEach(setFillerColor);
  };

  menu.reset = () => {
    for (const element of menuChildrenEls) menu.deleteEl(element);
  };

  menu.addBasicHeader = () => {
    const title = menu.newEl(6, 1, 6, 1);
    title.innerText = "Scope Node: Protocol";

    const settingsButton = menu.newEl(15, 1, 2, 1, "button");
    settingsButton.innerText = "Settings";
    settingsButton.addEventListener("click", () => settings(app));

    const escape = menu.newEl(1, 1, 2, 1, "button");
    escape.innerText = `Esc`;
    escape.addEventListener("click", menu.toggle);
  };

  return menu;
};

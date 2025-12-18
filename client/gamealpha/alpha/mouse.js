import { game, MAP_HEIGHT, MAP_WIDTH, PLAYER_RADIUS } from "./global.js";
import {
  minkowskiSum,
  spawnTriangleCentered,
  transformPoints,
} from "./triangle.js";

const { mouse } = game;
const canvas = document.getElementById("Game");

const clamp = (val, min, max) => (val < min ? min : val > max ? max : val);
document.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse[0] = clamp(
    e.clientX - rect.left,
    PLAYER_RADIUS,
    MAP_WIDTH - PLAYER_RADIUS
  );
  mouse[1] = clamp(
    e.clientY - rect.top,
    PLAYER_RADIUS,
    MAP_HEIGHT - PLAYER_RADIUS
  );
});
const onWheel = (e) => {
  if (e.shiftKey) {
    game.previewAlpha += Math.sign(e.deltaY) / 45;
    game.previewAlpha = ((game.previewAlpha % 1) + 1) % 1;
    buildPreview();
  } else game.previewAngle += (Math.sign(e.deltaY) * Math.PI) / 30;
};
document.addEventListener("wheel", onWheel);

export const toMouse = (poly) =>
  transformPoints(mouse, game.previewAngle, poly);
document.addEventListener("click", () => {
  if (game.isPreview) {
    const triangle = toMouse(game.previewTriangle);
    const mTriangle = toMouse(game.mTriangle);
    if (game.pushPolygon(triangle, mTriangle)) game.isPreview = false;
    return;
  }
  game.previewAlpha = Math.floor(Math.random() * 30) / 30;
  game.isPreview = true;
  buildPreview();
});

const buildPreview = () => {
  const triangle = spawnTriangleCentered(game.previewAlpha % 1);
  game.previewTriangle = triangle;
  game.previewMTriangle = minkowskiSum(triangle, 2 * PLAYER_RADIUS, 5);
  game.mTriangle = minkowskiSum(triangle, PLAYER_RADIUS);
};

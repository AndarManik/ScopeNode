import { PathGraph } from "./pathing.js";
import { ShineGraph } from "./shining.js";
// World
export const MAP_HEIGHT = 768;
export const MAP_WIDTH = 1024;
export const OBSTACLE_MIN_ANGLE_DEG = 30;
export const MINKOWSKI_CIRCLE_DEG = 20;

export const INIT_OBSTACLE_COUNT = 10;

// Player
export const PLAYER_RADIUS = 18;
export const PLAYER_SPEED = 5 * PLAYER_RADIUS;
export const TEAM1_SPAWN = [3 * PLAYER_RADIUS, MAP_HEIGHT / 2];
export const TEAM2_SPAWN = [MAP_WIDTH - 3 * PLAYER_RADIUS, MAP_HEIGHT / 2];
export const CENTER_OBJECTIVE = [MAP_WIDTH / 2, MAP_HEIGHT / 2];

export const OBSTACLE_AREA = (5 * PLAYER_RADIUS) ** 2;

// Color
export const HUE_SHIFT = Math.random() * 360;

// Base neutrals — darker background, faint chroma so colored UI pops
export const COLOR_BACKGROUND = `oklch(0.09 0.015 ${HUE_SHIFT})`;
export const COLOR_DARK = `oklch(0.24 0.008 ${HUE_SHIFT})`;
export const COLOR_GREY = `oklch(0.96 0.060 ${HUE_SHIFT})`;

// Blocked/invalid — close to bg but just visible; preview translucent
export const BLOCKED_OBSTACLE = `oklch(0.35 0.006 ${HUE_SHIFT})`;
export const BLOCKED_PREVIEW = `oklch(0.35 0.006 ${HUE_SHIFT} / 0.28)`;

// Your hue logic unchanged
const s = Math.random();
export const golden = (i, n = i + 1) =>
  (Math.sqrt(1.25 * n * n) - n / 2 + s) % 1;
export const huePick = (alpha) => HUE_SHIFT - 45 + alpha * 90;

// Obstacles & their preview — brighter & slightly more saturated for readability
export const previewColor = (i) =>
  i < 0 ? BLOCKED_PREVIEW : `oklch(0.55 0.03 ${huePick(golden(i))} / 0.35)`;
export const obstacleColor = (i) =>
  i < 0 ? BLOCKED_OBSTACLE : `oklch(0.55 0.03 ${huePick(golden(i))})`;

// Cursor/Objective — cursor gets a touch more chroma; objective is punchier
export const CURSOR_COLOR = `oklch(0.96 0.018 ${HUE_SHIFT + 45})`;
export const OBJECTIVE_COLOR = `oklch(0.88 0.058 ${HUE_SHIFT})`;

export const TEAM1_COLOR = `oklch(0.88 0.058 ${HUE_SHIFT + 45})`;
export const TEAM1_POINT_SHINE = `oklch(0.35 0.030 ${HUE_SHIFT + 60})`;
export const TEAM1_DISK_SHINE = `oklch(0.75 0.125 ${HUE_SHIFT + 45})`;

export const TEAM2_COLOR = `oklch(0.88 0.058 ${HUE_SHIFT - 45})`;
export const TEAM2_POINT_SHINE = `oklch(0.35 0.030 ${HUE_SHIFT - 60})`;
export const TEAM2_DISK_SHINE = `oklch(0.75 0.125 ${HUE_SHIFT - 45})`;

export const SECT_POINT_SHINE = `oklch(0.45 0.045 ${HUE_SHIFT})`;
export const SECT_DISK_SHINE = `oklch(0.88 0.130 ${HUE_SHIFT})`;

export const SELF_POINT_OUTLINE = `oklch(0.30 0.035 ${HUE_SHIFT + 45})`;
export const SELF_DISK_OUTLINE = `oklch(0.34 0.060 ${HUE_SHIFT + 45})`;

document.body.style.background = COLOR_BACKGROUND;

export const game = {
  player: [...TEAM1_SPAWN],
  extraPlayer: [...TEAM1_SPAWN],
  extraPlayer1: [...TEAM2_SPAWN],
  extraPlayer2: [...TEAM2_SPAWN],
  mouse: [0, 0],
  //obstacle placement
  isPreview: false,
  previewTriangle: null,
  previewMTriangle: null,
  mTriangle: null,
  previewAngle: 0,
  previewAlpha: 0,
  obstacleGroups: [],

  obstacleTotal: null,
  pathGraph: new PathGraph(),
  apsp: null,
  playerPath: [],

  lightTotal: null,
  shineGraph: new ShineGraph(),
};

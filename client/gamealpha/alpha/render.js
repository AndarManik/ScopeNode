import {
  game,
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
  CENTER_OBJECTIVE,
  TEAM1_SPAWN,
  TEAM2_SPAWN,
  COLOR_BACKGROUND,
  obstacleColor,
  previewColor,
  TEAM1_COLOR,
  TEAM2_COLOR,
  OBJECTIVE_COLOR,
  CURSOR_COLOR,
  COLOR_DARK,
  TEAM1_POINT_SHINE,
  TEAM1_DISK_SHINE,
  TEAM2_POINT_SHINE,
  TEAM2_DISK_SHINE,
  SECT_DISK_SHINE,
  SECT_POINT_SHINE,
  COLOR_GREY,
  SELF_DISK_OUTLINE,
  SELF_POINT_OUTLINE,
} from "./global.js";
import { kickout } from "./kickout.js";
import { toMouse } from "./mouse.js";
import { validateNewObstacle } from "./obstacle.js";
import { insetPolygon } from "./rendershine.js";
import { cleanMultiPolygon } from "./shining.js";

const canvas = document.getElementById("Game");
const ctx = canvas.getContext("2d");
const scale = 2; // 2x or higher
canvas.width = MAP_WIDTH * scale;
canvas.height = MAP_HEIGHT * scale;
ctx.scale(scale, scale);

const newLayer = () => {
  const layer = new OffscreenCanvas(MAP_WIDTH * scale, MAP_HEIGHT * scale);
  layer.ctx = layer.getContext("2d");
  layer.ctx.scale(scale, scale);

  return layer;
};

export const triangleLayer = newLayer();
export const mTriangleLayer = newLayer();
export const obstacleVisibilityLayer = newLayer();

export const render = () => {
  ctx.fillStyle = COLOR_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  playerShine();
  drawTriangleLayer();

  drawObjective();
  drawPathToPlayer();
  drawPlayer();
  if (game.isPreview) {
    drawPreview();
    drawPreviewHelper();
  }
  drawMouse();
  //ctx.drawImage(obstacleVisibilityLayer, 0, 0);
};

const drawTriangleLayer = () => {
  // draw triangleLayer at 50% size onto ctx
  ctx.save();

  ctx.scale(1 / scale, 1 / scale); // scale everything you draw next
  ctx.drawImage(triangleLayer, 0, 0);
  ctx.restore(); // important so later drawing isn’t scaled
};

const drawPreview = () => {
  const colorIndex = validateNewObstacle(toMouse(game.mTriangle));
  drawPolygon(toMouse(game.previewTriangle), ctx, obstacleColor(colorIndex));
  drawPolygon(toMouse(game.previewMTriangle), ctx, previewColor(colorIndex));
};

const drawPreviewHelper = () => {
  drawCircle(TEAM1_SPAWN, PLAYER_RADIUS, ctx, TEAM1_COLOR);

  drawCircle(TEAM2_SPAWN, PLAYER_RADIUS, ctx, TEAM2_COLOR);
  drawCircle(CENTER_OBJECTIVE, PLAYER_RADIUS, ctx, OBJECTIVE_COLOR);
};

const drawPathVisibleIndices = (position) => {
  if (!game.pathGraph) return;

  const visibility = game.pathGraph.visibleIndicesAt(position);
  for (const index of visibility) {
    ctx.strokeStyle = "#0002";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(...position);
    ctx.lineTo(...game.pathGraph.vertices[index]);
    ctx.stroke();
    drawCircle(game.pathGraph.vertices[index], 3, ctx, "#0002");
  }
};

const drawPathToPlayer = () => {
  ctx.strokeStyle = CURSOR_COLOR;
  ctx.lineWidth = (2 * PLAYER_RADIUS) / 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Define the dash pattern: [dashLength, gapLength]
  const dash = 2 * PLAYER_RADIUS - (2 * PLAYER_RADIUS) / 3;
  const gap = PLAYER_RADIUS + (2 * PLAYER_RADIUS) / 3;
  ctx.setLineDash([dash, gap]);

  // Offset so the first dash starts “nicely” at the player
  // Adjust this number to fine-tune visual alignment
  ctx.lineDashOffset = (5 * PLAYER_RADIUS) / 6;

  ctx.beginPath();
  ctx.moveTo(...game.player);
  game.playerPath.forEach((v) => ctx.lineTo(...v));
  ctx.stroke();

  // Reset dash state
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  drawCircle(
    game.playerPath[game.playerPath.length - 1],
    PLAYER_RADIUS,
    ctx,
    CURSOR_COLOR
  );
};

const drawObjective = () => {
  drawCircle(CENTER_OBJECTIVE, PLAYER_RADIUS, ctx, OBJECTIVE_COLOR);
};

const drawPlayer = () => {
  drawCircle(game.player, PLAYER_RADIUS, ctx, TEAM1_COLOR);
  drawCircle(game.player, 2, ctx, COLOR_DARK);
  drawCircle(game.extraPlayer, PLAYER_RADIUS, ctx, TEAM1_COLOR);
  drawCircle(game.extraPlayer1, PLAYER_RADIUS, ctx, TEAM2_COLOR);
  drawCircle(game.extraPlayer2, PLAYER_RADIUS, ctx, TEAM2_COLOR);
};

const drawCircle = (pos, radius, ctx, color) => {
  ctx.strokeStyle = "transparent";
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos[0], pos[1], radius, 0, Math.PI * 2);
  ctx.fill();
};

const drawMouse = () => {
  drawCircle(game.mouse, PLAYER_RADIUS / 3, ctx, CURSOR_COLOR);
};

let playerShine = () => {
  let { pointShinePoly: aPointPoly, diskShinePoly: aDiskPoly } =
    game.shineGraph.shineAt(game.player);

  let { pointShinePoly: bPointPoly, diskShinePoly: bDiskPoly } =
    game.shineGraph.shineAt(game.extraPlayer);

  const aJustDisk = cleanMultiPolygon(diffSafe([[aDiskPoly]], [[aPointPoly]]));
  const bJustDisk = cleanMultiPolygon(diffSafe([[bDiskPoly]], [[bPointPoly]]));

  const sectJustDisk = cleanMultiPolygon(
    intersectionSafe(aJustDisk, bJustDisk)
  );

  const sectPoint = cleanMultiPolygon(
    intersectionSafe([[aPointPoly]], [[bPointPoly]])
  );

  drawPolygon(aPointPoly, ctx, TEAM1_POINT_SHINE, 0);
  drawPolygon(bPointPoly, ctx, TEAM2_POINT_SHINE, 0);
  drawMultiPolygon(sectPoint, ctx, SECT_POINT_SHINE);

  drawMultiPolygon(aJustDisk, ctx, TEAM1_DISK_SHINE);
  drawMultiPolygon(bJustDisk, ctx, TEAM2_DISK_SHINE);
  drawMultiPolygon(sectJustDisk, ctx, SECT_DISK_SHINE);
};

playerShine = () => {
  const { pointShinePoly: aPointPoly, diskShinePoly: aDiskPoly } =
    game.shineGraph.shineAt(game.player);

  const { pointShinePoly: bPointPoly, diskShinePoly: bDiskPoly } =
    game.shineGraph.shineAt(game.extraPlayer);

  drawPolygon(aPointPoly, ctx, TEAM1_POINT_SHINE);
  drawPolygon(bPointPoly, ctx, TEAM2_POINT_SHINE);
  drawDiskMinusPoint(aDiskPoly, aPointPoly, TEAM1_DISK_SHINE);
  drawDiskMinusPoint(bDiskPoly, bPointPoly, TEAM2_DISK_SHINE);
};

playerShine = () => {
  const team1 = [game.player, game.extraPlayer].map((player) =>
    game.shineGraph.shineAt(player)
  );
  const team2 = [game.extraPlayer1, game.extraPlayer2].map((player) =>
    game.shineGraph.shineAt(player)
  );

  renderTeamsVision(team1, team2, {
    team1Point: TEAM1_POINT_SHINE,
    team1Disk: TEAM2_DISK_SHINE,
    team2Point: TEAM2_POINT_SHINE,
    team2Disk: TEAM1_DISK_SHINE,
    intersectPoint: COLOR_BACKGROUND,
    intersectDisk: SECT_DISK_SHINE,
  });
};

const makeScratchCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

const SCRATCH = makeScratchCanvas(canvas.width, canvas.height);
const sctx = SCRATCH.getContext("2d");
const drawDiskMinusPoint = (diskMultiPoly, pointPoly, diskColor) => {
  // clear previous contents
  sctx.clearRect(0, 0, SCRATCH.width, SCRATCH.height);

  // 1) draw the disk shine
  diskMultiPoly.forEach((poly) => drawPolygon(poly, sctx, diskColor));

  // 2) punch out the point shape from this disk only
  sctx.globalCompositeOperation = "destination-out";
  drawPolygon(pointPoly, sctx, "#000"); // color irrelevant, only shape matters
  sctx.globalCompositeOperation = "source-over";

  // 3) composite this player's result onto main canvas
  ctx.drawImage(SCRATCH, 0, 0);
};

export const drawPolygon = (poly, ctx, color) => {
  if (!poly || poly.length < 3) return;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fill("nonzero");
  ctx.stroke();
};

export const drawPolygonBordered = (poly, ctx, color, borderColor, line) => {
  if (!poly || poly.length < 3) return;
  ctx.fillStyle = color;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.stroke();
};

export const drawPolygonThick = (poly, ctx, color, line = 0) => {
  if (!poly || poly.length < 3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fill("evenodd");
};

const drawMultiPolygon = (multiPoly, ctx, color) => {
  if (!multiPoly || !multiPoly.length) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const poly of multiPoly) {
    // poly = [ outerRing, hole1, hole2, ... ]
    for (const ring of poly) {
      if (!ring || ring.length < 3) continue;
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let k = 1; k < ring.length; k++) ctx.lineTo(ring[k][0], ring[k][1]);
      ctx.closePath();
    }
    ctx.fill("nonzero");
  }
};

const drawMultiPolygonOutline = (multiPoly, ctx, color) => {
  if (!multiPoly || !multiPoly.length) return;

  ctx.save();
  ctx.beginPath();

  for (const poly of multiPoly) {
    if (!poly || !poly.length) continue;

    // Draw outer ring
    const outer = poly[0];
    if (outer && outer.length >= 3) {
      ctx.moveTo(outer[0][0], outer[0][1]);
      for (let k = 1; k < outer.length; k++)
        ctx.lineTo(outer[k][0], outer[k][1]);
      ctx.closePath();
    }

    for (let h = 1; h < poly.length; h++) {
      const ring = poly[h];
      if (!ring || ring.length < 3) continue;
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let k = 1; k < ring.length; k++) ctx.lineTo(ring[k][0], ring[k][1]);
      ctx.closePath();
    }
  }

  // Style & stroke
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
};

export const reDrawMTriangleLayer = () => {
  const lctx = mTriangleLayer.ctx;
  lctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  const draw = (poly, i) => drawMultiPolygon(poly, lctx, previewColor(i));
  game.obstacleGroups.forEach(draw);
};

export const reDrawObstacleVisibilityLayer = () => {
  const { vertices, edges } = game.pathGraph;
  const ctx = obstacleVisibilityLayer.ctx;
  ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  ctx.strokeStyle = "#0002";
  ctx.lineWidth = 1;

  for (let i = 0; i < vertices.length; i++) {
    const source = vertices[i];
    for (let j = 0; j < edges[i].length; j++) {
      const target = vertices[edges[i][j]];
      ctx.beginPath();
      ctx.moveTo(...source);
      ctx.lineTo(...target);
      ctx.stroke();
    }
  }
};

function createTeamsVisionRenderer(ctx, mapWidth, mapHeight, scale) {
  // Pixel dimensions of the render area
  const pixelWidth = mapWidth * scale;
  const pixelHeight = mapHeight * scale;

  const makeBuffer = () => {
    const c = document.createElement("canvas");
    c.width = pixelWidth;
    c.height = pixelHeight;
    return { canvas: c, ctx: c.getContext("2d") };
  };

  // Persistent buffers
  const buffers = {
    team1: { point: makeBuffer(), disk: makeBuffer(), t2b: makeBuffer() },
    team2: { point: makeBuffer(), disk: makeBuffer(), t2b: makeBuffer() },
    intersectPoint: makeBuffer(),
    intersectDisk: makeBuffer(),
    tint: makeBuffer(),
  };

  const clearCanvas = (cctx) => {
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = "source-over";
    cctx.clearRect(0, 0, pixelWidth, pixelHeight);
  };

  // Polygons are given in world/map coordinates; offscreen is in pixels
  const drawPolygon = (cctx, poly) => {
    if (!poly || poly.length < 3) return;
    cctx.beginPath();
    cctx.moveTo(poly[0][0] * scale, poly[0][1] * scale);
    for (let i = 1; i < poly.length; i++) {
      cctx.lineTo(poly[i][0] * scale, poly[i][1] * scale);
    }
    cctx.closePath();
    cctx.fill();
    cctx.stroke();
  };

  // Build per-team T1/T2b
  // T1 = union(point)
  // T2b = union(disk) \ T1
  const buildTeamMasks = (team, buf) => {
    const { point, disk, t2b } = buf;

    clearCanvas(point.ctx);
    clearCanvas(disk.ctx);
    clearCanvas(t2b.ctx);

    // T1 = union of point polys
    point.ctx.fillStyle = "white";
    point.ctx.strokeStyle = "white";
    point.ctx.lineWidth = 1;
    for (const [pointPoly] of team) {
      drawPolygon(point.ctx, pointPoly);
    }

    // union of disk polys
    disk.ctx.fillStyle = "white";
    disk.ctx.strokeStyle = "white";
    disk.ctx.lineWidth = 1;
    for (const [, diskPolys] of team) {
      if (!diskPolys) continue;
      for (const poly of diskPolys) {
        drawPolygon(disk.ctx, poly);
      }
    }

    // T2b = disk \ T1
    t2b.ctx.globalCompositeOperation = "source-over";
    t2b.ctx.drawImage(disk.canvas, 0, 0);

    t2b.ctx.globalCompositeOperation = "destination-out";
    t2b.ctx.drawImage(point.canvas, 0, 0);

    t2b.ctx.globalCompositeOperation = "source-over";

    return {
      t1Mask: point.canvas,
      t2bMask: t2b.canvas,
    };
  };

  const buildIntersectionInto = (maskA, maskB, buf) => {
    const cctx = buf.ctx;
    clearCanvas(cctx);

    if (!maskA || !maskB) return;

    cctx.globalCompositeOperation = "source-over";
    cctx.drawImage(maskA, 0, 0);

    cctx.globalCompositeOperation = "destination-in";
    cctx.drawImage(maskB, 0, 0);

    cctx.globalCompositeOperation = "source-over";
  };

  // Tint maskCanvas with color and blit onto main ctx
  const paintMask = (maskCanvas, color) => {
    if (!maskCanvas) return;
    const tint = buffers.tint;
    clearCanvas(tint.ctx);

    tint.ctx.globalCompositeOperation = "source-over";
    tint.ctx.drawImage(maskCanvas, 0, 0);

    tint.ctx.globalCompositeOperation = "source-in";
    tint.ctx.fillStyle = color;
    tint.ctx.fillRect(0, 0, pixelWidth, pixelHeight);

    // IMPORTANT: main ctx transform is neutralized in render()
    ctx.drawImage(tint.canvas, 0, 0);
  };

  // Per-frame render
  const render = (team1, team2, colors) => {
    console.log(team1, team2);
    const t1Masks = buildTeamMasks(team1 || [], buffers.team1);
    const t2Masks = buildTeamMasks(team2 || [], buffers.team2);

    buildIntersectionInto(
      t1Masks.t1Mask,
      t2Masks.t1Mask,
      buffers.intersectPoint
    );
    buildIntersectionInto(
      t1Masks.t2bMask,
      t2Masks.t2bMask,
      buffers.intersectDisk
    );

    ctx.save();

    // BACKWARDS SCALING: neutralize the global scale while compositing
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Optional clear:
    // ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    // 1) Draw both T1
    paintMask(t1Masks.t1Mask, colors.team1Point);
    paintMask(t2Masks.t1Mask, colors.team2Point);

    // 2) Draw intersection of T1
    paintMask(buffers.intersectPoint.canvas, colors.intersectPoint);

    // 3) Draw both T2b on top
    paintMask(t1Masks.t2bMask, colors.team1Disk);
    paintMask(t2Masks.t2bMask, colors.team2Disk);

    // 4) Draw intersection of T2b
    paintMask(buffers.intersectDisk.canvas, colors.intersectDisk);

    ctx.restore();
  };

  return render;
}

const renderTeamsVision = createTeamsVisionRenderer(
  ctx,
  MAP_WIDTH,
  MAP_HEIGHT,
  scale
);

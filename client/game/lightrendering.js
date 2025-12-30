export const createTeamsVisionRenderer = (ctx, mapWidth, mapHeight, scale) => {
  // Pixel dimensions of the render area
  const pixelWidth = mapWidth * scale;
  const pixelHeight = mapHeight * scale;

  const makeBuffer = () => {
    const c = document.createElement("canvas");
    c.width = pixelWidth;
    c.height = pixelHeight;
    const cctx = c.getContext("2d");
    cctx.imageSmoothingEnabled = false;
    cctx.imageSmoothingQuality = "low";
    return { canvas: c, ctx: cctx };
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
    cctx.moveTo((poly[0][0] * scale), (poly[0][1] * scale));
    for (let i = 1; i < poly.length; i++) {
      cctx.lineTo((poly[i][0] * scale), (poly[i][1] * scale));
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
    point.ctx.lineWidth = 0;
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
  const render = (team1, team2, color) => {
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
    paintMask(t1Masks.t1Mask, color.team1Point);
    paintMask(t2Masks.t1Mask, color.team2Point);

    // 2) Draw intersection of T1
    paintMask(buffers.intersectPoint.canvas, color.intersectPoint);

    // 3) Draw both T2b on top
    paintMask(t1Masks.t2bMask, color.team1Disk);
    paintMask(t2Masks.t2bMask, color.team2Disk);

    // 4) Draw intersection of T2b
    paintMask(buffers.intersectDisk.canvas, color.intersectDisk);

    ctx.restore();
  };

  return render;
};

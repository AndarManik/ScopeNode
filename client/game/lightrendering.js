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
    background: makeBuffer(),
  };

  const clearCanvas = (cctx) => {
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = "source-over";
    cctx.filter = "none";
    cctx.clearRect(0, 0, pixelWidth, pixelHeight);
  };

  // Draw in map coordinates; scaling is handled via transforms
  const drawPolygon = (cctx, poly) => {
    if (!poly || poly.length < 3) return;
    cctx.beginPath();
    cctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      cctx.lineTo(poly[i][0], poly[i][1]);
    }
    cctx.closePath();
    cctx.fill();
  };

  const withMapTransform = (cctx, fn) => {
    cctx.save();
    cctx.setTransform(scale, 0, 0, scale, 0, 0);
    fn();
    cctx.restore();
  };

  const buildTeamMasks = (team, buf) => {
    const { point, disk, t2b } = buf;

    clearCanvas(point.ctx);
    clearCanvas(disk.ctx);
    clearCanvas(t2b.ctx);

    // T1 = union of point polys
    withMapTransform(point.ctx, () => {
      point.ctx.fillStyle = "white";
      for (const [pointPoly] of team) {
        drawPolygon(point.ctx, pointPoly);
      }
    });

    // union of disk polys
    withMapTransform(disk.ctx, () => {
      disk.ctx.fillStyle = "white";
      for (const [, diskPolys] of team) {
        if (!diskPolys) continue;
        for (const poly of diskPolys) {
          drawPolygon(disk.ctx, poly);
        }
      }
    });

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

  // Helper: subtract subtractCanvas from targetCtx in-place
  const subtractMaskInPlace = (targetCtx, subtractCanvas) => {
    if (!subtractCanvas) return;
    targetCtx.globalCompositeOperation = "destination-out";
    targetCtx.drawImage(subtractCanvas, 0, 0);
    targetCtx.globalCompositeOperation = "source-over";
  };

  // Build background mask = everything NOT in T1 or T2b, minus excludedPolygons
  const buildBackgroundMask = (t1Masks, t2Masks, excludedPolygons) => {
    const { background } = buffers;
    const bctx = background.ctx;
    clearCanvas(bctx);

    // Start with full canvas as background (white)
    bctx.globalCompositeOperation = "source-over";
    bctx.fillStyle = "white";
    bctx.fillRect(0, 0, pixelWidth, pixelHeight);

    // Cut out all T1 and T2b masks from both teams
    bctx.globalCompositeOperation = "destination-out";

    if (t1Masks.t1Mask) bctx.drawImage(t1Masks.t1Mask, 0, 0);
    if (t2Masks.t1Mask) bctx.drawImage(t2Masks.t1Mask, 0, 0);
    if (t1Masks.t2bMask) bctx.drawImage(t1Masks.t2bMask, 0, 0);
    if (t2Masks.t2bMask) bctx.drawImage(t2Masks.t2bMask, 0, 0);

    // Also cut out any extra polygons we do not want in the background
    if (excludedPolygons && excludedPolygons.length > 0) {
      bctx.fillStyle = "white";
      withMapTransform(bctx, () => {
        for (const { poly } of excludedPolygons) {
          drawPolygon(bctx, poly);
        }
      });
    }

    bctx.globalCompositeOperation = "source-over";
    return background.canvas;
  };

  // Original-style paintMask with per-mask glow + layering
  const paintMask = (maskCanvas, color, glow = null) => {
    if (!maskCanvas) return;

    const tint = buffers.tint;

    //
    // 1. Optional glow pass (per mask, with ordering precedence)
    //
    if (glow) {
      const { glowRadius, glowColor } = glow;
      const gctx = tint.ctx;

      clearCanvas(gctx);
      gctx.filter = `blur(${glowRadius}px)`;
      gctx.globalCompositeOperation = "source-over";
      gctx.drawImage(maskCanvas, 0, 0);

      gctx.globalCompositeOperation = "source-in";
      gctx.filter = "none";
      gctx.fillStyle = glowColor;
      gctx.fillRect(0, 0, pixelWidth, pixelHeight);

      gctx.globalCompositeOperation = "source-over";

      ctx.globalCompositeOperation = "hard-light";
      ctx.drawImage(tint.canvas, 0, 0);
    }

    //
    // 2. Normal shaded polygon (solid fill)
    //
    const cctx = tint.ctx;
    clearCanvas(cctx);

    cctx.globalCompositeOperation = "source-over";
    cctx.drawImage(maskCanvas, 0, 0);

    cctx.globalCompositeOperation = "source-in";
    cctx.fillStyle = color;
    cctx.fillRect(0, 0, pixelWidth, pixelHeight);

    cctx.globalCompositeOperation = "source-over";

    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(tint.canvas, 0, 0);
  };

  // glow: truthy → glows enabled, null/false → no glow
  const render = (game, team1, team2, color, glow = true) => {
    const t1Masks = buildTeamMasks(team1 || [], buffers.team1);
    const t2Masks = buildTeamMasks(team2 || [], buffers.team2);

    // Build intersections (raw overlap)
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

    // Subtract intersections from the original masks
    subtractMaskInPlace(buffers.team1.point.ctx, buffers.intersectPoint.canvas);
    subtractMaskInPlace(buffers.team2.point.ctx, buffers.intersectPoint.canvas);

    subtractMaskInPlace(buffers.team1.t2b.ctx, buffers.intersectDisk.canvas);
    subtractMaskInPlace(buffers.team2.t2b.ctx, buffers.intersectDisk.canvas);

    // Build background mask AFTER masks are finalized
    const backgroundMask = buildBackgroundMask(
      t1Masks,
      t2Masks,
      game.obstacles
    );

    const glowRadius = game.playerRadius / 1.25;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Helper to build per-call glow config or null
    const maybeGlow = (glowColor) => (glow ? { glowRadius, glowColor } : null);

    // 0) Draw BACKGROUND first
    paintMask(backgroundMask, color.background, maybeGlow(color.intersectDisk));

    // 1) Draw both T1 (now WITHOUT intersection)
    paintMask(t1Masks.t1Mask, color.team1Point, maybeGlow(color.team1Disk));
    paintMask(t2Masks.t1Mask, color.team2Point, maybeGlow(color.team2Disk));

    // 2) Draw intersection of T1
    paintMask(
      buffers.intersectPoint.canvas,
      color.intersectPoint,
      maybeGlow(color.intersectDisk)
    );

    // 3) Draw both T2b (now WITHOUT intersection)
    paintMask(t1Masks.t2bMask, color.team1Disk, maybeGlow(color.team1Disk));
    paintMask(t2Masks.t2bMask, color.team2Disk, maybeGlow(color.team2Disk));

    // 4) Draw intersection of T2b
    paintMask(
      buffers.intersectDisk.canvas,
      color.intersectDisk,
      maybeGlow(color.intersectDisk)
    );

    ctx.restore();
  };

  return render;
};

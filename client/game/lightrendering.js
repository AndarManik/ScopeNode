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
    // Team buffers
    team1: {
      point: makeBuffer(),
      pointExpanded: makeBuffer(),
      disk: makeBuffer(),
      t2b: makeBuffer(), // HARD T2b (after T1 expansion)
      softT2b: makeBuffer(), // SOFT T2b (original disk \ T1)
    },
    team2: {
      point: makeBuffer(),
      pointExpanded: makeBuffer(),
      disk: makeBuffer(),
      t2b: makeBuffer(), // HARD T2b
      softT2b: makeBuffer(), // SOFT T2b
    },
    // Intersections (HARD)
    intersectPoint: makeBuffer(),
    intersectDisk: makeBuffer(),
    // Shared
    tint: makeBuffer(),
    background: makeBuffer(),
    // Expanded obstacles mask (for clipping T2b)
    obstacleExpanded: makeBuffer(),
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

  // Variant that fills AND strokes (used for Minkowski-ish expansion)
  const drawPolygonFillAndStroke = (cctx, poly) => {
    if (!poly || poly.length < 3) return;
    cctx.beginPath();
    cctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      cctx.lineTo(poly[i][0], poly[i][1]);
    }
    cctx.closePath();
    cctx.fill();
    cctx.stroke();
  };

  const withMapTransform = (cctx, fn) => {
    cctx.save();
    cctx.setTransform(scale, 0, 0, scale, 0, 0);
    fn();
    cctx.restore();
  };

  // Build team masks, using playerRadius to expand T1 for HARD T2b
  const buildTeamMasks = (team, buf, playerRadius) => {
    const { point, pointExpanded, disk, t2b, softT2b } = buf;

    clearCanvas(point.ctx);
    clearCanvas(pointExpanded.ctx);
    clearCanvas(disk.ctx);
    clearCanvas(t2b.ctx);
    clearCanvas(softT2b.ctx);

    // ========= T1 = union of point polys (center visibility) =========
    withMapTransform(point.ctx, () => {
      point.ctx.fillStyle = "white";
      for (const [pointPoly] of team) {
        drawPolygon(point.ctx, pointPoly);
      }
    });

    // ========= T1-expanded = Minkowski-ish sum (T1 ⊕ playerRadius) =========
    if (playerRadius > 0) {
      withMapTransform(pointExpanded.ctx, () => {
        const cctx = pointExpanded.ctx;
        cctx.fillStyle = "white";
        cctx.strokeStyle = "white";
        cctx.lineJoin = "round";
        cctx.lineCap = "round";
        cctx.lineWidth = 2 * playerRadius; // world units; transform scales it
        for (const [pointPoly] of team) {
          drawPolygonFillAndStroke(cctx, pointPoly);
        }
      });
    } else {
      // Fallback: if radius is zero, just copy T1 into expanded
      pointExpanded.ctx.globalCompositeOperation = "source-over";
      pointExpanded.ctx.drawImage(point.canvas, 0, 0);
    }

    // ========= union of disk polys =========
    withMapTransform(disk.ctx, () => {
      disk.ctx.fillStyle = "white";
      for (const [, diskPolys] of team) {
        if (!diskPolys) continue;
        for (const poly of diskPolys) {
          drawPolygon(disk.ctx, poly);
        }
      }
    });

    // ========= SOFT T2b (original) = disk \ T1 =========
    softT2b.ctx.globalCompositeOperation = "source-over";
    softT2b.ctx.drawImage(disk.canvas, 0, 0);

    softT2b.ctx.globalCompositeOperation = "destination-out";
    softT2b.ctx.drawImage(point.canvas, 0, 0);

    softT2b.ctx.globalCompositeOperation = "source-over";

    // ========= HARD T2b = disk \ (T1 expanded by playerRadius) =========
    t2b.ctx.globalCompositeOperation = "source-over";
    t2b.ctx.drawImage(disk.canvas, 0, 0);

    t2b.ctx.globalCompositeOperation = "destination-out";
    t2b.ctx.drawImage(pointExpanded.canvas, 0, 0);

    t2b.ctx.globalCompositeOperation = "source-over";

    return {
      t1Mask: point.canvas,
      t2bMask: t2b.canvas, // HARD T2b
      t2bSoftMask: softT2b.canvas, // SOFT T2b (original)
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

  // Build background mask = everything NOT in T1 or HARD T2b, minus excludedPolygons
  const buildBackgroundMask = (t1Masks, t2Masks, excludedPolygons) => {
    const { background } = buffers;
    const bctx = background.ctx;
    clearCanvas(bctx);

    // Start with full canvas as background (white)
    bctx.globalCompositeOperation = "source-over";
    bctx.fillStyle = "white";
    bctx.fillRect(0, 0, pixelWidth, pixelHeight);

    // Cut out all T1 and HARD T2b masks from both teams
    bctx.globalCompositeOperation = "destination-out";

    if (t1Masks.t1Mask) bctx.drawImage(t1Masks.t1Mask, 0, 0);
    if (t2Masks.t1Mask) bctx.drawImage(t2Masks.t1Mask, 0, 0);
    if (t1Masks.t2bMask) bctx.drawImage(t1Masks.t2bMask, 0, 0);
    if (t2Masks.t2bMask) bctx.drawImage(t2Masks.t2bMask, 0, 0);

    // Also cut out any extra polygons we do not want in the background
    // NOTE: uses ORIGINAL obstacle polygons, NOT expanded
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

  // Build expanded obstacle mask (Minkowski ⊕ playerRadius) for T2b clipping
  const buildExpandedObstaclesMask = (excludedPolygons, playerRadius) => {
    const { obstacleExpanded } = buffers;
    const octx = obstacleExpanded.ctx;
    clearCanvas(octx);

    if (!excludedPolygons || excludedPolygons.length === 0) {
      return obstacleExpanded.canvas; // blank but valid
    }
    if (playerRadius <= 0) {
      // No expansion; leave blank so subtraction is no-op
      return obstacleExpanded.canvas;
    }

    withMapTransform(octx, () => {
      octx.fillStyle = "white";
      octx.strokeStyle = "white";
      octx.lineJoin = "round";
      octx.lineCap = "round";
      octx.lineWidth = 2 * playerRadius;
      for (const { poly } of excludedPolygons) {
        drawPolygonFillAndStroke(octx, poly);
      }
    });

    return obstacleExpanded.canvas;
  };

  // paintMask with per-mask glow + layering
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
    const playerRadius = game.playerRadius || 0;

    // 1) Build team masks with Minkowski-expanded T1 for HARD T2b,
    //    and original SOFT T2b.
    const t1Masks = buildTeamMasks(team1 || [], buffers.team1, playerRadius);
    const t2Masks = buildTeamMasks(team2 || [], buffers.team2, playerRadius);

    // 2) Build expanded obstacle mask and clip HARD T2b by it
    const obstacleExpandedMask = buildExpandedObstaclesMask(
      game.obstacles,
      playerRadius
    );

    // Clip HARD T2b (both teams) against expanded obstacles
    subtractMaskInPlace(buffers.team1.t2b.ctx, obstacleExpandedMask);
    subtractMaskInPlace(buffers.team2.t2b.ctx, obstacleExpandedMask);

    // 3) Build intersections (raw overlap) on HARD T2b
    buildIntersectionInto(
      t1Masks.t1Mask,
      t2Masks.t1Mask,
      buffers.intersectPoint
    );
    buildIntersectionInto(
      t1Masks.t2bSoftMask,
      t2Masks.t2bSoftMask,
      buffers.intersectDisk
    );

    // 4) Subtract intersections from HARD masks so intersection is isolated
    subtractMaskInPlace(buffers.team1.point.ctx, buffers.intersectPoint.canvas);
    subtractMaskInPlace(buffers.team2.point.ctx, buffers.intersectPoint.canvas);

    subtractMaskInPlace(
      buffers.team1.softT2b.ctx,
      buffers.intersectDisk.canvas
    );
    subtractMaskInPlace(
      buffers.team2.softT2b.ctx,
      buffers.intersectDisk.canvas
    );

    // 5) Build background mask AFTER HARD masks are finalized
    //    NOTE: background uses ORIGINAL obstacles (no expansion)
    const backgroundMask = buildBackgroundMask(
      t1Masks,
      t2Masks,
      game.obstacles
    );

    const glowRadius = playerRadius / 1.25;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

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

    // 3) Draw SOFT T2b (original disk \ T1), un-clipped but under HARD T2b
    //    These give you "soft-disk" areas where center LOS exists,
    //    even if a full-radius body can't get a kill.
    paintMask(
      t1Masks.t2bSoftMask,
      color.team1Disk,
      maybeGlow(color.team1Disk)
    );
    paintMask(
      t2Masks.t2bSoftMask,
      color.team2Disk,
      maybeGlow(color.team2Disk)
    );

    // 4) Draw HARD T2b (now WITHOUT intersection and obstacle-expanded)
    paintMask(t1Masks.t2bMask, color.team2Disk, maybeGlow(color.team2Disk));
    paintMask(t2Masks.t2bMask, color.team1Disk, maybeGlow(color.team1Disk));

    // 5) Draw intersection of HARD T2b
    paintMask(
      buffers.intersectDisk.canvas,
      color.intersectDisk,
      maybeGlow(color.intersectDisk)
    );

    ctx.restore();
  };

  return render;
};

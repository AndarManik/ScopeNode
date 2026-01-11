export const createPlayerRenderer = (
  ctx,
  mapWidth,
  mapHeight,
  scale,
  glowEnabled = true // hook this to renderSettings.glowEnabled
) => {
  // We actually don't need pixelWidth/Height for the player glow;
  // objective uses mapWidth/mapHeight only to compute the max radius.
  const maxObjectiveRadius = Math.hypot(mapWidth, mapHeight);

  // ------------------------------------------------------------
  // Offscreen buffers (created lazily, only if glow is ever used)
  // ------------------------------------------------------------
  const makeBuffer = () => {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const cctx = c.getContext("2d");
    cctx.imageSmoothingEnabled = false;
    cctx.imageSmoothingQuality = "low";
    return { canvas: c, ctx: cctx };
  };

  let buffers = null;
  const getBuffers = () => {
    if (!buffers) {
      buffers = {
        mask: makeBuffer(),
        glow: makeBuffer(),
      };
    }
    return buffers;
  };

  const ensureSquareBuffer = (buffer, size) => {
    if (buffer.canvas.width !== size || buffer.canvas.height !== size) {
      buffer.canvas.width = size;
      buffer.canvas.height = size;
      buffer.ctx.imageSmoothingEnabled = false;
      buffer.ctx.imageSmoothingQuality = "low";
    }
  };

  const clearCtx = (cctx) => {
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = "source-over";
    cctx.filter = "none";
    cctx.clearRect(0, 0, cctx.canvas.width, cctx.canvas.height);
  };

  // ------------------------------------------------------------
  // Core geometry renderer (no glow): draws a single player
  // ------------------------------------------------------------

  // Precompute for default slice fraction (you always use 0.2)
  const DEFAULT_SLICE_FRAC = 0.2;
  const DEFAULT_ALPHA = Math.asin(DEFAULT_SLICE_FRAC);
  const DEFAULT_X_SCALE = Math.sqrt(
    1 - DEFAULT_SLICE_FRAC * DEFAULT_SLICE_FRAC
  );

  const drawPlayerCore = (
    targetCtx,
    centerX,
    centerY,
    r,
    sliceFrac,
    angle,
    colors
  ) => {
    const { bodyColor, gunColor, curveColor } = colors;

    // Local thickness of removed strip
    let w, x, alpha;

    if (sliceFrac === DEFAULT_SLICE_FRAC) {
      w = DEFAULT_SLICE_FRAC * r;
      x = DEFAULT_X_SCALE * r;
      alpha = DEFAULT_ALPHA;
    } else {
      w = sliceFrac * r;
      if (w > 0 && w < r) {
        x = Math.sqrt(r * r - w * w);
        alpha = Math.asin(sliceFrac); // cheaper than asin(w / r)
      }
    }

    targetCtx.save();
    targetCtx.translate(centerX, centerY);
    targetCtx.rotate(angle);

    // Background (gun)
    targetCtx.fillStyle = gunColor;
    targetCtx.beginPath();
    targetCtx.arc(0, 0, r * 0.8, 0, 2 * Math.PI);
    targetCtx.fill();

    // If no cut -> full circle body + outline
    if (w <= 0) {
      targetCtx.fillStyle = bodyColor;
      targetCtx.beginPath();
      targetCtx.arc(0, 0, r, 0, Math.PI * 2);
      targetCtx.fill();

      const strokeR = r - r / 2.5;
      targetCtx.lineWidth = (2 * r) / 2.5;
      targetCtx.strokeStyle = curveColor;
      targetCtx.beginPath();
      targetCtx.arc(0, 0, strokeR, Math.PI / 2, (3 * Math.PI) / 2);
      targetCtx.stroke();

      targetCtx.restore();
      return;
    }

    // If cut removes everything -> only gun is visible
    if (w >= r) {
      targetCtx.restore();
      return;
    }

    // Body fill (two caps)
    targetCtx.fillStyle = bodyColor;

    // 1) Top cap (y >= +w)
    targetCtx.beginPath();
    targetCtx.arc(0, 0, r, alpha, Math.PI - alpha, false); // CCW
    targetCtx.lineTo(x, w);
    targetCtx.closePath();
    targetCtx.fill();

    // 2) Bottom cap (y <= -w)
    targetCtx.beginPath();
    targetCtx.arc(0, 0, r, Math.PI + alpha, 2 * Math.PI - alpha, false); // CCW
    targetCtx.lineTo(-x, -w);
    targetCtx.closePath();
    targetCtx.fill();

    // Curvy bit
    const strokeR = r - r * 2 * sliceFrac;
    if (strokeR > 0) {
      targetCtx.lineWidth = 4 * r * sliceFrac;
      targetCtx.strokeStyle = curveColor;
      targetCtx.beginPath();
      targetCtx.arc(0, 0, strokeR, Math.PI / 2, (3 * Math.PI) / 2);
      targetCtx.stroke();
    }

    targetCtx.restore();
  };

  // ------------------------------------------------------------
  // Player wrapper: draw a single player with optional glow
  // ------------------------------------------------------------
  const drawPlayer = (
    [cx, cy],
    playerRadius,
    color,
    gun,
    angle = 0,
    glow = null // { glowRadius, glowColor, composite? }
  ) => {
    const sliceFrac = DEFAULT_SLICE_FRAC;
    const r = playerRadius;

    // Hard-disable glows if the factory was created with glowEnabled = false
    // OR if this particular call passes glow = null/undefined.
    if (!glowEnabled || !glow) {
      drawPlayerCore(ctx, cx, cy, r, sliceFrac, angle, {
        bodyColor: color,
        gunColor: gun,
        curveColor: color,
      });
      return;
    }

    // Glow parameters
    const glowRadius = glow.glowRadius ?? r * 0.5;
    const glowColor = glow.glowColor ?? color;
    const composite = glow.composite || "screen";

    const { mask, glow: glowBuffer } = getBuffers();

    // Pad so blur does not clip
    const padding = glowRadius * 2;
    const size = Math.ceil(2 * r + padding * 2); // local buffer size

    // Resize buffers to just what we need for this shape
    ensureSquareBuffer(mask, size);
    ensureSquareBuffer(glowBuffer, size);

    const mctx = mask.ctx;
    const gctx = glowBuffer.ctx;
    clearCtx(mctx);
    clearCtx(gctx);

    // 1. Draw white mask of player into mask buffer
    drawPlayerCore(mctx, size / 2, size / 2, r, sliceFrac, angle, {
      bodyColor: "white",
      gunColor: "white",
      curveColor: "white",
    });

    // 2. Blur + tint into glow buffer
    gctx.filter = `blur(${glowRadius}px)`;
    gctx.globalCompositeOperation = "source-over";
    gctx.drawImage(mask.canvas, 0, 0);

    gctx.globalCompositeOperation = "source-in";
    gctx.filter = "none";
    gctx.fillStyle = glowColor;
    gctx.fillRect(0, 0, size, size);

    gctx.globalCompositeOperation = "source-over";

    // 3. Composite glow under main player
    const prevGCO = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = composite;
    ctx.drawImage(glowBuffer.canvas, cx - size / 2, cy - size / 2);
    ctx.globalCompositeOperation = prevGCO;

    // 4. Draw sharp player on top
    drawPlayerCore(ctx, cx, cy, r, sliceFrac, angle, {
      bodyColor: color,
      gunColor: gun,
      curveColor: color,
    });
  };

  // ------------------------------------------------------------
  // Objective core: center objective geometry (no glow)
  // ------------------------------------------------------------
  const drawObjectiveCore = (
    targetCtx,
    center,
    playerRadius,
    objectiveRadius,
    timeBeta,
    styleColor
  ) => {
    const [ox, oy] = center;

    if (objectiveRadius - playerRadius <= 0.1) {
      // Solid disc in the middle
      targetCtx.fillStyle = styleColor;
      targetCtx.beginPath();
      targetCtx.arc(ox, oy, playerRadius, 0, Math.PI * 2);
      targetCtx.fill();
    } else {
      // Expanding ring
      targetCtx.lineWidth = playerRadius * 2 * timeBeta;
      targetCtx.strokeStyle = styleColor;
      targetCtx.beginPath();
      targetCtx.arc(
        ox,
        oy,
        objectiveRadius - targetCtx.lineWidth / 2,
        0,
        Math.PI * 2
      );
      targetCtx.stroke();
    }
  };

  // ------------------------------------------------------------
  // Objective wrapper: same glow pipeline, same color as itself
  // ------------------------------------------------------------
  const drawObjective = (
    game,
    timeAlpha,
    playerRadius,
    _mapWidth,
    _mapHeight,
    color,
    glow = null
  ) => {
    if (timeAlpha > 1) return;
    const timeBeta = 1 - timeAlpha;
    const rawObjectiveRadius =
      timeBeta * playerRadius + timeAlpha * maxObjectiveRadius;
    const objectiveRadius = Math.min(
      rawObjectiveRadius,
      maxObjectiveRadius + playerRadius
    );

    const center = game.centerObjective;

    // No glow if factory disabled glows or this call has glow = null
    if (!glowEnabled || !glow) {
      drawObjectiveCore(
        ctx,
        center,
        playerRadius,
        objectiveRadius,
        timeBeta,
        color
      );
      return;
    }

    // --- Glow parameters ---
    const glowRadius = glow.glowRadius ?? playerRadius * 1.5;
    const glowColor = glow.glowColor ?? color; // glow same color as itself
    const composite = glow.composite || "screen";

    const { mask, glow: glowBuffer } = getBuffers();

    // Extents of the ring: outer radius ~ objectiveRadius + playerRadius
    const halfExtent = objectiveRadius + playerRadius;
    const padding = glowRadius * 2;
    const size = Math.ceil(halfExtent * 2 + padding * 2);

    // Resize buffers to fit this (larger) shape
    ensureSquareBuffer(mask, size);
    ensureSquareBuffer(glowBuffer, size);

    const mctx = mask.ctx;
    const gctx = glowBuffer.ctx;
    clearCtx(mctx);
    clearCtx(gctx);

    // 1. Draw white objective shape into mask buffer, centered in that buffer
    const bufferCenter = [size / 2, size / 2];
    drawObjectiveCore(
      mctx,
      bufferCenter,
      playerRadius,
      objectiveRadius,
      timeBeta,
      "white"
    );

    // 2. Blur mask and tint with objective color
    gctx.filter = `blur(${glowRadius}px)`;
    gctx.globalCompositeOperation = "source-over";
    gctx.drawImage(mask.canvas, 0, 0);

    gctx.globalCompositeOperation = "source-in";
    gctx.filter = "none";
    gctx.fillStyle = glowColor;
    gctx.fillRect(0, 0, size, size);

    gctx.globalCompositeOperation = "source-over";

    // 3. Composite glow on main ctx
    const prevGCO = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = composite;
    ctx.drawImage(
      glowBuffer.canvas,
      center[0] - size / 2,
      center[1] - size / 2
    );
    ctx.globalCompositeOperation = prevGCO;

    // 4. Draw sharp objective on top
    drawObjectiveCore(
      ctx,
      center,
      playerRadius,
      objectiveRadius,
      timeBeta,
      color
    );
  };

  // ------------------------------------------------------------
  // Return API: callable as drawPlayer, with drawObjective method
  // ------------------------------------------------------------
  return { drawPlayer, drawObjective };
};

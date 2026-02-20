import { jabApp } from "../screentransform.js";

export const animateShot = (game, ctx, shot, s) => {
  const { color, playerRadius, renderSettings } = game;
  const { team1, killerPosition, killedPosition, hit, anim, finished } = shot;
  const { bulletSpeed } = renderSettings;
  if (finished) return;

  if (!shot.isHit) {
    // Base colors
    const playerColor = team1 ? color.team2Player : color.team1Player;
    const gunColor = team1 ? color.team2Gun : color.team1Gun;
    const glowColor = team1 ? color.team2Disk : color.team1Disk;

    game.drawPlayer(
      killedPosition,
      playerRadius,
      playerColor,
      gunColor,
      Math.atan2(
        killerPosition[1] - killedPosition[1],
        killerPosition[0] - killedPosition[0]
      ),
      {
        glowRadius: playerRadius / 1.25,
        glowColor: glowColor,
        composite: "screen",
      }
    );
  }

  const dx = hit[0] - killerPosition[0];
  const dy = hit[1] - killerPosition[1];
  const dist = Math.sqrt(dx * dx + dy * dy);

  const bulletLength = 4 * playerRadius;

  if (anim === 0) jabApp([dx, -dy], 1000);

  if (dist < anim * bulletSpeed * playerRadius - bulletLength)
    shot.isHit = true;

  if (1280 < anim * bulletSpeed * playerRadius - bulletLength)
    shot.finished = true;

  // Trail tuning: 10–20 playerRadius
  const minTrailLen = 2 * playerRadius;
  const maxTrailLen = 16 * playerRadius;
  const headLen = anim * bulletSpeed * playerRadius;
  if (dist === 0) return hit;

  let trailLen = headLen * 2; // growth rate; tweak 0.25–0.6
  if (trailLen < minTrailLen) trailLen = minTrailLen;
  if (trailLen > maxTrailLen) trailLen = maxTrailLen;

  // Direction unit vector along the shot
  const ux = dx / dist;
  const uy = dy / dist;

  // Current bullet segment endpoints (same as before)
  const startX = killerPosition[0] + ux * headLen;
  const startY = killerPosition[1] + uy * headLen;
  const endX = killerPosition[0] + ux * (headLen + bulletLength);
  const endY = killerPosition[1] + uy * (headLen + bulletLength);

  // Draw trail: multiple translucent copies behind the head
  const prevAlpha = ctx.globalAlpha;
  ctx.strokeStyle = team1 ? color.team1Bullet : color.team2Bullet;
  ctx.lineWidth = (2 * playerRadius) / 5;

  const trailCopies = 32; // 8–16 works well
  for (let i = 1; i <= trailCopies; i++) {
    const t = i / (trailCopies + 1); // 0..1
    const back = t * trailLen;

    // Shift the whole segment backward
    const sx = startX - ux * back;
    const sy = startY - uy * back;
    const ex = endX - ux * back;
    const ey = endY - uy * back;

    // Fade out and optionally slightly shrink older segments
    const alpha = (1 - t) * 0.2; // overall intensity; tweak 0.2–0.6
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  // Draw the main bullet (full alpha) on top
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.globalAlpha = prevAlpha;

  // --- Shell ejection (2 shells) ---

  const bulletAngle = Math.atan2(uy, ux);

  // Parameter: how far from the bullet direction the shells eject (in degrees)
  const exitAngleDeg = renderSettings.shellAngle ?? 120;
  const phi = (exitAngleDeg * Math.PI) / 180;

  // Bullet "world speed" in your animation units (matches headLen growth)
  const bulletWorldSpeed = bulletSpeed * playerRadius;

  // Momentum-balance scale: v_shell = -v_bullet / (2*cos(phi))
  // Works cleanly for phi in (90°, 180°]. At 90° it's singular (cos=0).
  const c = Math.cos(phi);
  const eps = 1e-4;

  let shellMag;
  if (Math.abs(c) < eps) {
    // Near 90°, the required speed blows up; pick a sane fallback
    shellMag = bulletWorldSpeed;
  } else {
    shellMag = Math.abs(bulletWorldSpeed / (-2 * c));
  }

  // Ejection angles: +/- phi away from bullet direction
  const aL = bulletAngle + phi;
  const aR = bulletAngle - phi;

  // Origin near shooter, offset to the side of the barrel
  const px = -uy;
  const py = ux;

  const ejectOriginX =
    killerPosition[0] + px * (0.7 * playerRadius) - ux * (0.2 * playerRadius);
  const ejectOriginY =
    killerPosition[1] + py * (0.7 * playerRadius) - uy * (0.2 * playerRadius);

  const t = anim;

  const s1x = ejectOriginX + Math.cos(aL) * shellMag * t;
  const s1y = ejectOriginY + Math.sin(aL) * shellMag * t;

  const s2x = ejectOriginX + Math.cos(aR) * shellMag * t;
  const s2y = ejectOriginY + Math.sin(aR) * shellMag * t;

  // Spin proportional to bullet speed (and optionally shell speed too)
  const spin = bulletSpeed * 0.2; // tweak
  const shellAngle1 = aL - spin * t;
  const shellAngle2 = aR + spin * t;

  const shellColor = team1 ? color.team1Bullet : color.team2Bullet;

  drawShell(ctx, [s1x, s1y], shellAngle1, playerRadius, shellColor);
  drawShell(ctx, [s2x, s2y], shellAngle2, playerRadius, shellColor);

  // --- end shells ---

  return [
    [startX * s, startY * s],
    [endX * s, endY * s],
  ];
};

export function drawShell(ctx, position, angle, radius, color) {
  const [px, py] = position;

  const h = (4 / 5) * radius;
  const d = radius - h;
  const theta = Math.acos(d / radius);

  const yBar =
    (4 * radius * Math.pow(Math.sin(theta), 3)) /
    (3 * (2 * theta - Math.sin(2 * theta)));

  ctx.save();

  // COM frame
  ctx.translate(px, py);
  ctx.rotate(angle);

  // For the TOP cap, the centroid is yBar above the circle center.
  // So from COM -> circle center is +yBar in canvas coordinates (down).
  ctx.translate(0, yBar);

  // Top cap: arc centered at -PI/2 so chord is horizontal
  const a0 = -Math.PI / 2 - theta;
  const a1 = -Math.PI / 2 + theta;

  ctx.beginPath();
  ctx.arc(0, 0, radius, a0, a1);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

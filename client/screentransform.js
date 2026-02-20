const app = document.getElementById("App");
const maxTilt = 1; // degrees — mouse-driven tilt cap
let currentTiltX = 0;
let currentTiltY = 0;
let targetTiltX = 0;
let targetTiltY = 0;

let jiggleX = 0;
let jiggleY = 0;

// NEW: jiggle tilt (additive, like jab)
let jiggleTiltX = 0; // degrees
let jiggleTiltY = 0; // degrees

// per-frame accumulated jab translation + jab tilt
let jabX = 0;
let jabY = 0;
let jabTiltX = 0;
let jabTiltY = 0;

export function jiggleApp(
  duration = 500,
  magnitude = 4,
  tiltMagnitude = 0.6, // NEW: degrees
) {
  const start = performance.now();
  const seed = Math.random() * 1000;

  const noise = (t) =>
    Math.sin(t + seed) * 0.5 + Math.sin(t * 1.7 + seed * 2.3) * 0.3;

  const frame = (time) => {
    const t = (time - start) / duration;
    if (t >= 1) {
      jiggleX = 0;
      jiggleY = 0;
      return;
    }

    const decay = (1 - t) ** 3;

    const nx = noise(t * 22);
    const ny = noise(t * 22 + 10);

    // Translation
    jiggleX = nx * magnitude * decay;
    jiggleY = ny * magnitude * decay;

    // Tilt (mirrors jab axis conventions)
    jiggleTiltY += nx * tiltMagnitude * decay;
    jiggleTiltX += -ny * tiltMagnitude * decay;

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

// Directional jab (unchanged)
export function jabApp(
  direction,
  duration = 1000,
  magnitude = 20,
  tiltMagnitude = 3,
) {
  const start = performance.now();

  let dx = -direction?.[0] ?? 0;
  let dy = -direction?.[1] ?? 0;

  const len = Math.hypot(dx, dy);
  if (len > 1e-9) {
    dx /= len;
    dy /= len;
  } else return;

  const impulse = (t) => Math.exp(-6 * t) * Math.sin(Math.PI * t);

  const frame = (now) => {
    const t = (now - start) / duration;
    if (t >= 1) return;

    const k = impulse(t);

    const px = k * magnitude;
    jabX += dx * px;
    jabY += dy * px;

    const deg = k * tiltMagnitude;
    jabTiltY += dx * deg;
    jabTiltX += -dy * deg;

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

function signedSqrt(x) {
  return Math.sign(x) * x * x;
}

window.addEventListener("mousemove", (e) => {
  const rect = app.getBoundingClientRect();

  let nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  let ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;

  nx = clamp(nx, -1, 1);
  ny = clamp(ny, -1, 1);

  nx = signedSqrt(nx);
  ny = signedSqrt(ny);

  targetTiltX = -(ny * maxTilt);
  targetTiltY = nx * maxTilt;
});

// Real-time lerp matching 0.12 @ 200fps
const LAMBDA = -Math.log(1 - 0.12) * 200;

let lastTime = performance.now();

function render(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  const lerp = 1 - Math.exp(-LAMBDA * dt);

  currentTiltX += (targetTiltX - currentTiltX) * lerp;
  currentTiltY += (targetTiltY - currentTiltY) * lerp;

  Game.style.transform = `
    perspective(600px)
    translate3d(${jiggleX + jabX}px, ${jiggleY + jabY}px, 0)
    rotateX(${currentTiltX + jiggleTiltX + jabTiltX}deg)
    rotateY(${currentTiltY + jiggleTiltY + jabTiltY}deg)
  `;

  Menu.style.transform = `
    perspective(600px)
    translate3d(${jiggleX + jabX}px, ${jiggleY + jabY}px, 0)
    rotateX(${currentTiltX + jiggleTiltX + jabTiltX}deg)
    rotateY(${currentTiltY + jiggleTiltY + jabTiltY}deg)
  `;

  // reset additive impulses
  jabX = jabY = 0;
  jabTiltX = jabTiltY = 0;
  jiggleTiltX = jiggleTiltY = 0;

  requestAnimationFrame(render);
}

requestAnimationFrame(render);

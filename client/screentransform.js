const app = document.getElementById("App");

const maxTilt = 0.5; // degrees — how much max tilt you want
let currentTiltX = 0;
let currentTiltY = 0;
let targetTiltX = 0;
let targetTiltY = 0;
let jiggleX = 0;
let jiggleY = 0;
export function jiggleApp(duration = 333, magnitude = 4) {
  const start = performance.now();
  const seed = Math.random() * 1000;
  const noise = (t) =>
    Math.sin(t + seed) * 0.5 + Math.sin(t * 1.7 + seed) * 0.3;
  const frame = (time) => {
    const t = (time - start) / duration;
    if (t >= 1) {
      jiggleX = 0;
      jiggleY = 0;
      return;
    }
    const decay = (1 - t) ** 3;
    const x = noise(t * 22) * magnitude * decay;
    const y = noise(t * 22 + seed) * magnitude * decay;
    jiggleX = x;
    jiggleY = y;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// helper clamp
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

window.addEventListener("mousemove", (e) => {
  const rect = app.getBoundingClientRect();

  const localX = e.clientX - rect.left;
  const localY = e.clientY - rect.top;
  let nx = (localX / rect.width) * 2 - 1;
  let ny = (localY / rect.height) * 2 - 1;
  nx = clamp(nx, -1, 1);
  ny = clamp(ny, -1, 1);
  targetTiltX = -(ny * maxTilt);
  targetTiltY = nx * maxTilt;
});

// Real-time lerp matching 0.12 @ 200fps
const LAMBDA = -Math.log(1 - 0.12) * 200;

let lastTime = performance.now();

function render(now) {
  const dt = (now - lastTime) / 1000; // seconds since last frame
  lastTime = now;

  const lerp = 1 - Math.exp(-LAMBDA * dt);

  currentTiltX += (targetTiltX - currentTiltX) * lerp;
  currentTiltY += (targetTiltY - currentTiltY) * lerp;

  app.style.transform = `
    perspective(600px)
    translate3d(${jiggleX}px, ${jiggleY}px, 0)
    rotateX(${currentTiltX}deg)
    rotateY(${currentTiltY}deg)
  `;

  requestAnimationFrame(render);
}

requestAnimationFrame(render);

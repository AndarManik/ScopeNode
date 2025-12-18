const fps = document.getElementById("Stats");
let framesSinceLastUpdate = 0;
let elapsedSinceFpsUpdateMs = 0;
export const updateFps = (delta) => {
  framesSinceLastUpdate += 1;
  elapsedSinceFpsUpdateMs += delta;
  if (elapsedSinceFpsUpdateMs < 0.5) return;
  const decimalFps = framesSinceLastUpdate / elapsedSinceFpsUpdateMs;
  const rollingFps = Math.round(decimalFps);
  fps.innerText = `FPS: ${rollingFps}`;
  framesSinceLastUpdate = 0;
  elapsedSinceFpsUpdateMs = 0;
};

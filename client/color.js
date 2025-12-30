import { defaultGet } from "./usersettings.js";

export const newColor = (app) => {
  const color = {};

  color.hueMode = defaultGet("color.hueMode", "random");

  if (color.hueMode === "random") color.hue = Math.floor(Math.random() * 360);
  if (color.hueMode === "choice")
    color.hue = parseInt(localStorage.getItem("color.hue"));
  localStorage.setItem("color.hue", color.hue);

  color.setHue = (hue) => {
    color.hue = hue;
    color.hueMode = "choice";
    localStorage.setItem("color.hue", color.hue);
    localStorage.setItem("color.hueMode", color.hueMode);

    color.setGameByHue();
    color.setUIByHue();
  };

  color.setGameByHue = () => {
    const hue = color.hue;
    color.background = `oklch(0.09 0.015 ${hue})`;

    color.team1Player = `oklch(0.82 0.100 ${hue + 45})`;
    color.team2Player = `oklch(0.82 0.100 ${hue - 45})`;

    color.centerObjective = `oklch(0.82 0.100 ${hue})`;

    color.team1Path = `oklch(0.90 0.018 ${hue + 45})`;
    color.team2Path = `oklch(0.90 0.018 ${hue - 45})`;

    color.team1Point = `oklch(0.35 0.030 ${hue + 60})`;
    color.team2Point = `oklch(0.35 0.030 ${hue - 60})`;
    color.intersectPoint = `oklch(0.09 0.015 ${hue})`;

    color.team1Disk = `oklch(0.75 0.125 ${hue + 45})`;
    color.team2Disk = `oklch(0.75 0.125 ${hue - 45})`;
    color.intersectDisk = `oklch(0.86 0.065 ${hue})`;
  };

  color.setUIByHue = () => {
    const hue = color.hue;
    color.dark = `oklch(0.09 0.015 ${hue})`;

    color.transDark = `oklch(0.09 0.015 ${hue} / 0.5)`;
    color.input = `oklch(0.75 0.08 ${hue})`;
    color.inputLeft = `oklch(0.75 0.08 ${hue + 45})`;
    color.inputRight = `oklch(0.75 0.08 ${hue - 45})`;

    color.inputOff = `oklch(0.60 0.05 ${hue})`;
    color.inputLeftOff = `oklch(0.60 0.05 ${hue + 45})`;
    color.inputRightOff = `oklch(0.60 0.05 ${hue - 45})`;

    color.light = `oklch(0.90 0.035 ${hue})`;
    color.lightLeft = `oklch(0.90 0.035 ${hue + 45})`;
    color.lightRight = `oklch(0.90 0.035 ${hue - 45})`;

    updateCSS();
  };

  const updateCSS = () => {
    const style = document.documentElement.style;

    style.setProperty("--dark", color.dark);
    style.setProperty("--transDark", color.transDark);

    style.setProperty("--light", color.light);
    style.setProperty("--lightLeft", color.lightLeft);
    style.setProperty("--lightRight", color.lightRight);

    style.setProperty("--input", color.input);
    style.setProperty("--inputLeft", color.inputLeft);
    style.setProperty("--inputRight", color.inputRight);

    style.setProperty("--inputOff", color.inputOff);
    style.setProperty("--inputLeftOff", color.inputLeftOff);
    style.setProperty("--inputRightOff", color.inputRightOff);
  };

  color.obstacleHueRange = parseInt(defaultGet("color.obstacleHueRange", 60));
  color.obstacleColor = (i) => {
    const { obstacleHueRange, hue } = color;
    const alpha = golden(i);
    const obstacleHue = hue - obstacleHueRange + alpha * obstacleHueRange * 2;
    return `oklch(0.55 0.04 ${obstacleHue})`;
  };

  color.setUIByHue();
  color.setGameByHue();

  return color;
};

const golden = (i, n = i + 1) => (Math.sqrt(1.25 * n * n) - n / 2) % 1;

// what are the different types of color modes will there be.
// by default we want the user to get a different hue each refresh.
// A hue slider would be provided next a button to set randomize hue back on.
// Pallete elements are provided relative to the hue, an option to make it absolute would also be given
// A button to default the colors will work

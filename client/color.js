import { defaultGet } from "./usersettings.js";

export const newColor = (app) => {
  const color = {};

  color.hueMode = defaultGet("color.hueMode", "choice");
  color.hue = defaultGet("color.hue", 90);

  if (color.hueMode === "random") color.hue = Math.floor(Math.random() * 360);

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
    color.backgroundBrilliant = `oklch(0.35 0.025 ${hue})`;

    color.team1Player = `oklch(0.82 0.088 ${hue + 60})`;
    color.team2Player = `oklch(0.82 0.088 ${hue - 60})`;
    color.centerObjective = `oklch(0.82 0.088 ${hue})`;

    color.team1Path = `oklch(0.90 0.018 ${hue + 60})`;
    color.team2Path = `oklch(0.90 0.018 ${hue - 60})`;

    color.team1Point = `oklch(0.35 0.025 ${hue + 45})`;
    color.team2Point = `oklch(0.35 0.025 ${hue - 45})`;

    color.intersectPoint1 = `oklch(0.25 0.030 ${hue - 45})`;
    color.intersectPoint2 = `oklch(0.25 0.030 ${hue + 45})`;

    color.team1Disk = `oklch(0.75 0.125 ${hue + 60})`;
    color.team2Disk = `oklch(0.75 0.125 ${hue - 60})`;
    color.objectiveDisk = `oklch(0.75 0.125 ${hue})`;
    color.intersectDisk = `oklch(0.86 0.065 ${hue})`;

    color.team1Bullet = `oklch(0.90 0.045 ${hue + 60})`;
    color.team2Bullet = `oklch(0.90 0.045 ${hue - 60})`;

    color.team1Gun = `oklch(0.60 0.100 ${hue + 45})`;
    color.team2Gun = `oklch(0.60 0.100 ${hue - 45})`;
  };

  color.setUIByHue = () => {
    const hue = color.hue;
    color.dark = `oklch(0.09 0.015 ${hue})`;

    color.transDark = `oklch(0.09 0.015 ${hue} / 0.5)`;
    color.input = `oklch(0.75 0.08 ${hue})`;
    color.inputLeft = `oklch(0.75 0.08 ${hue + 45})`;
    color.inputRight = `oklch(0.75 0.08 ${hue - 45})`;

    color.inputOff = `oklch(0.45 0.050 ${hue})`;
    color.inputLeftOff = `oklch(0.45 0.050 ${hue + 45})`;
    color.inputRightOff = `oklch(0.45 0.050 ${hue - 45})`;

    color.light = `oklch(0.90 0.045 ${hue})`;
    color.lightLeft = `oklch(0.90 0.045 ${hue + 45})`;
    color.lightRight = `oklch(0.90 0.045 ${hue - 45})`;

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
    return `oklch(0.55 0.045 ${obstacleHue})`;
  };

  color.obstacleColorBrilliant = (i) => {
    if (i === -1) {
      return `oklch(0.40 0 ${color.hue})`;
    }

    const { obstacleHueRange, hue } = color;
    const alpha = golden(i);
    const obstacleHue = hue - obstacleHueRange + alpha * obstacleHueRange * 2;
    return `oklch(0.55 0.085 ${obstacleHue})`;
  };

  color.fillerColor = (opacity) => {
    return `oklch(0.75 0.08 ${color.hue} / ${opacity})`;
  };

  color.setUIByHue();
  color.setGameByHue();

  return color;
};

const golden = (i, n = i + 1) => (Math.sqrt(1.25 * n * n) - n / 2) % 1;

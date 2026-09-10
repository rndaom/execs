import type { CrosshairColor } from "./crosshair-ui";

export function rgbToHsv([r, g, b]: CrosshairColor) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h =
    d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max / 255 };
}

export function hsvToRgb(h: number, s: number, v: number): CrosshairColor {
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  h = (((h % 360) + 360) % 360) / 60;
  const c = v * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = v - c;
  const rgb =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return rgb.map((n) => Math.round((n + m) * 255)) as CrosshairColor;
}

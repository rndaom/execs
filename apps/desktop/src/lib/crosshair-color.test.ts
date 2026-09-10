import { describe, expect, it } from "vitest";
import { hsvToRgb, rgbToHsv } from "./crosshair-color";
import type { CrosshairColor } from "./crosshair-ui";

describe("crosshair color", () => {
  it("round-trips existing non-round RGB values without quantizing the profile", () => {
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 15)
        for (let b = 0; b <= 255; b += 3) {
          const rgb: CrosshairColor = [r, g, b];
          const hsv = rgbToHsv(rgb);
          expect(hsvToRgb(hsv.h, hsv.s, hsv.v)).toEqual(rgb);
        }
  });
  it("clamps pointer movement outside the color field", () => {
    expect(hsvToRgb(120, 2, 2)).toEqual([0, 255, 0]);
    expect(hsvToRgb(120, -1, -1)).toEqual([0, 0, 0]);
  });
});

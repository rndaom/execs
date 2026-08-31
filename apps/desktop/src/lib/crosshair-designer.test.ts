import { describe, expect, it } from "vitest";
import {
  clampDesign,
  defaultCrosshairDesign,
  designFillMask,
  parseDesign,
  renderCrosshairDesign,
  serializeDesign,
} from "./crosshair-designer";
import { CROSSHAIR_CANVAS_SIZE } from "./crosshair-ui";

const SIZE = CROSSHAIR_CANVAS_SIZE;
const at = (pixels: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * SIZE + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]] as const;
};

describe("crosshair designer", () => {
  it("clamps out-of-range parameters and survives a serialize round-trip", () => {
    const wild = clampDesign({
      ...defaultCrosshairDesign(),
      size: 999,
      thickness: -4,
      gap: 999,
      opacity: 5,
    });
    expect(wild.size).toBe(30);
    expect(wild.thickness).toBe(1);
    expect(wild.gap).toBe(16);
    expect(wild.opacity).toBe(32);
    expect(parseDesign(serializeDesign(wild))).toEqual(wild);
    expect(parseDesign("not json")).toBeNull();
    expect(parseDesign(null)).toBeNull();
  });

  it("respects the gap: no fill inside it, arms outside it", () => {
    const design = {
      ...defaultCrosshairDesign(),
      style: "cross" as const,
      gap: 5,
      size: 10,
      thickness: 2,
      outline: 0,
      dot: false,
    };
    const mask = designFillMask(design);
    // Center row, inside the gap (center=32, stroke spans x 31..32).
    expect(mask[32 * SIZE + 32 + 2]).toBe(0);
    // On the right arm.
    expect(mask[31 * SIZE + 32 + 6]).toBe(1);
    // Beyond the arm.
    expect(mask[31 * SIZE + 32 + 20]).toBe(0);
  });

  it("grows the ring when the radius grows", () => {
    const small = designFillMask({
      ...defaultCrosshairDesign(),
      style: "circle",
      size: 6,
      dot: false,
    });
    const large = designFillMask({
      ...defaultCrosshairDesign(),
      style: "circle",
      size: 14,
      dot: false,
    });
    const width = (mask: Uint8Array) => {
      let min = SIZE;
      let max = 0;
      for (let x = 0; x < SIZE; x += 1) {
        if (mask[32 * SIZE + x] === 1) {
          min = Math.min(min, x);
          max = Math.max(max, x);
        }
      }
      return max - min;
    };
    expect(width(large)).toBeGreaterThan(width(small));
  });

  it("adds a center dot on top of any style", () => {
    const noDot = designFillMask({ ...defaultCrosshairDesign(), gap: 4, dot: false });
    const withDot = designFillMask({ ...defaultCrosshairDesign(), gap: 4, dot: true, dotSize: 2 });
    expect(noDot[32 * SIZE + 32]).toBe(0);
    expect(withDot[32 * SIZE + 32]).toBe(1);
  });

  it("renders fill in the chosen color with a black outline ring around it", () => {
    const pixels = renderCrosshairDesign(
      { ...defaultCrosshairDesign(), style: "dot", size: 8, dot: false, outline: 1, shadow: false },
      [0, 255, 136],
    );
    expect(at(pixels, 32, 32)).toEqual([0, 255, 136, 255]);
    // Find an outline pixel: alpha set but color black, adjacent to the disc edge.
    let outlineFound = false;
    for (let y = 0; y < SIZE && !outlineFound; y += 1) {
      for (let x = 0; x < SIZE && !outlineFound; x += 1) {
        const [r, g, b, a] = at(pixels, x, y);
        if (a > 0 && r === 0 && g === 0 && b === 0) {
          outlineFound = true;
        }
      }
    }
    expect(outlineFound).toBe(true);
  });

  it("drops a soft shadow only where nothing else is drawn", () => {
    const base = renderCrosshairDesign(
      { ...defaultCrosshairDesign(), style: "dot", size: 6, dot: false, outline: 0, shadow: false },
      null,
    );
    const shadowed = renderCrosshairDesign(
      { ...defaultCrosshairDesign(), style: "dot", size: 6, dot: false, outline: 0, shadow: true },
      null,
    );
    let shadowPixels = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const index = i * 4;
      if (base[index + 3] === 0 && shadowed[index + 3] === 110) {
        shadowPixels += 1;
      }
      // Fill pixels stay identical.
      if (base[index + 3] === 255) {
        expect(shadowed[index + 3]).toBe(255);
      }
    }
    expect(shadowPixels).toBeGreaterThan(4);
  });

  it("always emits a 64x64 RGBA buffer", () => {
    const pixels = renderCrosshairDesign(defaultCrosshairDesign(), null);
    expect(pixels.length).toBe(SIZE * SIZE * 4);
  });
});

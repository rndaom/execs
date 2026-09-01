import { describe, expect, it } from "vitest";
import { CROSSHAIR_FILES } from "./gameplay-ui";
import {
  STOCK_CROSSHAIR_LABELS,
  stockCrosshairPrimitives,
  stockCrosshairRenderedSize,
} from "./stock-crosshair-shapes";

describe("stock crosshair shapes", () => {
  it("draws something for every real crosshair file and nothing for none", () => {
    expect(stockCrosshairPrimitives("")).toBeNull();
    for (const file of CROSSHAIR_FILES) {
      if (file === "") {
        continue;
      }
      const primitives = stockCrosshairPrimitives(file);
      expect(primitives, file).not.toBeNull();
      expect(primitives?.length, file).toBeGreaterThan(0);
    }
  });

  it("keeps every primitive inside the 64×64 sprite", () => {
    for (const file of CROSSHAIR_FILES) {
      for (const shape of stockCrosshairPrimitives(file) ?? []) {
        if (shape.kind === "rect") {
          expect(shape.x, file).toBeGreaterThanOrEqual(0);
          expect(shape.y, file).toBeGreaterThanOrEqual(0);
          expect(shape.x + shape.w, file).toBeLessThanOrEqual(64);
          expect(shape.y + shape.h, file).toBeLessThanOrEqual(64);
        } else if (shape.kind === "ring" || shape.kind === "disc") {
          const edge = shape.r + (shape.kind === "ring" ? shape.stroke / 2 : 0);
          expect(shape.cx - edge, file).toBeGreaterThanOrEqual(0);
          expect(shape.cx + edge, file).toBeLessThanOrEqual(64);
        } else {
          for (const value of [shape.x1, shape.y1, shape.x2, shape.y2]) {
            expect(value, file).toBeGreaterThanOrEqual(0);
            expect(value, file).toBeLessThanOrEqual(64);
          }
        }
      }
    }
  });

  it("labels every choice the gameplay select can hold", () => {
    for (const file of CROSSHAIR_FILES) {
      expect(STOCK_CROSSHAIR_LABELS[file], file).toBeTruthy();
    }
    expect(Object.keys(STOCK_CROSSHAIR_LABELS).sort()).toEqual([...CROSSHAIR_FILES].sort());
  });

  it("scales the preview by cl_crosshair_scale / 32", () => {
    // The engine rule the preview mirrors: scale 32 is 1:1 on a 64px sprite.
    expect(stockCrosshairRenderedSize(32)).toBe(64);
    expect(stockCrosshairRenderedSize(16)).toBe(32);
    expect(stockCrosshairRenderedSize(64)).toBe(128);
    expect(stockCrosshairRenderedSize(40)).toBe(80);
    expect(stockCrosshairRenderedSize(32, 32)).toBe(32);
  });
});

import { describe, expect, it } from "vitest";
import { fieldLayout, type Lens, lensInfluence, stepLens } from "./dot-field";
import { insideTf2Emblem } from "./tf2-emblem";

describe("insideTf2Emblem", () => {
  it("has a rim, an open centre and a tilted open cross", () => {
    expect(insideTf2Emblem(7, 7)).toBe(true);
    expect(insideTf2Emblem(0, 0)).toBe(false);
    expect(insideTf2Emblem(12, 0)).toBe(false);
    const angle = (7 * Math.PI) / 180;
    expect(insideTf2Emblem(8 * Math.cos(angle), 8 * Math.sin(angle))).toBe(false);
  });
});

describe("fieldLayout", () => {
  it("anchors the emblem in the bottom-right and fades the field toward the top-left", () => {
    const layout = fieldLayout(1000, 740);
    expect(layout.cx).toBeGreaterThan(700);
    expect(layout.cy).toBeGreaterThan(500);
    const ink = layout.dots.filter((dot) => dot.ink > 0);
    expect(ink.length).toBeGreaterThan(300);
    for (const dot of layout.dots) {
      expect(dot.x).toBeLessThanOrEqual(1000);
      expect(dot.y).toBeLessThanOrEqual(740);
      expect(dot.weight).toBeGreaterThanOrEqual(0.3);
      expect(dot.weight).toBeLessThanOrEqual(1);
    }
    const nearCorner = layout.dots.reduce((best, dot) =>
      dot.x + dot.y > best.x + best.y ? dot : best,
    );
    const farthest = layout.dots.reduce((best, dot) =>
      dot.x + dot.y < best.x + best.y ? dot : best,
    );
    expect(nearCorner.weight).toBeGreaterThan(farthest.weight);
    // Nothing is drawn in the far top-left corner of the page.
    expect(layout.dots.some((dot) => dot.x < 60 && dot.y < 60)).toBe(false);
  });
});

describe("the pointer lens", () => {
  it("appears under the pointer, follows with an ease and fades when it leaves", () => {
    const lens: Lens = { x: 0, y: 0, strength: 0 };
    stepLens(lens, { x: 400, y: 300 }, 16);
    expect(lens.x).toBe(400);
    expect(lens.strength).toBeGreaterThan(0);
    stepLens(lens, { x: 500, y: 300 }, 16);
    expect(lens.x).toBeGreaterThan(400);
    expect(lens.x).toBeLessThan(500);
    let settled = false;
    for (let frame = 0; frame < 200 && !settled; frame += 1) {
      settled = stepLens(lens, { x: 500, y: 300 }, 16);
    }
    expect(settled).toBe(true);
    expect(lensInfluence(lens, 500, 300)).toBeGreaterThan(0.95);
    expect(lensInfluence(lens, 800, 300)).toBe(0);
    settled = false;
    for (let frame = 0; frame < 300 && !settled; frame += 1) {
      settled = stepLens(lens, null, 16);
    }
    expect(settled).toBe(true);
    expect(lensInfluence(lens, 500, 300)).toBeLessThan(0.01);
  });
});

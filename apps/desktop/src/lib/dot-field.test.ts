import { describe, expect, it } from "vitest";
import { fadeTrail, fieldLayout, lightAlong, trailPresence } from "./dot-field";
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

describe("the pointer trail", () => {
  it("lights dots along the cursor's path and fades them out", () => {
    const { dots } = fieldLayout(1000, 740);
    const energy = new Float32Array(dots.length);
    const nearest = (x: number, y: number) =>
      dots.reduce(
        (best, dot, index) =>
          Math.hypot(dot.x - x, dot.y - y) < Math.hypot(dots[best].x - x, dots[best].y - y)
            ? index
            : best,
        0,
      );
    const start = nearest(700, 500);
    const middle = nearest(800, 500);
    const away = nearest(700, 300);
    lightAlong(dots, energy, { x: 700, y: 500 }, { x: 900, y: 500 });
    expect(energy[start]).toBeGreaterThan(0.8);
    // A fast move still lights the dots it passed between two events.
    expect(energy[middle]).toBeGreaterThan(0.8);
    expect(energy[away]).toBe(0);
    const peak = energy[middle];
    expect(fadeTrail(energy, 200)).toBe(true);
    expect(energy[middle]).toBeLessThan(peak);
    let glowing = true;
    for (let frame = 0; frame < 400 && glowing; frame += 1) glowing = fadeTrail(energy, 16);
    expect(glowing).toBe(false);
    expect(Math.max(...energy)).toBe(0);
  });

  it("lights fully over the emblem and dissolves with the field toward the top-left", () => {
    const { dots } = fieldLayout(1000, 740);
    const ink = dots.find((dot) => dot.ink > 0);
    const farthest = dots.reduce((best, dot) => (dot.x + dot.y < best.x + best.y ? dot : best));
    expect(ink && trailPresence(ink)).toBe(1);
    expect(trailPresence(farthest)).toBeLessThan(0.2);
  });
});

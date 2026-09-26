import { describe, expect, it } from "vitest";
import { DEFAULT_PULL, entrance, layoutDots, stepDots } from "./dot-matrix";
import { insideTf2Emblem } from "./tf2-emblem";

describe("insideTf2Emblem", () => {
  it("has a rim, an open centre and an open cross", () => {
    expect(insideTf2Emblem(7, 7)).toBe(true);
    expect(insideTf2Emblem(0, 0)).toBe(false);
    expect(insideTf2Emblem(12, 0)).toBe(false);
    // The cross gap is tilted, so a point on the untilted axis near the rim
    // falls on its edge rather than its middle; the tilted axis is open.
    const angle = (7 * Math.PI) / 180;
    expect(insideTf2Emblem(8 * Math.cos(angle), 8 * Math.sin(angle))).toBe(false);
  });
});

describe("layoutDots", () => {
  it("draws the emblem inside a round field that fades toward its edge", () => {
    const dots = layoutDots();
    const ink = dots.filter((dot) => dot.ink > 0);
    const field = dots.filter((dot) => dot.ink === 0);
    expect(ink.length).toBeGreaterThan(200);
    expect(field.length).toBeGreaterThan(200);
    for (const dot of dots) {
      expect(Math.hypot(dot.x - 180, dot.y - 180)).toBeLessThanOrEqual(180);
      expect(dot.field).toBeGreaterThanOrEqual(0);
      expect(dot.field).toBeLessThanOrEqual(1);
    }
    const centre = dots.reduce((best, dot) =>
      Math.hypot(dot.x - 180, dot.y - 180) < Math.hypot(best.x - 180, best.y - 180) ? dot : best,
    );
    // The emblem's round centre is open.
    expect(centre.ink).toBe(0);
    expect(Math.min(...dots.map((dot) => dot.delay))).toBeLessThan(40);
    expect(Math.max(...dots.map((dot) => dot.delay))).toBeLessThanOrEqual(520);
  });
});

describe("stepDots", () => {
  it("pushes nearby dots away from the pointer and lets them settle back", () => {
    const dots = layoutDots();
    const near = dots.find((dot) => Math.hypot(dot.x - 210, dot.y - 180) < 12);
    const far = dots.find((dot) => Math.hypot(dot.x - 210, dot.y - 180) > 150);
    if (!near || !far) throw new Error("fixture dots missing");
    for (let frame = 0; frame < 60; frame += 1) {
      stepDots(dots, { pointer: { x: 210, y: 180 }, ...DEFAULT_PULL }, 16);
    }
    expect(Math.hypot(near.dx, near.dy)).toBeGreaterThan(0.5);
    expect(near.glow).toBeGreaterThan(0.5);
    expect(far.dx).toBe(0);
    expect(far.glow).toBe(0);
    let settled = false;
    for (let frame = 0; frame < 200 && !settled; frame += 1) {
      settled = stepDots(dots, { pointer: null, ...DEFAULT_PULL }, 16);
    }
    expect(settled).toBe(true);
    expect(Math.abs(near.dx)).toBeLessThan(0.05);
  });

  it("brings dots in from the centre outward", () => {
    const [first] = layoutDots();
    expect(entrance({ ...first, delay: 100 }, 50)).toBe(0);
    expect(entrance({ ...first, delay: 100 }, 1000)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  cellsIn,
  createPointer,
  createStir,
  type FieldLayout,
  fieldLayout,
  forEachDotIn,
  leavePointer,
  movePointer,
  STIR_LIMIT,
  STIR_RADIUS,
  type Stir,
  type StirPointer,
  stepStir,
} from "./dot-field";
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
    expect(nearCorner.alpha).toBeGreaterThan(farthest.alpha);
    // Nothing is drawn in the far top-left corner of the page.
    expect(layout.dots.some((dot) => dot.x < 60 && dot.y < 60)).toBe(false);
  });

  it("keeps every dot quiet: the emblem faint, the grid fainter", () => {
    const { dots } = fieldLayout(1000, 740);
    for (const dot of dots) {
      expect(dot.alpha).toBeLessThanOrEqual(dot.ink > 0 ? 0.26 : 0.065);
      expect(dot.radius).toBeLessThanOrEqual(2.4);
    }
    const inkAlpha = Math.max(...dots.filter((dot) => dot.ink > 0).map((dot) => dot.alpha));
    const fieldAlpha = Math.max(...dots.filter((dot) => dot.ink === 0).map((dot) => dot.alpha));
    expect(inkAlpha).toBeGreaterThan(fieldAlpha);
  });

  it("finds dots by grid cell instead of scanning the field", () => {
    const layout = fieldLayout(1000, 740);
    const visits = new Map<number, number>();
    forEachDotIn(layout, -Infinity, -Infinity, Infinity, Infinity, (index) => {
      visits.set(index, (visits.get(index) ?? 0) + 1);
    });
    expect(visits.size).toBe(layout.dots.length);
    expect([...visits.values()].every((count) => count === 1)).toBe(true);
    const target = layout.dots[Math.floor(layout.dots.length / 2)];
    const found: number[] = [];
    forEachDotIn(layout, target.x - 1, target.y - 1, target.x + 1, target.y + 1, (index) =>
      found.push(index),
    );
    expect(found.map((index) => layout.dots[index])).toEqual([target]);
  });

  it("names the cells whose dots lie in a box, clamped to the grid", () => {
    const layout = fieldLayout(1000, 740);
    const { spacing, originX, originY } = layout;
    // A box from just past one dot to just short of the third dot after it.
    const box = cellsIn(
      layout,
      originX + spacing * 10 + 1,
      originY + spacing * 20 - 1,
      originX + spacing * 13 - 1,
      originY + spacing * 22 + 1,
    );
    expect(box).toEqual({ c0: 11, r0: 20, c1: 12, r1: 22 });
    // A box between two dots holds none of them.
    const between = cellsIn(layout, originX + 1, originY + 1, originX + 5, originY + 5);
    expect(between.c1).toBeLessThan(between.c0);
    const all = cellsIn(layout, -Infinity, -Infinity, Infinity, Infinity);
    expect(all).toEqual({ c0: 0, r0: 0, c1: layout.columns - 1, r1: layout.rows - 1 });
  });
});

function nearest(layout: FieldLayout, x: number, y: number): number {
  let best = 0;
  for (let index = 1; index < layout.dots.length; index += 1) {
    const dot = layout.dots[index];
    const current = layout.dots[best];
    if (Math.hypot(dot.x - x, dot.y - y) < Math.hypot(current.x - x, current.y - y)) best = index;
  }
  return best;
}

/** Step the stir frame by frame until it settles; returns the number of frames. */
function settle(layout: FieldLayout, stir: Stir, pointer: StirPointer, start: number): number {
  let now = start;
  for (let frame = 1; frame <= 1000; frame += 1) {
    now += 16;
    if (!stepStir(layout, stir, pointer, now, 16)) return frame;
  }
  return Number.POSITIVE_INFINITY;
}

describe("the pointer stir", () => {
  function stirred(x: number, y: number) {
    const layout = fieldLayout(1000, 740);
    const stir = createStir(layout.dots.length);
    const pointer = createPointer();
    let now = 0;
    for (let frame = 0; frame < 24; frame += 1) {
      now += 16;
      // A small wiggle: the pointer is moving, but stays near (x, y).
      movePointer(pointer, x + (frame % 2), y, now);
      stepStir(layout, stir, pointer, now, 16);
    }
    return { layout, stir, pointer, now };
  }

  it("slides nearby dots away from the pointer and leaves distant ones alone", () => {
    const { layout, stir } = stirred(800, 560);
    const right = nearest(layout, 800 + STIR_RADIUS / 3, 560);
    const below = nearest(layout, 800, 560 + STIR_RADIUS / 3);
    const far = nearest(layout, 800 - STIR_RADIUS * 2, 560);
    expect(stir.ox[right]).toBeGreaterThan(1.5);
    expect(stir.oy[below]).toBeGreaterThan(1.5);
    expect(stir.ox[far]).toBe(0);
    expect(stir.oy[far]).toBe(0);
    // Only the dots around the pointer take part.
    for (const index of stir.active) {
      const dot = layout.dots[index];
      expect(Math.hypot(dot.x - 800, dot.y - 560)).toBeLessThanOrEqual(
        STIR_RADIUS * Math.SQRT2 + 2,
      );
    }
  });

  it("never moves a dot beyond the limit, however hard the pointer shakes", () => {
    const layout = fieldLayout(1000, 740);
    const stir = createStir(layout.dots.length);
    const pointer = createPointer();
    let now = 0;
    let farthest = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      now += 8;
      movePointer(pointer, frame % 2 === 0 ? 650 : 950, 560, now);
      stepStir(layout, stir, pointer, now, 8);
      for (const index of stir.active) {
        farthest = Math.max(farthest, Math.hypot(stir.ox[index], stir.oy[index]));
      }
    }
    expect(farthest).toBeGreaterThan(1);
    expect(farthest).toBeLessThanOrEqual(STIR_LIMIT + 1e-4);
  });

  it("returns every dot exactly to its place once the pointer leaves", () => {
    const { layout, stir, pointer, now } = stirred(800, 560);
    expect(stir.active.length).toBeGreaterThan(20);
    leavePointer(pointer);
    // Well under a second at 60 frames a second.
    expect(settle(layout, stir, pointer, now)).toBeLessThan(60);
    expect(stir.active).toEqual([]);
    expect(pointer.strength).toBe(0);
    expect(stir.ox.every((value) => value === 0)).toBe(true);
    expect(stir.oy.every((value) => value === 0)).toBe(true);
  });

  it("calms down on its own when the pointer rests, so frames can stop", () => {
    const { layout, stir, pointer, now } = stirred(800, 560);
    // No further moves: the pointer is still over the page.
    expect(pointer.over).toBe(true);
    // Within about two seconds at 60 frames a second.
    expect(settle(layout, stir, pointer, now)).toBeLessThan(130);
    expect(stir.active).toEqual([]);
  });

  it("ignores a repeated position, so scrolling under a resting pointer lets it settle", () => {
    const { layout, stir, pointer, now } = stirred(800, 560);
    let time = now;
    let frames = 0;
    // Engines repeat the pointer's position after scrolling and layout.
    for (; frames < 200; frames += 1) {
      time += 16;
      expect(movePointer(pointer, pointer.x, pointer.y, time)).toBe(false);
      if (!stepStir(layout, stir, pointer, time, 16)) break;
    }
    expect(frames).toBeLessThan(130);
    expect(stir.active).toEqual([]);
  });

  it("takes no speed from the jump when the pointer arrives", () => {
    const pointer = createPointer();
    movePointer(pointer, 10, 10, 100);
    expect(pointer.vx).toBe(0);
    movePointer(pointer, 20, 10, 110);
    expect(pointer.vx).toBeGreaterThan(0);
    leavePointer(pointer);
    movePointer(pointer, 900, 10, 120);
    expect(pointer.vx).toBe(0);
  });
});

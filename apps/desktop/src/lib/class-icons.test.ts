import { describe, expect, it } from "vitest";
import { flattenEmblem } from "./class-icons";

describe("flattenEmblem", () => {
  it("keeps lit coverage and drops dark outlines and transparency", () => {
    const rgba = [
      // bright, opaque: full coverage
      240, 240, 240, 255,
      // black outline: dropped
      0, 0, 0, 255,
      // mid grey, half transparent: partial
      128, 128, 128, 128,
      // transparent: nothing
      255, 255, 255, 0,
    ];
    const mask = flattenEmblem({ width: 4, height: 1, rgba });
    expect(Array.from(mask.filter((_, index) => index % 4 !== 3))).toEqual(new Array(12).fill(255));
    const alpha = [3, 7, 11, 15].map((index) => mask[index]);
    expect(alpha[0]).toBe(255);
    expect(alpha[1]).toBe(0);
    expect(alpha[2]).toBeGreaterThan(60);
    expect(alpha[2]).toBeLessThan(128);
    expect(alpha[3]).toBe(0);
  });
});

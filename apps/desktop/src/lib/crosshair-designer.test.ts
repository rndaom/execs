import { describe, expect, it } from "vitest";
import {
  clampDesign,
  DESIGN_LIMITS,
  DESIGN_STYLES,
  defaultCrosshairDesign,
  designFillMask,
  dilate,
  maxDesignSize,
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
    // Not the raw 30 max: gap 16 + thickness 1 + outline 1 only leaves room
    // for 14 before the arms would be clipped against the sprite edge.
    expect(wild.size).toBe(14);
    expect(wild.size).toBe(maxDesignSize(wild));
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

describe("designer fits inside the sprite", () => {
  it("caps size against gap, thickness and outline so the arms are never clipped", () => {
    // 32 - 16 - 4 - 3 = 9: past that the arms would clip flat against the
    // sprite edge while the user kept dragging.
    expect(maxDesignSize({ style: "cross", thickness: 8, gap: 16, outline: 3 })).toBe(9);
    expect(maxDesignSize({ style: "cross", thickness: 2, gap: 0, outline: 0 })).toBe(30);
    // Circle and dot ignore the gap, so they get the full reach back.
    expect(maxDesignSize({ style: "circle", thickness: 2, gap: 16, outline: 0 })).toBe(30);
    expect(maxDesignSize({ style: "cross", thickness: 2, gap: 16, outline: 0 })).toBe(15);
    expect(
      maxDesignSize({ style: "cross", thickness: 8, gap: 16, outline: 3 }),
    ).toBeGreaterThanOrEqual(DESIGN_LIMITS.size.min);
  });

  it("clamps a stored design down to what actually fits", () => {
    const clamped = clampDesign({
      ...defaultCrosshairDesign(),
      style: "cross",
      size: 30,
      thickness: 8,
      gap: 16,
      outline: 3,
    });
    expect(clamped.size).toBe(9);
  });

  it("keeps the top of the size slider live for every style", () => {
    // B3: past the fitting size the arms just clipped flat against the sprite
    // edge — the user dragged and the bitmap stopped changing.
    for (const style of DESIGN_STYLES) {
      const base = {
        ...defaultCrosshairDesign(),
        style,
        thickness: DESIGN_LIMITS.thickness.max,
        gap: DESIGN_LIMITS.gap.max,
        outline: DESIGN_LIMITS.outline.max,
      };
      const fitted = maxDesignSize(base);
      const painted = (size: number) =>
        designFillMask(clampDesign({ ...base, size })).reduce((sum, on) => sum + on, 0);
      expect(clampDesign({ ...base, size: DESIGN_LIMITS.size.max }).size, style).toBe(fitted);
      if (fitted > DESIGN_LIMITS.size.min) {
        expect(painted(fitted), style).not.toBe(painted(fitted - 1));
      }
    }
  });

  it("never draws past the sprite at the fitting size", () => {
    for (const style of DESIGN_STYLES) {
      const design = clampDesign({
        ...defaultCrosshairDesign(),
        style,
        size: DESIGN_LIMITS.size.max,
        thickness: DESIGN_LIMITS.thickness.max,
        gap: DESIGN_LIMITS.gap.max,
        outline: DESIGN_LIMITS.outline.max,
      });
      const pixels = renderCrosshairDesign(design, null);
      // The bounding box of everything painted has to sit inside the sprite,
      // and the whole ring of the design has to be present on both sides.
      let left = SIZE;
      let right = -1;
      let top = SIZE;
      let bottom = -1;
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          if (at(pixels, x, y)[3] !== 0) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      expect(top, style).toBeGreaterThanOrEqual(0);
      expect(bottom, style).toBeLessThanOrEqual(SIZE - 1);
      // Horizontally symmetric about the 31/32 centre line — every style is,
      // "t" included, and a design cut off on one side would not be.
      expect(SIZE - 1 - right, style).toBe(left);
    }
  });
});

describe("designer centring", () => {
  it("keeps odd strokes on the sprite's centre line", () => {
    // The centre line sits on the 31/32 boundary (Valve's sprites use x=31 w=2).
    for (const thickness of [1, 2, 3, 4, 5]) {
      const mask = designFillMask(
        clampDesign({
          ...defaultCrosshairDesign(),
          style: "cross",
          thickness,
          gap: 2,
          size: 10,
          outline: 0,
        }),
      );
      const columns: number[] = [];
      for (let x = 0; x < SIZE; x += 1) {
        if (mask[20 * SIZE + x] === 1) {
          columns.push(x);
        }
      }
      expect(columns, `t=${thickness}`).toHaveLength(thickness);
      expect(columns.at(-1), `t=${thickness}`).toBe(31 + Math.floor(thickness / 2));
      expect(columns[0], `t=${thickness}`).toBe(32 - Math.ceil(thickness / 2));
    }
  });

  it("keeps the vertical and horizontal arms mirror images of each other", () => {
    const mask = designFillMask(
      clampDesign({
        ...defaultCrosshairDesign(),
        style: "cross",
        thickness: 3,
        gap: 2,
        size: 10,
        outline: 0,
      }),
    );
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        expect(mask[y * SIZE + x], `${x},${y}`).toBe(mask[x * SIZE + y]);
      }
    }
  });
});

describe("outline dilation", () => {
  it("grows a full block, not a 4-neighbour diamond", () => {
    const mask = new Uint8Array(SIZE * SIZE);
    mask[32 * SIZE + 32] = 1;
    const grown = dilate(mask, 3, "square");
    // A real 3px outline reaches the corners of the 7×7 block.
    expect(grown[(32 - 3) * SIZE + (32 - 3)]).toBe(1);
    expect(grown[(32 + 3) * SIZE + (32 + 3)]).toBe(1);
    expect(grown[(32 - 4) * SIZE + 32]).toBe(0);
    let painted = 0;
    for (const value of grown) {
      painted += value;
    }
    expect(painted).toBe(49);
  });

  it("keeps a round kernel round and leaves a zero-radius mask untouched", () => {
    const mask = new Uint8Array(SIZE * SIZE);
    mask[32 * SIZE + 32] = 1;
    const round = dilate(mask, 3, "round");
    expect(round[(32 - 3) * SIZE + (32 - 3)]).toBe(0);
    expect(round[(32 - 3) * SIZE + 32]).toBe(1);
    expect(dilate(mask, 0)).toBe(mask);
  });
});

describe("shadow layer", () => {
  it("rides the fill opacity instead of a fixed alpha", () => {
    const faint = renderCrosshairDesign(
      clampDesign({ ...defaultCrosshairDesign(), shadow: true, outline: 0, opacity: 64 }),
      null,
    );
    let shadowAlpha = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const alpha = faint[i * 4 + 3];
      if (alpha > 0 && alpha !== 64) {
        shadowAlpha = alpha;
        break;
      }
    }
    expect(shadowAlpha).toBe(Math.round((110 * 64) / 255));
  });

  it("never paints over the crosshair's own pixels", () => {
    const design = clampDesign({ ...defaultCrosshairDesign(), shadow: true, outline: 0 });
    const plain = renderCrosshairDesign({ ...design, shadow: false }, [255, 0, 0]);
    const shadowed = renderCrosshairDesign(design, [255, 0, 0]);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (plain[i * 4 + 3] !== 0) {
        expect(shadowed[i * 4], `pixel ${i}`).toBe(plain[i * 4]);
        expect(shadowed[i * 4 + 3], `pixel ${i}`).toBe(plain[i * 4 + 3]);
      }
    }
  });
});

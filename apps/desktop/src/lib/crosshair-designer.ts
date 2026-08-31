import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor } from "./crosshair-ui";

/**
 * Parametric crosshair designer. Everything renders into the same 64×64 RGBA
 * buffer the VTF pipeline already bakes, so a design is a real crosshair, not
 * a preview-only effect.
 */
export const DESIGN_STYLES = ["cross", "circle", "dot", "t", "x"] as const;

export type DesignStyle = (typeof DESIGN_STYLES)[number];

export type CrosshairDesign = {
  style: DesignStyle;
  /** Arm length from center (cross/t/x) or ring radius (circle), px. */
  size: number;
  /** Stroke thickness, px. */
  thickness: number;
  /** Empty distance from center before arms begin (cross/t/x), px. */
  gap: number;
  /** Filled center dot. */
  dot: boolean;
  dotSize: number;
  /** Black outline thickness, px (0 = none). */
  outline: number;
  /** Soft drop shadow, one px down-right. */
  shadow: boolean;
  /** Fill opacity 0–255. */
  opacity: number;
};

export const DESIGN_LIMITS = {
  size: { min: 2, max: 30 },
  thickness: { min: 1, max: 8 },
  gap: { min: 0, max: 16 },
  dotSize: { min: 1, max: 8 },
  outline: { min: 0, max: 3 },
  opacity: { min: 32, max: 255 },
} as const;

export function defaultCrosshairDesign(): CrosshairDesign {
  return {
    style: "cross",
    size: 12,
    thickness: 2,
    gap: 3,
    dot: false,
    dotSize: 2,
    outline: 1,
    shadow: false,
    opacity: 255,
  };
}

export function clampDesign(design: CrosshairDesign): CrosshairDesign {
  const clamp = (value: number, limits: { min: number; max: number }) =>
    Math.min(
      limits.max,
      Math.max(limits.min, Math.round(Number.isFinite(value) ? value : limits.min)),
    );
  return {
    style: DESIGN_STYLES.includes(design.style) ? design.style : "cross",
    size: clamp(design.size, DESIGN_LIMITS.size),
    thickness: clamp(design.thickness, DESIGN_LIMITS.thickness),
    gap: clamp(design.gap, DESIGN_LIMITS.gap),
    dot: design.dot === true,
    dotSize: clamp(design.dotSize, DESIGN_LIMITS.dotSize),
    outline: clamp(design.outline, DESIGN_LIMITS.outline),
    shadow: design.shadow === true,
    opacity: clamp(design.opacity, DESIGN_LIMITS.opacity),
  };
}

export function serializeDesign(design: CrosshairDesign): string {
  return JSON.stringify(clampDesign(design));
}

export function parseDesign(raw: string | undefined | null): CrosshairDesign | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CrosshairDesign>;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.style !== "string") {
      return null;
    }
    return clampDesign({ ...defaultCrosshairDesign(), ...parsed } as CrosshairDesign);
  } catch {
    return null;
  }
}

const SIZE = CROSSHAIR_CANVAS_SIZE;

/** The sprite center. Stock TF2 crosshair sprites center on 32 with 2px-wide
 * strokes spanning [31,32]; odd thicknesses center on 32 alone. */
function strokeSpan(center: number, thickness: number): [number, number] {
  const start = center - Math.floor(thickness / 2);
  return [start, start + thickness - 1];
}

/** Rasterize the design's fill coverage as a boolean grid. */
export function designFillMask(input: CrosshairDesign): Uint8Array {
  const design = clampDesign(input);
  const mask = new Uint8Array(SIZE * SIZE);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) {
      mask[y * SIZE + x] = 1;
    }
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        set(x, y);
      }
    }
  };
  const center = SIZE / 2; // 32; strokes span via strokeSpan for even widths
  const [tickStart, tickEnd] = strokeSpan(center, design.thickness);
  const armStart = design.gap;
  const armEnd = design.gap + design.size - 1;

  const drawArm = (direction: "up" | "down" | "left" | "right") => {
    if (design.size <= 0) {
      return;
    }
    if (direction === "up") {
      fillRect(tickStart, center - 1 - armEnd, tickEnd, center - 1 - armStart);
    } else if (direction === "down") {
      fillRect(tickStart, center + armStart, tickEnd, center + armEnd);
    } else if (direction === "left") {
      fillRect(center - 1 - armEnd, tickStart, center - 1 - armStart, tickEnd);
    } else {
      fillRect(center + armStart, tickStart, center + armEnd, tickEnd);
    }
  };

  if (design.style === "cross") {
    drawArm("up");
    drawArm("down");
    drawArm("left");
    drawArm("right");
  } else if (design.style === "t") {
    drawArm("down");
    drawArm("left");
    drawArm("right");
  } else if (design.style === "x") {
    const reach = design.gap + design.size;
    const half = design.thickness / 2;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const dx = x - center + 0.5;
        const dy = y - center + 0.5;
        const radial = Math.max(Math.abs(dx), Math.abs(dy));
        if (radial < design.gap || radial > reach) {
          continue;
        }
        // Distance to the two diagonals.
        if (Math.abs(dx - dy) / Math.SQRT2 <= half || Math.abs(dx + dy) / Math.SQRT2 <= half) {
          set(x, y);
        }
      }
    }
  } else if (design.style === "circle") {
    const radius = design.size;
    const half = design.thickness / 2;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const dx = x - center + 0.5;
        const dy = y - center + 0.5;
        const distance = Math.hypot(dx, dy);
        if (Math.abs(distance - radius) <= half) {
          set(x, y);
        }
      }
    }
  }

  if (design.style === "dot" || design.dot) {
    const radius =
      design.style === "dot" ? Math.max(design.dotSize, design.size / 4) : design.dotSize;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const dx = x - center + 0.5;
        const dy = y - center + 0.5;
        if (Math.hypot(dx, dy) <= radius) {
          set(x, y);
        }
      }
    }
  }

  return mask;
}

function dilate(mask: Uint8Array, by: number): Uint8Array {
  if (by <= 0) {
    return mask;
  }
  let current = mask;
  for (let pass = 0; pass < by; pass += 1) {
    const next = new Uint8Array(current);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (current[y * SIZE + x] !== 1) {
          continue;
        }
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE) {
            next[ny * SIZE + nx] = 1;
          }
        }
      }
    }
    current = next;
  }
  return current;
}

/** Render the design into an unpremultiplied 64×64 RGBA buffer. */
export function renderCrosshairDesign(
  input: CrosshairDesign,
  color: CrosshairColor | null = null,
): Uint8ClampedArray {
  const design = clampDesign(input);
  const [red, green, blue] = color ?? [255, 255, 255];
  const fill = designFillMask(design);
  const outlined = dilate(fill, design.outline);
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);

  const put = (index: number, r: number, g: number, b: number, a: number) => {
    // Later layers draw over earlier ones.
    pixels[index] = r;
    pixels[index + 1] = g;
    pixels[index + 2] = b;
    pixels[index + 3] = a;
  };

  if (design.shadow) {
    const shadowSource = design.outline > 0 ? outlined : fill;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (shadowSource[y * SIZE + x] !== 1) {
          continue;
        }
        const sx = x + 1;
        const sy = y + 1;
        if (sx < SIZE && sy < SIZE) {
          const index = (sy * SIZE + sx) * 4;
          if (pixels[index + 3] === 0) {
            put(index, 0, 0, 0, 110);
          }
        }
      }
    }
  }

  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const index = i * 4;
    if (fill[i] === 1) {
      put(index, red, green, blue, design.opacity);
    } else if (outlined[i] === 1) {
      // Outline ring: dilated minus fill.
      put(index, 0, 0, 0, design.opacity);
    }
  }

  return pixels;
}

import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor } from "./crosshair-ui";

/**
 * Parametric crosshair designer. Everything renders into the same 64×64 RGBA
 * buffer the VTF pipeline already bakes, so a design is a real crosshair, not
 * a preview-only effect.
 */
export const DESIGN_STYLES = ["cross", "circle", "dot", "t", "x"] as const;

const SIZE = CROSSHAIR_CANVAS_SIZE;

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

function clampTo(value: number, limits: { min: number; max: number }): number {
  return Math.min(
    limits.max,
    Math.max(limits.min, Math.round(Number.isFinite(value) ? value : limits.min)),
  );
}

/** Styles whose reach starts at the gap; circle and dot ignore it. */
function gapApplies(style: DesignStyle): boolean {
  return style === "cross" || style === "t" || style === "x";
}

/**
 * The largest `size` that still fits inside the 64×64 sprite.
 *
 * Everything is drawn from the centre (32), so the outermost pixel a design can
 * touch is `gap + size + thickness/2 + outline`. Letting the slider run past
 * that just clipped the arms flat against the sprite edge — the user dragged
 * and nothing changed, and the clipped bitmap is what got baked into the VTF.
 */
export function maxDesignSize(
  design: Pick<CrosshairDesign, "style" | "thickness" | "gap"> & Partial<CrosshairDesign>,
): number {
  const style = DESIGN_STYLES.includes(design.style) ? design.style : "cross";
  const thickness = clampTo(design.thickness, DESIGN_LIMITS.thickness);
  const gap = gapApplies(style) ? clampTo(design.gap, DESIGN_LIMITS.gap) : 0;
  const outline = clampTo(design.outline ?? 0, DESIGN_LIMITS.outline);
  const room = Math.floor(SIZE / 2 - gap - thickness / 2 - outline);
  return Math.max(DESIGN_LIMITS.size.min, Math.min(DESIGN_LIMITS.size.max, room));
}

export function clampDesign(design: CrosshairDesign): CrosshairDesign {
  const next = {
    style: DESIGN_STYLES.includes(design.style) ? design.style : "cross",
    size: clampTo(design.size, DESIGN_LIMITS.size),
    thickness: clampTo(design.thickness, DESIGN_LIMITS.thickness),
    gap: clampTo(design.gap, DESIGN_LIMITS.gap),
    dot: design.dot === true,
    dotSize: clampTo(design.dotSize, DESIGN_LIMITS.dotSize),
    outline: clampTo(design.outline, DESIGN_LIMITS.outline),
    shadow: design.shadow === true,
    opacity: clampTo(design.opacity, DESIGN_LIMITS.opacity),
  };
  return { ...next, size: Math.min(next.size, maxDesignSize(next)) };
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

/**
 * The sprite centre line sits on the 31/32 boundary — Valve's own sprites use
 * `x=31 w=2`, spanning [31,32]. `ceil` keeps every stroke on that side of the
 * boundary: t=1 → [31,31], t=2 → [31,32], t=3 → [30,32], t=4 → [30,33]. The old
 * `floor` put odd strokes one pixel down-right of centre, a visible aim offset
 * once the sprite is scaled in game.
 */
function strokeSpan(center: number, thickness: number): [number, number] {
  const start = center - Math.ceil(thickness / 2);
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

export type DilateKernel = "square" | "round";

/**
 * Grow a mask by `by` pixels in one pass with a real 2-D kernel.
 *
 * One pass with the full kernel, not `by` passes of a 4-neighbour one: that
 * grows a diamond, so `outline: 3` comes out with pointy corners instead of a
 * uniform 3px ring. `square` is the Chebyshev disc (a full (2by+1)² block),
 * `round` the Euclidean one — the latter keeps circular designs circular.
 */
export function dilate(mask: Uint8Array, by: number, kernel: DilateKernel = "round"): Uint8Array {
  if (by <= 0) {
    return mask;
  }
  const offsets: [number, number][] = [];
  for (let oy = -by; oy <= by; oy += 1) {
    for (let ox = -by; ox <= by; ox += 1) {
      if (kernel === "square" || Math.hypot(ox, oy) <= by + 0.5) {
        offsets.push([ox, oy]);
      }
    }
  }
  const next = new Uint8Array(mask);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (mask[y * SIZE + x] !== 1) {
        continue;
      }
      for (const [ox, oy] of offsets) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE) {
          next[ny * SIZE + nx] = 1;
        }
      }
    }
  }
  return next;
}

/** Drop-shadow alpha at full fill opacity. */
const SHADOW_ALPHA = 110;

/** Render the design into an unpremultiplied 64×64 RGBA buffer. */
export function renderCrosshairDesign(
  input: CrosshairDesign,
  color: CrosshairColor | null = null,
): Uint8ClampedArray {
  const design = clampDesign(input);
  const [red, green, blue] = color ?? [255, 255, 255];
  const fill = designFillMask(design);
  const outlined = dilate(fill, design.outline, design.style === "circle" ? "round" : "square");
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);

  const put = (index: number, r: number, g: number, b: number, a: number) => {
    // Later layers draw over earlier ones.
    pixels[index] = r;
    pixels[index + 1] = g;
    pixels[index + 2] = b;
    pixels[index + 3] = a;
  };

  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const index = i * 4;
    if (fill[i] === 1) {
      put(index, red, green, blue, design.opacity);
    } else if (outlined[i] === 1) {
      // Outline ring: dilated minus fill.
      put(index, 0, 0, 0, design.opacity);
    }
  }

  // The shadow runs AFTER the fill so its "don't paint over the crosshair"
  // guard is real — the buffer was still empty when this ran first, so the
  // guard always passed and the shadow overwrote the sprite's own pixels.
  // Its alpha rides the fill opacity: a faint crosshair gets a faint shadow.
  if (design.shadow) {
    const shadowSource = design.outline > 0 ? outlined : fill;
    const alpha = Math.round((SHADOW_ALPHA * design.opacity) / 255);
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
            put(index, 0, 0, 0, alpha);
          }
        }
      }
    }
  }

  return pixels;
}

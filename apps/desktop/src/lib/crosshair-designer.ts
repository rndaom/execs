import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor } from "./crosshair-ui";

/**
 * Parametric crosshair designer. Everything renders into the same 64×64 RGBA
 * buffer the VTF pipeline already bakes, so a design is a real crosshair, not
 * a preview-only effect.
 */
export const DESIGN_STYLES = [
  "cross",
  "circle",
  "dot",
  "t",
  "x",
  "chevron",
  "diamond",
  "ring-cross",
  "split",
  "arms",
  "square",
  "triangle",
] as const;

const SIZE = CROSSHAIR_CANVAS_SIZE;

export type DesignStyle = (typeof DESIGN_STYLES)[number];

export const DESIGN_STYLE_LABELS: Record<DesignStyle, string> = {
  cross: "Cross",
  circle: "Circle",
  dot: "Dot",
  t: "T",
  x: "X",
  chevron: "Chevron",
  diamond: "Diamond",
  "ring-cross": "Ring cross",
  split: "Split",
  arms: "Arms",
  square: "Square",
  triangle: "Triangle",
};

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
  /** Independently enabled arms; absent on old designs means all four. */
  arms?: { up: boolean; down: boolean; left: boolean; right: boolean };
  /** Clockwise degrees, 1–359; absent means upright. */
  rotation?: number;
  /** Anti-aliased edges; absent means hard pixel edges. */
  smooth?: boolean;
  /** A square center dot; absent means round. */
  dotShape?: "square";
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

/** Start a new editable design from the selected fixed shape. The original
 * remains available when the user saves this as a named design. */
export function designFromPreset(shape: string): CrosshairDesign {
  const base = { ...defaultCrosshairDesign(), thickness: 1, outline: 0, gap: 0 };
  switch (shape) {
    case "dot":
      return { ...base, style: "dot", size: 4, dotSize: 1 };
    case "cross":
      return { ...base, style: "cross", size: 24 };
    case "plus-gap":
      return { ...base, style: "cross", size: 24, gap: 4 };
    case "circle":
      return { ...base, style: "circle", size: 12, thickness: 2 };
    case "t":
      return { ...base, style: "t", size: 12 };
    case "execs-chevron":
      return { ...base, style: "chevron", size: 12, thickness: 2 };
    case "execs-diamond":
      return { ...base, style: "diamond", size: 12, thickness: 2 };
    case "execs-ring-cross":
      return { ...base, style: "ring-cross", size: 12, thickness: 2 };
    default:
      return defaultCrosshairDesign();
  }
}

function clampTo(value: number, limits: { min: number; max: number }): number {
  return Math.min(
    limits.max,
    Math.max(limits.min, Math.round(Number.isFinite(value) ? value : limits.min)),
  );
}

function normalizedRotation(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

/** Styles that offer the gap control. */
export function gapApplies(style: DesignStyle): boolean {
  return ["cross", "t", "x", "split", "arms", "square"].includes(style);
}

/** Styles whose arms start at the gap, so the gap pushes their reach outward.
 * A square's gap opens the middle of each side instead. */
function gapPushesOut(style: DesignStyle): boolean {
  return ["cross", "t", "x", "split", "arms"].includes(style);
}

/** How far a style's furthest point sits from the centre relative to its
 * reach, once it may be turned to any angle. */
function rotatedReachFactor(style: DesignStyle): number {
  if (style === "x" || style === "square") return Math.SQRT2;
  if (style === "chevron") return 1.12;
  return 1;
}

/** Whether the design is turned to an angle that is not a quarter turn. */
function freelyRotated(design: Pick<CrosshairDesign, "rotation">): boolean {
  return normalizedRotation(design.rotation) % 90 !== 0;
}

/**
 * The largest `size` that still fits inside the 64×64 sprite.
 *
 * Everything is drawn from the centre (32), so the outermost pixel a design can
 * touch is `gap + size + thickness/2 + outline`. Letting the slider run past
 * that just clipped the arms flat against the sprite edge — the user dragged
 * and nothing changed, and the clipped bitmap is what got baked into the VTF.
 * A design turned off a quarter turn must fit the circle inside the sprite.
 */
export function maxDesignSize(
  design: Pick<CrosshairDesign, "style" | "thickness" | "gap"> & Partial<CrosshairDesign>,
): number {
  const style = DESIGN_STYLES.includes(design.style) ? design.style : "cross";
  const thickness = clampTo(design.thickness, DESIGN_LIMITS.thickness);
  const gap = gapPushesOut(style) ? clampTo(design.gap, DESIGN_LIMITS.gap) : 0;
  const outline = clampTo(design.outline ?? 0, DESIGN_LIMITS.outline);
  const room = freelyRotated(design)
    ? Math.floor((SIZE / 2 - outline) / rotatedReachFactor(style) - thickness / 2 - gap)
    : Math.floor(SIZE / 2 - gap - thickness / 2 - outline);
  return Math.max(DESIGN_LIMITS.size.min, Math.min(DESIGN_LIMITS.size.max, room));
}

export function clampDesign(design: CrosshairDesign): CrosshairDesign {
  const rotation = normalizedRotation(design.rotation);
  const next: CrosshairDesign = {
    style: DESIGN_STYLES.includes(design.style) ? design.style : "cross",
    size: clampTo(design.size, DESIGN_LIMITS.size),
    thickness: clampTo(design.thickness, DESIGN_LIMITS.thickness),
    gap: clampTo(design.gap, DESIGN_LIMITS.gap),
    dot: design.dot === true,
    dotSize: clampTo(design.dotSize, DESIGN_LIMITS.dotSize),
    outline: clampTo(design.outline, DESIGN_LIMITS.outline),
    shadow: design.shadow === true,
    opacity: clampTo(design.opacity, DESIGN_LIMITS.opacity),
    ...(design.arms
      ? {
          arms: {
            up: design.arms.up !== false,
            down: design.arms.down !== false,
            left: design.arms.left !== false,
            right: design.arms.right !== false,
          },
        }
      : {}),
    // New options are stored only when used, so an older design keeps
    // serializing to exactly the same text.
    ...(rotation !== 0 ? { rotation } : {}),
    ...(design.smooth === true ? { smooth: true } : {}),
    ...(design.dotShape === "square" ? { dotShape: "square" as const } : {}),
  };
  return { ...next, size: Math.min(next.size, maxDesignSize(next)) };
}

export function serializeDesign(design: CrosshairDesign, label?: string): string {
  const clamped = clampDesign(design);
  return JSON.stringify(label?.trim() ? { ...clamped, label: label.trim() } : clamped);
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

/** The display name saved with a design, if any. */
export function designLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { label?: unknown };
    return typeof parsed?.label === "string" && parsed.label.trim()
      ? parsed.label.trim().slice(0, 40)
      : null;
  } catch {
    return null;
  }
}

const CODE_PREFIX = "execs-crosshair:";

/** A short text a player can paste to share a design. */
export function designCode(design: CrosshairDesign, label?: string): string {
  const bytes = new TextEncoder().encode(serializeDesign(design, label));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${CODE_PREFIX}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

/** Read a shared design code; null when it is not one. */
export function parseDesignCode(
  text: string,
): { design: CrosshairDesign; label: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(CODE_PREFIX) || trimmed.length > 4096) return null;
  try {
    const body = trimmed.slice(CODE_PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(body + "=".repeat((4 - (body.length % 4)) % 4));
    const raw = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    const design = parseDesign(raw);
    return design ? { design, label: designLabel(raw) } : null;
  } catch {
    return null;
  }
}

/** Rasterize the design's fill coverage as a boolean grid. */
export function designFillMask(input: CrosshairDesign): Uint8Array {
  return fillMaskAt(clampDesign(input), 1);
}

/**
 * The fill at `k` samples per sprite pixel. Every length is measured in
 * sprite pixels and scaled, so `k = 1` is the exact sprite and larger `k` is
 * the same geometry at higher resolution for turned and smoothed designs.
 *
 * The sprite centre line sits on the 31/32 boundary — Valve's own sprites use
 * `x=31 w=2`, spanning [31,32]. A stroke of thickness t starts at
 * 32 − ceil(t/2): t=1 → [31,31], t=2 → [31,32], t=3 → [30,32], t=4 → [30,33].
 */
function fillMaskAt(design: CrosshairDesign, k: number): Uint8Array {
  const S = SIZE * k;
  const mask = new Uint8Array(S * S);
  /** Fill sprite-pixel edges [x0, x1) × [y0, y1). */
  const fillEdges = (x0: number, y0: number, x1: number, y1: number) => {
    const left = Math.max(0, Math.round(x0 * k));
    const right = Math.min(S, Math.round(x1 * k));
    const top = Math.max(0, Math.round(y0 * k));
    const bottom = Math.min(S, Math.round(y1 * k));
    for (let y = top; y < bottom; y += 1) {
      mask.fill(1, y * S + left, y * S + right);
    }
  };
  /** Visit every sample with its offset from the centre in sprite pixels. */
  const each = (test: (dx: number, dy: number) => boolean) => {
    for (let y = 0; y < S; y += 1) {
      const dy = (y + 0.5) / k - SIZE / 2;
      for (let x = 0; x < S; x += 1) {
        if (test((x + 0.5) / k - SIZE / 2, dy)) mask[y * S + x] = 1;
      }
    }
  };
  const center = SIZE / 2;
  const strokeStart = center - Math.ceil(design.thickness / 2);
  const strokeEnd = strokeStart + design.thickness;
  const near = design.gap;
  const far = design.gap + design.size;
  const half = design.thickness / 2;

  const drawArm = (direction: "up" | "down" | "left" | "right") => {
    if (design.size <= 0) {
      return;
    }
    if (direction === "up") {
      fillEdges(strokeStart, center - far, strokeEnd, center - near);
    } else if (direction === "down") {
      fillEdges(strokeStart, center + near, strokeEnd, center + far);
    } else if (direction === "left") {
      fillEdges(center - far, strokeStart, center - near, strokeEnd);
    } else {
      fillEdges(center + near, strokeStart, center + far, strokeEnd);
    }
  };

  if (design.style === "arms") {
    for (const direction of ["up", "down", "left", "right"] as const) {
      if (design.arms?.[direction] !== false) drawArm(direction);
    }
  } else if (design.style === "split") {
    drawArm("up");
    drawArm("down");
    drawArm("left");
    drawArm("right");
    const cut = design.gap + design.size / 2;
    const width = Math.max(1, design.thickness / 2);
    for (let y = 0; y < S; y += 1) {
      const dy = (y + 0.5) / k - center;
      for (let x = 0; x < S; x += 1) {
        const d = Math.max(Math.abs((x + 0.5) / k - center), Math.abs(dy));
        if (Math.abs(d - cut) < width) mask[y * S + x] = 0;
      }
    }
  } else if (design.style === "chevron" || design.style === "diamond") {
    each((dx, dy) => {
      const edge =
        design.style === "diamond"
          ? Math.abs(dx) + Math.abs(dy) - design.size
          : Math.abs(dx) - dy - design.size / 2;
      return (
        Math.abs(edge) / Math.SQRT2 <= half &&
        Math.abs(dx) <= design.size &&
        Math.abs(dy) <= design.size
      );
    });
  } else if (design.style === "cross") {
    drawArm("up");
    drawArm("down");
    drawArm("left");
    drawArm("right");
  } else if (design.style === "t") {
    drawArm("down");
    drawArm("left");
    drawArm("right");
  } else if (design.style === "x") {
    each((dx, dy) => {
      const radial = Math.max(Math.abs(dx), Math.abs(dy));
      if (radial < design.gap || radial > far) return false;
      // Distance to the two diagonals.
      return Math.abs(dx - dy) / Math.SQRT2 <= half || Math.abs(dx + dy) / Math.SQRT2 <= half;
    });
  } else if (design.style === "circle" || design.style === "ring-cross") {
    each((dx, dy) => Math.abs(Math.hypot(dx, dy) - design.size) <= half);
    if (design.style === "ring-cross") {
      fillEdges(strokeStart, center - design.size, strokeEnd, center + design.size);
      fillEdges(center - design.size, strokeStart, center + design.size, strokeEnd);
    }
  } else if (design.style === "square") {
    // Half-open so a 1px stroke is exactly one pixel wide.
    each((dx, dy) => {
      const ring = Math.max(Math.abs(dx), Math.abs(dy)) - design.size;
      return ring >= -half && ring < half && Math.min(Math.abs(dx), Math.abs(dy)) >= design.gap;
    });
  } else if (design.style === "triangle") {
    const r = design.size;
    const corners: [number, number][] = [
      [0, -r],
      [r * Math.sin(Math.PI / 3), r / 2],
      [-r * Math.sin(Math.PI / 3), r / 2],
    ];
    each((dx, dy) =>
      corners.some(([ax, ay], index) => {
        const [bx, by] = corners[(index + 1) % 3];
        return segmentDistance(dx, dy, ax, ay, bx, by) <= half;
      }),
    );
  }

  if (design.style === "dot" || design.dot) {
    const radius =
      design.style === "dot" ? Math.max(design.dotSize, design.size / 4) : design.dotSize;
    if (design.dotShape === "square") {
      fillEdges(center - radius, center - radius, center + radius, center + radius);
    } else {
      each((dx, dy) => Math.hypot(dx, dy) <= radius);
    }
  }

  return mask;
}

function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
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
  return design.rotation || design.smooth
    ? renderSampled(design, color)
    : renderExact(design, color);
}

/** The original pixel renderer: every upright, hard-edged design. */
function renderExact(design: CrosshairDesign, color: CrosshairColor | null): Uint8ClampedArray {
  const [red, green, blue] = color ?? [255, 255, 255];
  const fill = fillMaskAt(design, 1);
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

/** Samples per sprite pixel on each axis for turned or smoothed designs. */
const SAMPLES = 4;

/**
 * Turned and smoothed designs: the geometry is rasterized at 4× resolution,
 * the outline grown there, and each sprite pixel takes the covered share of
 * its 16 samples (rotated about the sprite centre). Hard edges keep a sample
 * majority, so a quarter turn stays pixel-exact. Layers are composited
 * shadow, outline, fill, bottom to top.
 */
function renderSampled(design: CrosshairDesign, color: CrosshairColor | null): Uint8ClampedArray {
  const [red, green, blue] = color ?? [255, 255, 255];
  const k = SAMPLES;
  const S = SIZE * k;
  const fillHi = fillMaskAt(design, k);
  const outlineHi =
    design.outline > 0
      ? growHiRes(fillHi, S, design.outline * k, design.style === "circle" ? "round" : "square")
      : fillHi;
  const angle = ((design.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const coverage = (hi: Uint8Array) => {
    const out = new Float32Array(SIZE * SIZE);
    for (let py = 0; py < SIZE; py += 1) {
      for (let px = 0; px < SIZE; px += 1) {
        let hits = 0;
        for (let j = 0; j < k; j += 1) {
          const dy = py + (j + 0.5) / k - SIZE / 2;
          for (let i = 0; i < k; i += 1) {
            const dx = px + (i + 0.5) / k - SIZE / 2;
            // Clockwise on screen: sample the unrotated shape.
            const sx = Math.floor((SIZE / 2 + cos * dx + sin * dy) * k);
            const sy = Math.floor((SIZE / 2 - sin * dx + cos * dy) * k);
            if (sx >= 0 && sy >= 0 && sx < S && sy < S && hi[sy * S + sx] === 1) hits += 1;
          }
        }
        const share = hits / (k * k);
        out[py * SIZE + px] = design.smooth ? share : share >= 0.5 ? 1 : 0;
      }
    }
    return out;
  };
  const fill = coverage(fillHi);
  const outline = design.outline > 0 ? coverage(outlineHi) : fill;
  const opacity = design.opacity / 255;
  const shadowOpacity = (SHADOW_ALPHA / 255) * opacity;
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      const shadow =
        design.shadow && x > 0 && y > 0
          ? shadowOpacity * Math.max(outline[i - SIZE - 1], fill[i - SIZE - 1])
          : 0;
      // Black under black: outline over shadow only changes alpha.
      const outlineAlpha = design.outline > 0 ? opacity * outline[i] : 0;
      const under = outlineAlpha + shadow * (1 - outlineAlpha);
      const fillAlpha = opacity * fill[i];
      const alpha = fillAlpha + under * (1 - fillAlpha);
      if (alpha <= 0) continue;
      const index = i * 4;
      pixels[index] = Math.round((red * fillAlpha) / alpha);
      pixels[index + 1] = Math.round((green * fillAlpha) / alpha);
      pixels[index + 2] = Math.round((blue * fillAlpha) / alpha);
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

/**
 * Grow a high-resolution mask by `by` samples: separable nearest-distance
 * sweeps, so a 4× outline stays linear-time while a slider is dragged.
 */
function growHiRes(mask: Uint8Array, S: number, by: number, kernel: DilateKernel): Uint8Array {
  const INF = S * 4;
  // Distance along each row to the nearest set sample.
  const rowDistance = new Float64Array(S * S);
  for (let y = 0; y < S; y += 1) {
    let last = -INF;
    for (let x = 0; x < S; x += 1) {
      if (mask[y * S + x]) last = x;
      rowDistance[y * S + x] = x - last;
    }
    last = INF * 2;
    for (let x = S - 1; x >= 0; x -= 1) {
      if (mask[y * S + x]) last = x;
      rowDistance[y * S + x] = Math.min(rowDistance[y * S + x], last - x);
    }
  }
  const out = new Uint8Array(S * S);
  const limit = kernel === "round" ? (by + 0.5) ** 2 : by;
  for (let x = 0; x < S; x += 1) {
    for (let y = 0; y < S; y += 1) {
      const low = Math.max(0, y - by);
      const high = Math.min(S - 1, y + by);
      for (let yy = low; yy <= high; yy += 1) {
        const across = rowDistance[yy * S + x];
        const reached =
          kernel === "round" ? across * across + (yy - y) * (yy - y) <= limit : across <= limit;
        if (reached) {
          out[y * S + x] = 1;
          break;
        }
      }
    }
  }
  return out;
}
